pub mod bridge;
pub mod convert;
pub mod lights;
pub mod sensors;
pub mod utils;

use crate::homectl_core::{
    device::Device,
    events::TxEventChannel,
    integration::{Integration, IntegrationId},
};
use async_trait::async_trait;
use bridge::BridgeState;
use serde::Deserialize;
use std::error::Error;

use lights::poll_lights;
use sensors::poll_sensors;

#[derive(Clone, Debug, Deserialize)]
pub struct HueConfig {
    addr: String,
    username: String,
    poll_rate_sensors: u64,
    poll_rate_lights: u64,
}

pub struct Hue {
    id: String,
    devices: Vec<Device>,
    sender: TxEventChannel,
    config: HueConfig,
    bridge_state: Option<BridgeState>,
}

#[async_trait]
impl Integration for Hue {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Self {
        Hue {
            id: id.clone(),
            devices: Vec::new(),
            config: config.clone().try_into().unwrap(),
            sender,
            bridge_state: None,
        }
    }

    async fn register(&mut self) -> Result<(), Box<dyn Error>> {
        let bridge_state: BridgeState = reqwest::get(&format!(
            "http://{}/api/{}",
            self.config.addr, self.config.username
        ))
        .await?
        .json()
        .await?;

        self.bridge_state = Some(bridge_state);

        println!("{:#?}", self.bridge_state);
        println!("registered hue integration");

        Ok(())
    }

    async fn start(&mut self) -> Result<(), Box<dyn Error>> {
        println!("started hue integration");

        // FIXME: how to do this in a not stupid way
        let sensors = self.bridge_state.clone().unwrap().sensors;
        let config1 = self.config.clone();
        let config2 = self.config.clone();
        let integration_id1 = self.id.clone();
        let integration_id2 = self.id.clone();
        let sender1 = self.sender.clone();
        let sender2 = self.sender.clone();

        tokio::spawn(async { poll_sensors(config1, integration_id1, sender1, sensors).await });
        tokio::spawn(async { poll_lights(config2, integration_id2, sender2).await });

        Ok(())
    }

    fn set_device_state(&mut self, device: Device) {
        println!("hue: would set_device_state {:?}", device);
    }
}
