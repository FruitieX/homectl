pub mod bridge;

use crate::homectl_core::{
    device::{Device, DeviceKind, Light},
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
};
use async_trait::async_trait;
use bridge::BridgeState;
use serde::Deserialize;
use std::{error::Error, time::Duration};
use tokio::time::{interval_at, Instant};

#[derive(Clone, Debug, Deserialize)]
pub struct HueConfig {
    addr: String,
    username: String,
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

        let config = self.config.clone();
        let integration_id = self.id.clone();
        let sender = self.sender.clone();

        tokio::spawn(async move { poll_sensors(config, integration_id, sender).await });

        Ok(())
    }
}

async fn poll_sensors(config: HueConfig, integration_id: IntegrationId, sender: TxEventChannel) {
    let poll_rate = Duration::from_millis(500);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;
        println!("would poll");

        let kind = Light {
            power: true,
            brightness: 1.0,
            color: None,
        };
        sender
            .send(Message::HandleDeviceUpdate(Device {
                id: String::from("test"),
                integration_id: integration_id.clone(),
                scene: None,
                kind: DeviceKind::Light(kind),
            }))
            .unwrap();
    }
}
