use crate::types::{
    color::ColorMode,
    device::DevicesState,
    event::TxEventChannel,
    websockets::{StateUpdate, WebSocketResponse},
};

use super::{
    devices::Devices, groups::Groups, integrations::Integrations, rules::Rules, scenes::Scenes,
    websockets::WebSockets,
};

#[derive(Clone)]
pub struct AppState {
    pub integrations: Integrations,
    pub groups: Groups,
    pub scenes: Scenes,
    pub devices: Devices,
    pub rules: Rules,
    pub event_tx: TxEventChannel,
    pub ws: WebSockets,
}

impl AppState {
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

        let devices = self.devices.get_devices();
        let scenes = self.scenes.get_flattened_scenes(&devices);
        let groups = self.groups.get_flattened_groups(&devices);

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

        let message = WebSocketResponse::State(StateUpdate {
            devices: DevicesState(devices_converted),
            scenes,
            groups,
        });

        self.ws.send(user_id, &message).await;
    }
}
