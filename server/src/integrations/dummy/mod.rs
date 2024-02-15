use crate::types::{
    color::Capabilities,
    device::{ControllableDevice, Device, DeviceData, DeviceId, ManageKind},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct DummyDeviceConfig {
    name: String,
    init_state: Option<DeviceData>,
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
impl Integration for Dummy {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_deserialize()
            .wrap_err("Failed to deserialize config of Dummy integration")?;

        Ok(Dummy {
            id: id.clone(),
            config,
            event_tx,
            devices: HashMap::new(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        for (id, device) in &self.config.devices {
            let state = device
                .init_state
                .clone()
                .unwrap_or(DeviceData::Controllable(ControllableDevice::new(
                    None,
                    false,
                    None,
                    None,
                    None,
                    Capabilities::default(),
                    ManageKind::Full,
                )));

            let device = Device::new(
                self.id.clone(),
                id.clone(),
                device.name.clone(),
                state,
                None,
            );
            self.event_tx.send(Message::ExternalStateUpdate { device });
        }

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        // do nothing
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
