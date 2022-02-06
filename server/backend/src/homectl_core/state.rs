use homectl_types::{
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
    pub sender: TxEventChannel,
    pub ws: WebSockets,
}

impl AppState {
    /// Sends current state over WebSockets. If user_id is omitted, the message
    /// is broadcast to all connected peers.
    pub async fn send_state_ws(&self, user_id: Option<usize>) {
        let devices = self.devices.get_devices();
        let scenes = self.scenes.get_scenes();
        let groups = self.groups.get_flattened_groups(&devices);

        let message = WebSocketResponse::State(StateUpdate {
            devices,
            scenes,
            groups,
        });

        self.ws.send(user_id, &message).await;
    }
}
