pub mod bridge;
pub mod light_utils;
pub mod lights;
pub mod sensor_utils;
pub mod sensors;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use bridge::BridgeState;
use homectl_types::{
    device::Device,
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use serde::Deserialize;

use light_utils::bridge_light_to_device;
use lights::{poll_lights, set_device_state};
use sensor_utils::bridge_sensor_to_device;
use sensors::poll_sensors;

#[derive(Clone, Debug, Deserialize)]
pub struct HueConfig {
    addr: String,
    username: String,
    poll_rate_sensors: u64,
    poll_rate_lights: u64,
}

pub struct Hue {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: HueConfig,
    bridge_state: Option<BridgeState>,
}

#[async_trait]
impl Integration for Hue {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Hue integration")?;

        Ok(Hue {
            id: id.clone(),
            config,
            event_tx,
            bridge_state: None,
        })
    }

    async fn register(&mut self) -> Result<()> {
        println!("registering hue integration");

        let response = surf::get(&format!(
            "http://{}/api/{}",
            self.config.addr, self.config.username
        ))
        .await
        .map_err(|err| anyhow!(err))?
        .body_string()
        .await
        .map_err(|err| anyhow!(err))?;

        let bridge_state: BridgeState =
            serde_path_to_error::deserialize(&mut serde_json::Deserializer::from_str(&response))?;

        self.bridge_state = Some(bridge_state.clone());

        for (id, bridge_light) in bridge_state.lights {
            let device = bridge_light_to_device(id, self.id.clone(), bridge_light);
            self.event_tx
                .send(Message::IntegrationDeviceRefresh { device });
        }

        for (id, bridge_sensor) in bridge_state.sensors {
            let device = bridge_sensor_to_device(id, self.id.clone(), bridge_sensor);
            self.event_tx
                .send(Message::IntegrationDeviceRefresh { device });
        }

        println!("registered hue integration");

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started hue integration");

        {
            let init_bridge_sensors = self
                .bridge_state
                .clone()
                .context("Expected BridgeState to exist when Hue::start() is called")?
                .sensors;
            let config = self.config.clone();
            let integration_id = self.id.clone();
            let sender = self.event_tx.clone();

            tokio::spawn(async {
                poll_sensors(config, integration_id, sender, init_bridge_sensors).await
            });
        }

        {
            let config = self.config.clone();
            let integration_id = self.id.clone();
            let sender = self.event_tx.clone();

            tokio::spawn(async { poll_lights(config, integration_id, sender).await });
        }

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        match set_device_state(self.config.clone(), device).await {
            Ok(_) => {}
            Err(e) => {
                println!("Error while setting hue state: {}", e);
            }
        }

        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}
