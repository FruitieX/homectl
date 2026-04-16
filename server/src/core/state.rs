use crate::db::config_queries::{
    self, ConfigExport, CoreConfigRow, DashboardLayoutRow, DashboardWidgetRow,
    DeviceDisplayNameRow, DevicePositionRow, DeviceSensorConfigRow, FloorplanExportRow,
    FloorplanMetadataRow, FloorplanRow, GroupPositionRow, GroupRow, IntegrationRow, RoutineRow,
    SceneRow, WidgetSettingRow,
};
use crate::types::{
    color::ColorMode,
    device::DevicesState,
    event::TxEventChannel,
    websockets::{StateUpdate, WebSocketResponse},
};

use super::{
    devices::Devices, groups::Groups, integrations::Integrations, routines::Routines,
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
    pub runtime_config: ConfigExport,
    pub integrations: Integrations,
    pub groups: Groups,
    pub scenes: Scenes,
    pub devices: Devices,
    pub rules: Routines,
    pub event_tx: TxEventChannel,
    pub ws: WebSockets,
    pub ui: Ui,
    pub ws_broadcast_pending: Arc<AtomicBool>,
}

impl AppState {
    pub fn get_runtime_config(&self) -> &ConfigExport {
        &self.runtime_config
    }

    pub fn update_core_config(&mut self, config: CoreConfigRow) {
        self.runtime_config.core = config;
    }

    pub fn upsert_device_display_override(&mut self, row: DeviceDisplayNameRow) {
        if let Some(existing) = self
            .runtime_config
            .device_display_overrides
            .iter_mut()
            .find(|existing| existing.device_key == row.device_key)
        {
            *existing = row;
        } else {
            self.runtime_config.device_display_overrides.push(row);
            self.runtime_config
                .device_display_overrides
                .sort_by(|left, right| left.device_key.cmp(&right.device_key));
        }
    }

    pub fn delete_device_display_override(&mut self, device_key: &str) -> bool {
        let len_before = self.runtime_config.device_display_overrides.len();
        self.runtime_config
            .device_display_overrides
            .retain(|row| row.device_key != device_key);
        self.runtime_config.device_display_overrides.len() != len_before
    }

    pub fn upsert_device_sensor_config(&mut self, row: DeviceSensorConfigRow) {
        if let Some(existing) = self
            .runtime_config
            .device_sensor_configs
            .iter_mut()
            .find(|existing| existing.device_ref == row.device_ref)
        {
            *existing = row;
        } else {
            self.runtime_config.device_sensor_configs.push(row);
            self.runtime_config
                .device_sensor_configs
                .sort_by(|left, right| left.device_ref.cmp(&right.device_ref));
        }
    }

    pub fn delete_device_sensor_config(&mut self, device_ref: &str) -> bool {
        let len_before = self.runtime_config.device_sensor_configs.len();
        self.runtime_config
            .device_sensor_configs
            .retain(|row| row.device_ref != device_ref);
        self.runtime_config.device_sensor_configs.len() != len_before
    }

    fn promote_legacy_default_floorplan(&mut self) {
        if !self.runtime_config.floorplans.is_empty() {
            return;
        }

        if let Some(floorplan) = self.runtime_config.floorplan.take() {
            self.runtime_config.floorplans.push(FloorplanExportRow {
                id: "default".to_string(),
                name: "Default".to_string(),
                image_data: floorplan.image_data,
                image_mime_type: floorplan.image_mime_type,
                width: floorplan.width,
                height: floorplan.height,
                grid_data: None,
            });
        }
    }

    fn ensure_floorplan_index(&mut self, floorplan_id: &str) -> usize {
        self.promote_legacy_default_floorplan();

        if let Some(index) = self
            .runtime_config
            .floorplans
            .iter()
            .position(|floorplan| floorplan.id == floorplan_id)
        {
            return index;
        }

        self.runtime_config.floorplans.push(FloorplanExportRow {
            id: floorplan_id.to_string(),
            name: if floorplan_id == "default" {
                "Default".to_string()
            } else {
                floorplan_id.to_string()
            },
            image_data: None,
            image_mime_type: None,
            width: None,
            height: None,
            grid_data: None,
        });
        self.runtime_config.floorplans.len() - 1
    }

    pub fn create_floorplan_metadata(&mut self, floorplan: FloorplanMetadataRow) -> bool {
        self.promote_legacy_default_floorplan();
        if self
            .runtime_config
            .floorplans
            .iter()
            .any(|existing| existing.id == floorplan.id)
        {
            return false;
        }

        self.runtime_config.floorplans.push(FloorplanExportRow {
            id: floorplan.id,
            name: floorplan.name,
            image_data: None,
            image_mime_type: None,
            width: None,
            height: None,
            grid_data: None,
        });
        true
    }

    pub fn update_floorplan_metadata(&mut self, floorplan: FloorplanMetadataRow) -> bool {
        self.promote_legacy_default_floorplan();
        if let Some(existing) = self
            .runtime_config
            .floorplans
            .iter_mut()
            .find(|existing| existing.id == floorplan.id)
        {
            existing.name = floorplan.name;
            true
        } else {
            false
        }
    }

    pub fn delete_floorplan(&mut self, floorplan_id: &str) -> bool {
        self.promote_legacy_default_floorplan();
        let len_before = self.runtime_config.floorplans.len();
        self.runtime_config
            .floorplans
            .retain(|floorplan| floorplan.id != floorplan_id);
        self.runtime_config.floorplans.len() != len_before
    }

    pub fn upsert_floorplan_content(&mut self, floorplan_id: &str, floorplan: FloorplanRow) {
        let index = self.ensure_floorplan_index(floorplan_id);
        let existing = &mut self.runtime_config.floorplans[index];
        existing.image_data = floorplan.image_data;
        existing.image_mime_type = floorplan.image_mime_type;
        existing.width = floorplan.width;
        existing.height = floorplan.height;
    }

    pub fn set_floorplan_grid(&mut self, floorplan_id: &str, grid: String) {
        let index = self.ensure_floorplan_index(floorplan_id);
        self.runtime_config.floorplans[index].grid_data = Some(grid);
    }

    pub fn clear_floorplan_image(&mut self, floorplan_id: &str) -> bool {
        self.promote_legacy_default_floorplan();
        if let Some(existing) = self
            .runtime_config
            .floorplans
            .iter_mut()
            .find(|existing| existing.id == floorplan_id)
        {
            existing.image_data = None;
            existing.image_mime_type = None;
            existing.width = None;
            existing.height = None;
            true
        } else {
            false
        }
    }

    /// Returns all device positions reconstructed from persisted floorplan
    /// grid data for spatial rollout dispatch.
    pub fn effective_device_positions(&self) -> Vec<DevicePositionRow> {
        config_queries::extract_floorplan_device_positions(&self.runtime_config.floorplans)
    }

    pub fn upsert_group_position(&mut self, position: GroupPositionRow) {
        if let Some(existing) = self
            .runtime_config
            .group_positions
            .iter_mut()
            .find(|existing| existing.group_id == position.group_id)
        {
            *existing = position;
        } else {
            self.runtime_config.group_positions.push(position);
            self.runtime_config
                .group_positions
                .sort_by(|left, right| left.group_id.cmp(&right.group_id));
        }
    }

    pub fn delete_group_position(&mut self, group_id: &str) -> bool {
        let len_before = self.runtime_config.group_positions.len();
        self.runtime_config
            .group_positions
            .retain(|position| position.group_id != group_id);
        self.runtime_config.group_positions.len() != len_before
    }

    pub fn upsert_dashboard_layout(
        &mut self,
        mut layout: DashboardLayoutRow,
    ) -> DashboardLayoutRow {
        if layout.id <= 0 {
            layout.id = self
                .runtime_config
                .dashboard_layouts
                .iter()
                .map(|existing| existing.id)
                .max()
                .unwrap_or(0)
                + 1;
        }

        if layout.is_default {
            for existing in &mut self.runtime_config.dashboard_layouts {
                existing.is_default = false;
            }
        }

        if let Some(existing) = self
            .runtime_config
            .dashboard_layouts
            .iter_mut()
            .find(|existing| existing.id == layout.id)
        {
            *existing = layout.clone();
        } else {
            self.runtime_config.dashboard_layouts.push(layout.clone());
        }

        self.runtime_config
            .dashboard_layouts
            .sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));

        layout
    }

    pub fn delete_dashboard_layout(&mut self, layout_id: i32) -> bool {
        let len_before = self.runtime_config.dashboard_layouts.len();
        self.runtime_config
            .dashboard_layouts
            .retain(|layout| layout.id != layout_id);
        let deleted = self.runtime_config.dashboard_layouts.len() != len_before;
        if deleted {
            self.runtime_config
                .dashboard_widgets
                .retain(|widget| widget.layout_id != layout_id);
        }
        deleted
    }

    pub fn upsert_dashboard_widget(
        &mut self,
        mut widget: DashboardWidgetRow,
    ) -> DashboardWidgetRow {
        if widget.id <= 0 {
            widget.id = self
                .runtime_config
                .dashboard_widgets
                .iter()
                .map(|existing| existing.id)
                .max()
                .unwrap_or(0)
                + 1;
        }

        if let Some(existing) = self
            .runtime_config
            .dashboard_widgets
            .iter_mut()
            .find(|existing| existing.id == widget.id)
        {
            *existing = widget.clone();
        } else {
            self.runtime_config.dashboard_widgets.push(widget.clone());
        }

        self.runtime_config
            .dashboard_widgets
            .sort_by(|left, right| {
                left.layout_id
                    .cmp(&right.layout_id)
                    .then(left.sort_order.cmp(&right.sort_order))
                    .then(left.id.cmp(&right.id))
            });

        widget
    }

    pub fn delete_dashboard_widget(&mut self, widget_id: i32) -> bool {
        let len_before = self.runtime_config.dashboard_widgets.len();
        self.runtime_config
            .dashboard_widgets
            .retain(|widget| widget.id != widget_id);
        self.runtime_config.dashboard_widgets.len() != len_before
    }

    pub fn upsert_widget_setting(&mut self, setting: WidgetSettingRow) {
        if let Some(existing) = self
            .runtime_config
            .widget_settings
            .iter_mut()
            .find(|existing| existing.key == setting.key)
        {
            *existing = setting;
        } else {
            self.runtime_config.widget_settings.push(setting);
        }

        self.runtime_config
            .widget_settings
            .sort_by(|left, right| left.key.cmp(&right.key));
    }

    pub fn upsert_group(&mut self, group: GroupRow) {
        if let Some(existing) = self
            .runtime_config
            .groups
            .iter_mut()
            .find(|existing| existing.id == group.id)
        {
            *existing = group;
        } else {
            self.runtime_config.groups.push(group);
            self.runtime_config
                .groups
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_group(&mut self, group_id: &str) -> bool {
        let len_before = self.runtime_config.groups.len();
        self.runtime_config
            .groups
            .retain(|group| group.id != group_id);
        self.runtime_config.groups.len() != len_before
    }

    pub fn apply_runtime_groups(&mut self) {
        self.groups.load_config_rows(&self.runtime_config.groups);
        self.groups.force_invalidate(&self.devices);
        self.scenes.force_invalidate(&self.devices, &self.groups);
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast();
    }

    pub fn upsert_integration(&mut self, integration: IntegrationRow) {
        if let Some(existing) = self
            .runtime_config
            .integrations
            .iter_mut()
            .find(|existing| existing.id == integration.id)
        {
            *existing = integration;
        } else {
            self.runtime_config.integrations.push(integration);
            self.runtime_config
                .integrations
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_integration(&mut self, integration_id: &str) -> bool {
        let len_before = self.runtime_config.integrations.len();
        self.runtime_config
            .integrations
            .retain(|integration| integration.id != integration_id);
        self.runtime_config.integrations.len() != len_before
    }

    pub async fn apply_runtime_integrations(&mut self) -> Result<()> {
        let removed_ids = self
            .integrations
            .reload_config_rows(&self.runtime_config.integrations)
            .await?;

        for id in &removed_ids {
            self.devices.remove_devices_by_integration(id);
        }

        if !removed_ids.is_empty() {
            self.refresh_routine_statuses();
            self.schedule_ws_broadcast();
        }

        Ok(())
    }

    pub async fn apply_runtime_config(&mut self) -> Result<()> {
        self.apply_runtime_integrations().await?;
        self.apply_runtime_groups();
        self.apply_runtime_scenes();
        self.apply_runtime_routines();
        Ok(())
    }

    pub fn upsert_scene(&mut self, scene: SceneRow) {
        if let Some(existing) = self
            .runtime_config
            .scenes
            .iter_mut()
            .find(|existing| existing.id == scene.id)
        {
            *existing = scene;
        } else {
            self.runtime_config.scenes.push(scene);
            self.runtime_config
                .scenes
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_scene(&mut self, scene_id: &str) -> bool {
        let len_before = self.runtime_config.scenes.len();
        self.runtime_config
            .scenes
            .retain(|scene| scene.id != scene_id);
        self.runtime_config.scenes.len() != len_before
    }

    pub fn apply_runtime_scenes(&mut self) {
        let overrides = self.scenes.get_scene_overrides();
        self.scenes
            .load_config_rows(&self.runtime_config.scenes, overrides);
        self.scenes.force_invalidate(&self.devices, &self.groups);
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast();
    }

    pub fn upsert_routine(&mut self, routine: RoutineRow) {
        if let Some(existing) = self
            .runtime_config
            .routines
            .iter_mut()
            .find(|existing| existing.id == routine.id)
        {
            *existing = routine;
        } else {
            self.runtime_config.routines.push(routine);
            self.runtime_config
                .routines
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_routine(&mut self, routine_id: &str) -> bool {
        let len_before = self.runtime_config.routines.len();
        self.runtime_config
            .routines
            .retain(|routine| routine.id != routine_id);
        self.runtime_config.routines.len() != len_before
    }

    pub fn apply_runtime_routines(&mut self) {
        self.rules.load_config_rows(&self.runtime_config.routines);
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast();
    }

    pub async fn refresh_runtime_config_from_db(&mut self) -> Result<()> {
        self.runtime_config = config_queries::db_export_config().await?;
        Ok(())
    }

    pub fn refresh_routine_statuses(&mut self) {
        self.rules
            .refresh_runtime_statuses(&self.devices, &self.groups);
    }

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
        let routine_statuses = self.rules.get_runtime_statuses();

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
            routine_statuses,
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
                if let Err(e) = self.refresh_runtime_config_from_db().await {
                    warn!("Failed to refresh runtime config snapshot: {e}");
                }
                // Clean up devices belonging to removed integrations
                for id in &removed_ids {
                    self.devices.remove_devices_by_integration(id);
                }
                if !removed_ids.is_empty() {
                    self.refresh_routine_statuses();
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
        if let Err(e) = self.refresh_runtime_config_from_db().await {
            warn!("Failed to refresh runtime config snapshot: {e}");
        }

        self.groups.force_invalidate(&self.devices);
        self.scenes.force_invalidate(&self.devices, &self.groups);

        self.refresh_routine_statuses();
        self.schedule_ws_broadcast();
        Ok(())
    }

    /// Hot-reload scenes from the database
    pub async fn reload_scenes(&mut self) -> Result<()> {
        info!("Hot-reloading scenes from database...");
        self.scenes.refresh_db_scenes().await;
        if let Err(e) = self.refresh_runtime_config_from_db().await {
            warn!("Failed to refresh runtime config snapshot: {e}");
        }

        self.scenes.force_invalidate(&self.devices, &self.groups);

        self.refresh_routine_statuses();
        self.schedule_ws_broadcast();
        Ok(())
    }

    /// Hot-reload routines from the database
    pub async fn reload_routines(&mut self) -> Result<()> {
        info!("Hot-reloading routines from database...");
        self.rules.reload_from_db().await?;
        if let Err(e) = self.refresh_runtime_config_from_db().await {
            warn!("Failed to refresh runtime config snapshot: {e}");
        }
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast();
        Ok(())
    }
}
