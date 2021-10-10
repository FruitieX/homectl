use anyhow::{Context, Result};
use async_trait::async_trait;
use homectl_types::{
    device::{Device, DeviceId, DeviceState, SensorKind},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct BooleanConfig {
    init_value: bool,
    device_name: String,
}

pub struct Boolean {
    id: IntegrationId,
    config: BooleanConfig,
    event_tx: TxEventChannel,
}

#[async_trait]
impl Integration for Boolean {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config: BooleanConfig = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Boolean integration")?;

        Ok(Boolean {
            id: id.clone(),
            config,
            event_tx,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_boolean_device(&self.id, &self.config, None);

        self.event_tx
            .send(Message::IntegrationDeviceRefresh { device });

        println!("registered boolean integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started boolean integration {}", self.id);

        Ok(())
    }

    async fn set_integration_device_state(&mut self, _device: &Device) -> Result<()> {
        Ok(())
    }

    async fn run_integration_action(&mut self, action: &IntegrationActionPayload) -> Result<()> {
        let device = mk_boolean_device(&self.id, &self.config, None);

        self.event_tx
            .send(Message::IntegrationDeviceRefresh { device });

        let payload = action.to_string();
        let value: bool = payload.parse()?;

        let sender = self.event_tx.clone();
        let id = self.id.clone();
        let config = self.config.clone();

        let device = mk_boolean_device(&id, &config, Some(value));
        println!("setting {} to {}", id, value);
        sender.send(Message::IntegrationDeviceRefresh { device });

        Ok(())
    }
}

fn mk_boolean_device(id: &IntegrationId, config: &BooleanConfig, value: Option<bool>) -> Device {
    let state = DeviceState::Sensor(SensorKind::OnOffSensor {
        value: value.unwrap_or(config.init_value),
    });

    Device {
        id: DeviceId::new("boolean"),
        name: config.device_name.clone(),
        integration_id: id.clone(),
        scene: None,
        state,
        locked: false,
    }
}
