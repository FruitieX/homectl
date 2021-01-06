use super::{devices::Devices, events::TxEventChannel, groups::Groups, integrations::Integrations, rules::Rules, scenes::Scenes};

#[derive(Clone)]
pub struct AppState {
    pub integrations: Integrations,
    pub groups: Groups,
    pub scenes: Scenes,
    pub devices: Devices,
    pub rules: Rules,
    pub sender: TxEventChannel,
}
