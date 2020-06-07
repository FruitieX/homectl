pub mod bridge;
pub mod lights;
pub mod light_utils;
pub mod sensors;
pub mod sensor_utils;

use crate::homectl_core::{
    device::Device,
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
};
use async_trait::async_trait;
use bridge::BridgeState;
use serde::Deserialize;
use std::error::Error;

use light_utils::bridge_light_to_device;
use lights::poll_lights;
use sensors::poll_sensors;
use sensor_utils::bridge_sensor_to_device;

#[derive(Clone, Debug, Deserialize)]
pub struct HueConfig {
    addr: String,
    username: String,
    poll_rate_sensors: u64,
    poll_rate_lights: u64,
}

pub struct Hue {
    id: String,
    sender: TxEventChannel,
    config: HueConfig,
    bridge_state: Option<BridgeState>,
}

#[async_trait]
impl Integration for Hue {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Self {
        Hue {
            id: id.clone(),
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

        self.bridge_state = Some(bridge_state.clone());

        for (id, bridge_light) in bridge_state.lights {
            let device = bridge_light_to_device(id, self.id.clone(), bridge_light);
            self.sender.send(Message::DeviceRefresh { device }).unwrap();
        }

        for (id, bridge_sensor) in bridge_state.sensors {
            let device = bridge_sensor_to_device(id, self.id.clone(), bridge_sensor);
            self.sender.send(Message::DeviceRefresh { device }).unwrap();
        }

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
