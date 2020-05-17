use super::{
    device::Device,
    devices_manager::DevicesManager,
    integration::{Integration, IntegrationId},
};
use crate::integrations::{dummy::Dummy, hue::Hue};
use std::{
    collections::HashMap,
    error::Error,
    sync::{Arc, Mutex},
};

pub type DeviceId = String;

pub type ThreadsafeIntegration = Box<dyn Integration + Send + Sync>;

pub struct ManagedIntegration {
    pub integration: ThreadsafeIntegration,
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
        config: &config::Value,
        shared_integrations_manager: SharedIntegrationsManager,
    ) -> Result<(), String> {
        println!("loading integration with module_name {}", module_name);

        let integration = load_integration(
            module_name,
            integration_id,
            config,
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

    pub async fn run_register_pass(&self) -> Result<(), Box<dyn Error>> {
        let mut integrations = self.integrations.lock().unwrap();

        for (_integration_id, managed) in integrations.iter_mut() {
            managed.integration.register().await?;
        }

        Ok(())
    }

    pub async fn run_start_pass(&self) -> Result<(), Box<dyn Error>> {
        let mut integrations = self.integrations.lock().unwrap();

        for (_integration_id, managed) in integrations.iter_mut() {
            managed.integration.start().await?;
        }

        Ok(())
    }
}

// integrations will perhaps one day be loaded dynamically:
// https://michael-f-bryan.github.io/rust-ffi-guide/dynamic_loading.html
fn load_integration(
    module_name: &String,
    id: &IntegrationId,
    config: &config::Value,
    integrations_manager: SharedIntegrationsManager,
) -> Result<ThreadsafeIntegration, String> {
    match module_name.as_str() {
        "dummy" => Ok(Box::new(Dummy::new(id, config, integrations_manager))),
        "hue" => Ok(Box::new(Hue::new(id, config, integrations_manager))),
        _ => Err(format!("Unknown module name {}!", module_name)),
    }
}
