use crate::integrations::cron::Cron;
use crate::integrations::{
    circadian::Circadian, dummy::Dummy, mqtt::Mqtt, random::Random, timer::Timer,
};
use crate::types::{
    device::Device,
    event::TxEventChannel,
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use color_eyre::Result;
use eyre::eyre;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct LoadedIntegration {
    integration: Arc<Mutex<Box<dyn Integration>>>,
    module_name: String,
}

pub type CustomIntegrationsMap = HashMap<IntegrationId, LoadedIntegration>;

#[derive(Clone)]
pub struct Integrations {
    custom_integrations: CustomIntegrationsMap,
    event_tx: TxEventChannel,
}

impl Integrations {
    pub fn new(event_tx: TxEventChannel) -> Self {
        let integrations = Default::default();

        Integrations {
            custom_integrations: integrations,
            event_tx,
        }
    }

    pub async fn load_integration(
        &mut self,
        module_name: &str,
        integration_id: &IntegrationId,
        config: &config::Value,
    ) -> Result<()> {
        info!("loading integration with module_name {module_name}");

        let event_tx = self.event_tx.clone();
        let integration = load_custom_integration(module_name, integration_id, config, event_tx)?;

        let loaded_integration = LoadedIntegration {
            integration: Arc::new(Mutex::new(integration)),
            module_name: module_name.to_string(),
        };

        self.custom_integrations
            .insert(integration_id.clone(), loaded_integration);

        Ok(())
    }

    pub async fn run_register_pass(&self) -> Result<()> {
        for (integration_id, li) in self.custom_integrations.iter() {
            let mut integration = li.integration.lock().await;

            integration.register().await.unwrap();
            info!(
                "registered {} integration {}",
                li.module_name, integration_id
            );
        }

        Ok(())
    }

    pub async fn run_start_pass(&self) -> Result<()> {
        for (integration_id, li) in self.custom_integrations.iter() {
            let mut integration = li.integration.lock().await;

            integration.start().await.unwrap();
            info!("started {} integration {}", li.module_name, integration_id);
        }

        Ok(())
    }

    pub async fn set_integration_device_state(&self, device: Device) -> Result<()> {
        if device.is_readonly() {
            debug!(
                "Skipping ReadOnly device {integration_id}/{name} state update: {state}",
                integration_id = device.integration_id,
                name = device.name,
                state = device
                    .get_controllable_state()
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            );
            return Ok(());
        }

        let li = self
            .custom_integrations
            .get(&device.integration_id)
            .ok_or_else(|| {
                eyre!(
                    "Expected to find integration by id {}",
                    device.integration_id
                )
            })?;

        let mut integration = li.integration.lock().await;

        integration
            .set_integration_device_state(&device.clone())
            .await
    }

    pub async fn run_integration_action(
        &self,
        integration_id: &IntegrationId,
        payload: &IntegrationActionPayload,
    ) -> Result<()> {
        let li = self
            .custom_integrations
            .get(integration_id)
            .ok_or_else(|| eyre!("Expected to find integration by id {integration_id}"))?;
        let mut integration = li.integration.lock().await;

        integration.run_integration_action(payload).await
    }
}

// TODO: Load integrations dynamically as plugins:
// https://michael-f-bryan.github.io/rust-ffi-guide/dynamic_loading.html
fn load_custom_integration(
    module_name: &str,
    id: &IntegrationId,
    config: &config::Value,
    event_tx: TxEventChannel,
) -> Result<Box<dyn Integration>> {
    match module_name {
        "circadian" => Ok(Box::new(Circadian::new(id, config, event_tx)?)),
        "cron" => Ok(Box::new(Cron::new(id, config, event_tx)?)),
        "random" => Ok(Box::new(Random::new(id, config, event_tx)?)),
        "timer" => Ok(Box::new(Timer::new(id, config, event_tx)?)),
        "dummy" => Ok(Box::new(Dummy::new(id, config, event_tx)?)),
        "mqtt" => Ok(Box::new(Mqtt::new(id, config, event_tx)?)),
        _ => Err(eyre!("Unknown module name {module_name}!")),
    }
}
