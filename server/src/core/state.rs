use crate::types::{
    color::ColorMode,
    device::DevicesState,
    event::TxEventChannel,
    websockets::{StateUpdate, WebSocketResponse},
};

use super::{
    devices::Devices, expr::Expr, groups::Groups, integrations::Integrations, routines::Routines,
    scenes::Scenes, ui::Ui, websockets::WebSockets,
};

use color_eyre::Result;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

#[derive(Clone)]
pub struct AppState {
    pub warming_up: bool,
    pub integrations: Integrations,
    pub groups: Groups,
    pub scenes: Scenes,
    pub devices: Devices,
    pub rules: Routines,
    pub event_tx: TxEventChannel,
    pub expr: Expr,
    pub ws: WebSockets,
    pub ui: Ui,
    pub ws_broadcast_pending: Arc<AtomicBool>,
}

impl AppState {
    /// Schedule a debounced WebSocket broadcast
    /// Batches multiple state updates within 100ms into a single broadcast
    pub fn schedule_ws_broadcast(&self) {
        // If broadcast already scheduled, skip
        if self.ws_broadcast_pending.swap(true, Ordering::SeqCst) {
            return;
        }

        let state = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            state.ws_broadcast_pending.store(false, Ordering::SeqCst);
            state.send_state_ws(None).await;
        });
    }

    /// Sends current state over WebSockets. If user_id is omitted, the message
    /// is broadcast to all connected peers.
    pub async fn send_state_ws(&self, user_id: Option<usize>) {
        // Make sure there are any users connected before broadcasting
        if user_id.is_none() {
            let num_users = self.ws.num_users().await;
            if num_users == 0 {
                return;
            }
        }

        let devices = self.devices.get_state();
        let scenes = self.scenes.get_flattened_scenes().clone();
        let groups = self.groups.get_flattened_groups().clone();

        let devices_converted = devices
            .0
            .values()
            .map(|device| {
                (
                    device.get_device_key(),
                    device.color_to_mode(ColorMode::Hs, true),
                )
            })
            .collect();

        let ui_state = self.ui.get_state().clone();

        let message = WebSocketResponse::State(StateUpdate {
            devices: DevicesState(devices_converted),
            scenes,
            groups,
            ui_state,
        });

        self.ws.send(user_id, &message).await;
    }

    /// Hot-reload integrations from the database with full lifecycle support.
    /// Adds new integrations, removes deleted ones (cleaning up their devices),
    /// and restarts modified ones.
    pub async fn reload_integrations(&mut self) -> Result<()> {
        info!("Hot-reloading integrations from database...");
        match self.integrations.reload_integrations().await {
            Ok(removed_ids) => {
                // Clean up devices belonging to removed integrations
                for id in &removed_ids {
                    self.devices.remove_devices_by_integration(id);
                }
                if !removed_ids.is_empty() {
                    self.schedule_ws_broadcast();
                }
            }
            Err(e) => {
                warn!("Failed to reload integrations: {e}");
            }
        }
        Ok(())
    }

    /// Hot-reload groups from the database
    pub async fn reload_groups(&mut self) -> Result<()> {
        info!("Hot-reloading groups from database...");
        self.groups.reload_from_db().await?;

        self.groups.force_invalidate(&self.devices);
        self.expr
            .invalidate(self.devices.get_state(), &self.groups, &self.scenes);
        self.scenes
            .force_invalidate(&self.devices, &self.groups, self.expr.get_context());
        self.expr
            .invalidate(self.devices.get_state(), &self.groups, &self.scenes);

        self.schedule_ws_broadcast();
        Ok(())
    }

    /// Hot-reload scenes from the database
    pub async fn reload_scenes(&mut self) -> Result<()> {
        info!("Hot-reloading scenes from database...");
        self.scenes.refresh_db_scenes().await;

        self.scenes
            .force_invalidate(&self.devices, &self.groups, self.expr.get_context());
        self.expr
            .invalidate(self.devices.get_state(), &self.groups, &self.scenes);

        self.schedule_ws_broadcast();
        Ok(())
    }

    /// Hot-reload routines from the database
    pub async fn reload_routines(&mut self) -> Result<()> {
        info!("Hot-reloading routines from database...");
        self.rules.reload_from_db().await?;
        Ok(())
    }
}
