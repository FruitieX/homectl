use super::{
    device::Device,
    devices_manager::DevicesManager,
    integration::{Integration, IntegrationId},
};
use crate::integrations::dummy::Dummy;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub type DeviceId = String;

pub struct ManagedIntegration {
    pub integration: Box<dyn Integration>,
    pub devices: HashMap<DeviceId, Device>,
}

pub type IntegrationsTree = HashMap<IntegrationId, ManagedIntegration>;
pub type Integrations = Arc<Mutex<IntegrationsTree>>;

pub struct IntegrationsManager {
    integrations: Integrations,
    devices_manager: DevicesManager,
}

pub type SharedIntegrationsManager = Arc<Mutex<IntegrationsManager>>;

impl IntegrationsManager {
    pub fn new() -> Self {
        let integrations: Integrations = Arc::new(Mutex::new(HashMap::new()));
        let devices_manager = DevicesManager::new(integrations.clone());

        IntegrationsManager {
            integrations,
            devices_manager,
        }
    }

    pub fn load_integration(
        &self,
        module_name: &String,
        integration_id: &IntegrationId,
        shared_integrations_manager: SharedIntegrationsManager,
    ) -> Result<(), String> {
        println!("loading integration with module_name {}", module_name);

        let integration = load_integration(
            module_name,
            integration_id,
            &"".into(),
            shared_integrations_manager,
        )?;

        let devices = HashMap::new();
        let managed = ManagedIntegration {
            integration,
            devices,
        };

        {
            let mut integrations = self.integrations.lock().unwrap();
            integrations.insert(integration_id.clone(), managed);
        }

        Ok(())
    }

    pub fn run_register_pass(&self) {
        let integrations = self.integrations.lock().unwrap();

        for (_integration_id, managed) in integrations.iter() {
            managed.integration.register();
        }
    }

    pub fn run_start_pass(&self) {
        let integrations = self.integrations.lock().unwrap();

        for (_integration_id, managed) in integrations.iter() {
            managed.integration.start();
        }
    }
}

fn load_integration(
    module_name: &String,
    id: &IntegrationId,
    config: &String,
    integrations_manager: SharedIntegrationsManager,
) -> Result<Box<dyn Integration>, String> {
    match module_name.as_str() {
        "dummy" => Ok(Box::new(Dummy::new(id, config, integrations_manager))),
        _ => Err(format!("Unknown module name {}!", module_name)),
    }
}