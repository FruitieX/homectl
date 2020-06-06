pub mod bridge;

use crate::homectl_core::{
    device::{Device, DeviceKind, Light},
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
};
use async_trait::async_trait;
use bridge::{BridgeLight, BridgeLights, BridgeState};
use palette::{Hsl, IntoColor, Lch};
use serde::Deserialize;
use std::{error::Error, time::Duration};
use tokio::time::{interval_at, Instant};

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
        let config1 = self.config.clone();
        let config2 = self.config.clone();
        let integration_id1 = self.id.clone();
        let integration_id2 = self.id.clone();
        let sender1 = self.sender.clone();
        let sender2 = self.sender.clone();

        tokio::spawn(async { poll_sensors(config1, integration_id1, sender1).await });
        tokio::spawn(async { poll_lights(config2, integration_id2, sender2).await });

        Ok(())
    }

    fn set_device_state(&mut self, device: Device) {
        println!("hue: would set_device_state {:?}", device);
    }
}

async fn poll_sensors(config: HueConfig, integration_id: IntegrationId, sender: TxEventChannel) {
    let poll_rate = Duration::from_millis(config.poll_rate_sensors);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;
        println!("would poll sensors");

        let kind = Light {
            power: true,
            brightness: Some(1.0),
            color: None,
        };
        sender
            .send(Message::HandleDeviceUpdate(Device {
                id: String::from("test"),
                name: String::from("Test sensor"),
                integration_id: integration_id.clone(),
                scene: None,
                kind: DeviceKind::Light(kind),
            }))
            .unwrap();
    }
}

fn hue_to_palette(bridge_light: BridgeLight) -> Option<Lch> {
    let hue: f32 = bridge_light.state.hue? as f32;
    let saturation: f32 = bridge_light.state.sat? as f32;
    let lightness: f32 = bridge_light.state.bri? as f32;

    let hsl = Hsl::new(
        (hue / 65536.0) * 360.0,
        saturation / 254.0,
        lightness / 254.0,
    );
    let lch: Lch = hsl.into_lch();

    Some(lch)
}

async fn do_refresh_lights(
    config: HueConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
) {
    let bridge_lights: BridgeLights = reqwest::get(&format!(
        "http://{}/api/{}/lights",
        config.addr, config.username
    ))
    .await
    .unwrap() // FIXME: no .unwrap(), why doesn't `.await?` work here
    .json()
    .await
    .unwrap();

    for (light_id, bridge_light) in bridge_lights {
        let kind = Light {
            power: bridge_light.state.on,
            brightness: None,
            color: hue_to_palette(bridge_light.clone()),
        };
        sender
            .send(Message::HandleDeviceUpdate(Device {
                id: light_id,
                name: bridge_light.name.clone(),
                integration_id: integration_id.clone(),
                scene: None,
                kind: DeviceKind::Light(kind),
            }))
            .unwrap();
    }
}

async fn poll_lights(config: HueConfig, integration_id: IntegrationId, sender: TxEventChannel) {
    let poll_rate = Duration::from_millis(config.poll_rate_lights);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;
        println!("would poll lights");

        let sender = sender.clone();
        do_refresh_lights(config.clone(), integration_id.clone(), sender).await;
    }
}
