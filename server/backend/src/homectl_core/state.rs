use homectl_types::event::TxEventChannel;

use super::{
    devices::Devices, groups::Groups, integrations::Integrations, rules::Rules, scenes::Scenes, websockets::WebSockets,
};

#[derive(Clone)]
pub struct AppState {
    pub integrations: Integrations,
    pub groups: Groups,
    pub scenes: Scenes,
    pub devices: Devices,
    pub rules: Rules,
    pub sender: TxEventChannel,
    pub ws: WebSockets
}
