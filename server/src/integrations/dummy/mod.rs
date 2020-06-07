use crate::homectl_core::{
    device::Device,
    events::TxEventChannel,
    integration::{Integration, IntegrationId},
    integrations_manager::DeviceId,
};
use async_trait::async_trait;
use serde::Deserialize;
use std::{collections::HashMap, error::Error};

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
    fn new(id: &IntegrationId, _config: &config::Value, _sender: TxEventChannel) -> Self {
        Dummy {
            id: id.clone(),
            devices: HashMap::new(),
        }
    }

    async fn register(&mut self) -> Result<(), Box<dyn Error>> {
        let resp: HashMap<String, String> =
            reqwest::get("https://httpbin.org/ip").await?.json().await?;
        println!("{:#?}", resp);
        println!("registered dummy integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<(), Box<dyn Error>> {
        println!("started dummy integration {}", self.id);

        Ok(())
    }

    fn set_device_state(&mut self, device: Device) {
        self.devices.insert(device.id.clone(), device);
    }
}
