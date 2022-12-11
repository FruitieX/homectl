use crate::integrations::{
    boolean::Boolean, circadian::Circadian, dummy::Dummy, hue::Hue, lifx::Lifx, mqtt::Mqtt,
    neato::Neato, ping::Ping, random::Random, timer::Timer, tuya::Tuya, tuya_polling::TuyaPolling,
    wake_on_lan::WakeOnLan,
};
use anyhow::{anyhow, Context, Result};
use homectl_types::{
    custom_integration::CustomIntegration,
    device::{Device, DeviceId, DeviceKey},
    event::TxEventChannel,
    integration::{IntegrationActionPayload, IntegrationId},
    polling_integration::PollingIntegration,
};
use std::{collections::HashMap, convert::TryFrom, sync::Arc};
use tokio::sync::{Mutex, RwLock};

pub type CustomIntegrationsMap = HashMap<IntegrationId, Arc<Mutex<Box<dyn CustomIntegration>>>>;
pub type PollingIntegrationsMap = HashMap<IntegrationId, Arc<Box<dyn PollingIntegration>>>;
pub type DeviceStates = HashMap<DeviceKey, Device>;

#[derive(Clone)]
pub struct Integrations {
    expected_device_states: Arc<RwLock<DeviceStates>>,
    custom_integrations: CustomIntegrationsMap,
    polling_integrations: PollingIntegrationsMap,
    sender: TxEventChannel,
}

pub enum IntegrationKind {
    Polling,
    Custom,
}

impl TryFrom<&str> for IntegrationKind {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "boolean" => Ok(IntegrationKind::Custom),
            "circadian" => Ok(IntegrationKind::Custom),
            "random" => Ok(IntegrationKind::Custom),
            "timer" => Ok(IntegrationKind::Custom),
            "dummy" => Ok(IntegrationKind::Custom),
            "lifx" => Ok(IntegrationKind::Custom),
            "hue" => Ok(IntegrationKind::Custom),
            "mqtt" => Ok(IntegrationKind::Custom),
            "neato" => Ok(IntegrationKind::Custom),
            "ping" => Ok(IntegrationKind::Custom),
            "tuya" => Ok(IntegrationKind::Custom),
            "wake_on_lan" => Ok(IntegrationKind::Custom),
            _ => Err(anyhow!("Unknown module name {}!", value)),
        }
    }
}

impl Integrations {
    pub fn new(sender: TxEventChannel) -> Self {
        let expected_device_states = Default::default();
        let integrations = Default::default();
        let polling_integrations = Default::default();

        Integrations {
            expected_device_states,
            custom_integrations: integrations,
            polling_integrations,
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

        let event_tx = self.sender.clone();
        let integration_kind: IntegrationKind = module_name.try_into()?;

        match integration_kind {
            IntegrationKind::Polling => {}
            IntegrationKind::Custom => {
                let integration =
                    load_custom_integration(module_name, integration_id, config, event_tx)?;
                self.custom_integrations
                    .insert(integration_id.clone(), Arc::new(Mutex::new(integration)));
            }
        }

        Ok(())
    }

    pub async fn run_register_pass(&mut self) -> Result<()> {
        for (_integration_id, integration) in self.custom_integrations.iter_mut() {
            let mut integration = integration.lock().await;

            integration.register().await.unwrap();
        }

        Ok(())
    }

    pub async fn run_start_pass(&mut self) -> Result<()> {
        for (_integration_id, integration) in self.custom_integrations.iter_mut() {
            let mut integration = integration.lock().await;

            integration.start().await.unwrap();
        }

        Ok(())
    }

    pub async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        {
            let mut expected_device_states = self.expected_device_states.write().await;
            expected_device_states.insert(device.get_device_key(), device.clone());
        }

        let integration = self
            .custom_integrations
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
        let integration = self
            .custom_integrations
            .get(integration_id)
            .context(format!(
                "Expected to find integration by id {}",
                integration_id
            ))?;
        let mut integration = integration.lock().await;

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
) -> Result<Box<dyn CustomIntegration>> {
    match module_name {
        "boolean" => Ok(Box::new(Boolean::new(id, config, event_tx)?)),
        "circadian" => Ok(Box::new(Circadian::new(id, config, event_tx)?)),
        "random" => Ok(Box::new(Random::new(id, config, event_tx)?)),
        "timer" => Ok(Box::new(Timer::new(id, config, event_tx)?)),
        "dummy" => Ok(Box::new(Dummy::new(id, config, event_tx)?)),
        "lifx" => Ok(Box::new(Lifx::new(id, config, event_tx)?)),
        "hue" => Ok(Box::new(Hue::new(id, config, event_tx)?)),
        "mqtt" => Ok(Box::new(Mqtt::new(id, config, event_tx)?)),
        "neato" => Ok(Box::new(Neato::new(id, config, event_tx)?)),
        "ping" => Ok(Box::new(Ping::new(id, config, event_tx)?)),
        "tuya" => Ok(Box::new(Tuya::new(id, config, event_tx)?)),
        "wake_on_lan" => Ok(Box::new(WakeOnLan::new(id, config, event_tx)?)),
        _ => Err(anyhow!("Unknown module name {}!", module_name)),
    }
}

fn load_polling_integration(
    module_name: &str,
    id: &IntegrationId,
    config: &config::Value,
    event_tx: TxEventChannel,
) -> Result<Box<dyn PollingIntegration>> {
    match module_name {
        "tuya_polling" => Ok(Box::new(TuyaPolling::new(id, config, event_tx)?)),
        _ => Err(anyhow!("Unknown module name {}!", module_name)),
    }
}
