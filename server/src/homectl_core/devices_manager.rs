use super::{
    device::Device,
    integration::IntegrationId,
    integrations_manager::{Integrations, IntegrationsTree, ManagedIntegration},
};
use std::{
    sync::{MutexGuard},
};

pub struct DevicesManager {
    integrations: Integrations,
}

impl DevicesManager {
    pub fn new(integrations: Integrations) -> Self {
        DevicesManager {
            integrations: integrations,
        }
    }

    pub fn register_device(&self, integration_id: &IntegrationId, device: Device) {
        let mut integrations: MutexGuard<IntegrationsTree> = self.integrations.lock().unwrap();
        let managed: Option<&mut ManagedIntegration> = integrations.get_mut(integration_id);
        managed.unwrap().devices.insert(device.get_id(), device);
    }
}
