use crate::homectl_core::{
    device::{Device, DeviceId},
    events::TxEventChannel,
    integration::{Integration, IntegrationId},
};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct DummyConfig {
    asd: String,
}

pub struct Dummy {
    id: String,
    devices: HashMap<DeviceId, Device>,
}

#[async_trait]
impl Integration for Dummy {
    fn new(id: &IntegrationId, _config: &config::Value, _sender: TxEventChannel) -> Result<Self> {
        Ok(Dummy {
            id: id.clone(),
            devices: HashMap::new(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        let resp: HashMap<String, String> =
            reqwest::get("https://httpbin.org/ip").await?.json().await?;
        println!("{:#?}", resp);
        println!("registered dummy integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started dummy integration {}", self.id);

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: Device) {
        self.devices.insert(device.id.clone(), device);
    }
}
