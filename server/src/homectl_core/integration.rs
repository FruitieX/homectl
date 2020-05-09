// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use super::{integrations_manager::{SharedIntegrationsManager, IntegrationsManager}, device::{Device, DeviceKind}};

pub type IntegrationId = String;

pub trait Integration {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &String, integrations_manager: SharedIntegrationsManager) -> Self
    where
        Self: Sized;

    fn register(&self) {}
    fn start(&self) {}

    fn get_devices(&self) -> Vec<Device<DeviceKind>> {
        Vec::new()
    }
}
