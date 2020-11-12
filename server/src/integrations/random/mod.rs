use crate::homectl_core::{
    device::{Device, DeviceColor, DeviceState, Light},
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use palette::rgb::Rgb;
use rand::prelude::*;
use serde::Deserialize;
use std::time::Duration;
use tokio::time::{interval_at, Instant};

#[derive(Clone, Debug, Deserialize)]
pub struct RandomConfig {
    device_name: String,
}

#[derive(Clone)]
pub struct Random {
    id: String,
    config: RandomConfig,
    event_tx: TxEventChannel,
}

#[async_trait]
impl Integration for Random {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config: RandomConfig = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Random integration")?;

        Ok(Random {
            id: id.clone(),
            config: config.clone(),
            event_tx,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_random_device(self);

        self.event_tx
            .send(Message::IntegrationDeviceRefresh { device })
            .await;

        println!("registered random integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started random integration {}", self.id);

        let random = self.clone();

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        tokio::spawn(async { poll_sensor(random).await });

        Ok(())
    }

    async fn set_integration_device_state(&mut self, _device: Device) {
        // do nothing
    }
}

fn get_random_color() -> DeviceColor {
    let mut rng = rand::thread_rng();

    let r: f32 = rng.gen();
    let g: f32 = rng.gen();
    let b: f32 = rng.gen();

    let rgb: Rgb = Rgb::new(r, g, b);
    rgb.into()
}

async fn poll_sensor(random: Random) {
    let poll_rate = Duration::from_millis(100);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;

        let sender = random.event_tx.clone();

        let device = mk_random_device(&random);
        sender.send(Message::SetDeviceState { device }).await;
    }
}

fn mk_random_device(random: &Random) -> Device {
    let state = DeviceState::Light(Light {
        power: true,
        brightness: Some(1.0),
        color: Some(get_random_color()),
    });

    let device = Device {
        id: "color".into(),
        name: random.config.device_name.clone(),
        integration_id: random.id.clone(),
        scene: None,
        state,
    };

    device
}
