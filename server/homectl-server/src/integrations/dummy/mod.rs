use anyhow::{Context, Result};
use async_trait::async_trait;
use homectl_types::{
    custom_integration::CustomIntegration,
    device::{Device, DeviceColor, DeviceId, DeviceState, Light},
    event::{Message, TxEventChannel},
    integration::{IntegrationActionPayload, IntegrationId},
};
use palette::Hsv;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct DummyDeviceConfig {
    name: String,
    init_state: Hsv,
}

#[derive(Debug, Deserialize)]
pub struct DummyConfig {
    devices: HashMap<DeviceId, DummyDeviceConfig>,
}

pub struct Dummy {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: DummyConfig,
    devices: HashMap<DeviceId, Device>,
}

#[async_trait]
impl CustomIntegration for Dummy {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_deserialize()
            .context("Failed to deserialize config of Dummy integration")?;

        Ok(Dummy {
            id: id.clone(),
            config,
            event_tx,
            devices: HashMap::new(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        for (id, device) in &self.config.devices {
            let state = DeviceState::Light(Light::new(
                true,
                Some(1.0),
                Some(DeviceColor::Hsv(device.init_state)),
                None,
            ));
            let device = Device::new(self.id.clone(), id.clone(), device.name.clone(), state);
            self.event_tx
                .send(Message::IntegrationDeviceRefresh { device });
        }
        println!("registered dummy integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started dummy integration {}", self.id);

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        self.devices.insert(device.id.clone(), device.clone());
        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}
