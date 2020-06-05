use super::{
    device::Device,
    events::TxEventChannel,
    integration::{Integration, IntegrationId},
};
use crate::integrations::{dummy::Dummy, hue::Hue};
use std::{
    collections::HashMap,
    error::Error,
    sync::{Arc, Mutex},
};

pub type DeviceId = String;

pub type IntegrationsTree = HashMap<IntegrationId, Box<dyn Integration>>;
pub type Integrations = Arc<Mutex<IntegrationsTree>>;

pub struct IntegrationsManager {
    pub integrations: Integrations,
    sender: TxEventChannel,
}

impl IntegrationsManager {
    pub fn new(sender: TxEventChannel) -> Self {
        let integrations: Integrations = Arc::new(Mutex::new(HashMap::new()));

        IntegrationsManager {
            integrations,
            sender,
        }
    }

    pub fn load_integration(
        &self,
        module_name: &String,
        integration_id: &IntegrationId,
        config: &config::Value,
    ) -> Result<(), String> {
        println!("loading integration with module_name {}", module_name);

        let integration =
            load_integration(module_name, integration_id, config, self.sender.clone())?;

        {
            let mut integrations = self.integrations.lock().unwrap();
            integrations.insert(integration_id.clone(), integration);
        }

        Ok(())
    }

    pub async fn run_register_pass(&self) -> Result<(), Box<dyn Error>> {
        let mut integrations = self.integrations.lock().unwrap();

        for (_integration_id, integration) in integrations.iter_mut() {
            integration.register().await?;
        }

        Ok(())
    }

    pub async fn run_start_pass(&self) -> Result<(), Box<dyn Error>> {
        let mut integrations = self.integrations.lock().unwrap();

        for (_integration_id, integration) in integrations.iter_mut() {
            integration.start().await?;
        }

        Ok(())
    }

    pub fn set_device_state(&self, device: Device) {
        let mut integrations = self.integrations.lock().unwrap();

        let integration = integrations.get_mut(&device.integration_id);

        match integration {
            Some(integration) => {
                integration.set_device_state(device);
            }
            None => {}
        }
    }
}

// integrations will perhaps one day be loaded dynamically:
// https://michael-f-bryan.github.io/rust-ffi-guide/dynamic_loading.html
fn load_integration(
    module_name: &String,
    id: &IntegrationId,
    config: &config::Value,
    sender: TxEventChannel,
) -> Result<Box<dyn Integration>, String> {
    match module_name.as_str() {
        "dummy" => Ok(Box::new(Dummy::new(id, config, sender))),
        "hue" => Ok(Box::new(Hue::new(id, config, sender))),
        _ => Err(format!("Unknown module name {}!", module_name)),
    }
}
