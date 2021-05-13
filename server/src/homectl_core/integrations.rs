use crate::integrations::{
    circadian::Circadian, dummy::Dummy, hue::Hue, lifx::Lifx, neato::Neato, random::Random,
    wake_on_lan::WakeOnLan,
};
use anyhow::{anyhow, Context, Result};
use async_std::sync::Mutex;
use homectl_types::{
    device::Device,
    event::TxEventChannel,
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use std::{collections::HashMap, sync::Arc};

pub type IntegrationsTree = HashMap<IntegrationId, Arc<Mutex<Box<dyn Integration + Send>>>>;

#[derive(Clone)]
pub struct Integrations {
    integrations: IntegrationsTree,
    sender: TxEventChannel,
}

impl Integrations {
    pub fn new(sender: TxEventChannel) -> Self {
        let integrations = Default::default();

        Integrations {
            integrations,
            sender,
        }
    }

    pub async fn load_integration(
        &mut self,
        module_name: &str,
        integration_id: &IntegrationId,
        config: &config::Value,
    ) -> Result<()> {
        println!("loading integration with module_name {}", module_name);

        let integration =
            load_integration(module_name, integration_id, config, self.sender.clone())?;
        let integration = Arc::new(Mutex::new(integration));

        self.integrations
            .insert(integration_id.clone(), integration);

        Ok(())
    }

    pub async fn run_register_pass(&mut self) -> Result<()> {
        for (_integration_id, integration) in self.integrations.iter_mut() {
            let mut integration = integration.lock().await;

            integration.register().await?;
        }

        Ok(())
    }

    pub async fn run_start_pass(&mut self) -> Result<()> {
        for (_integration_id, integration) in self.integrations.iter_mut() {
            let mut integration = integration.lock().await;

            integration.start().await?;
        }

        Ok(())
    }

    pub async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        let integration = self
            .integrations
            .get(&device.integration_id)
            .context(format!(
                "Expected to find integration by id {}",
                device.integration_id
            ))?;
        let mut integration = integration.lock().await;

        integration
            .set_integration_device_state(&device.clone())
            .await
    }

    pub async fn run_integration_action(
        &mut self,
        integration_id: &IntegrationId,
        payload: &IntegrationActionPayload,
    ) -> Result<()> {
        let integration = self.integrations.get(integration_id).context(format!(
            "Expected to find integration by id {}",
            integration_id
        ))?;
        let mut integration = integration.lock().await;

        integration.run_integration_action(payload).await
    }
}

// TODO: Load integrations dynamically as plugins:
// https://michael-f-bryan.github.io/rust-ffi-guide/dynamic_loading.html
fn load_integration(
    module_name: &str,
    id: &IntegrationId,
    config: &config::Value,
    event_tx: TxEventChannel,
) -> Result<Box<dyn Integration + Send>> {
    match module_name {
        "circadian" => Ok(Box::new(Circadian::new(id, config, event_tx)?)),
        "random" => Ok(Box::new(Random::new(id, config, event_tx)?)),
        "dummy" => Ok(Box::new(Dummy::new(id, config, event_tx)?)),
        "lifx" => Ok(Box::new(Lifx::new(id, config, event_tx)?)),
        "hue" => Ok(Box::new(Hue::new(id, config, event_tx)?)),
        "neato" => Ok(Box::new(Neato::new(id, config, event_tx)?)),
        "wake_on_lan" => Ok(Box::new(WakeOnLan::new(id, config, event_tx)?)),
        _ => Err(anyhow!("Unknown module name {}!", module_name)),
    }
}
