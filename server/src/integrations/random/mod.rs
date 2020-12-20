use crate::homectl_core::{
    device::{Device, DeviceColor, DeviceState, Light},
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use anyhow::{Context, Result};
use async_std::prelude::*;
use async_std::{stream, task};
use async_trait::async_trait;
use palette::rgb::Rgb;
use rand::prelude::*;
use serde::Deserialize;
use std::time::Duration;

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
            config,
            event_tx,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_random_device(self);

        self.event_tx
            .send(Message::IntegrationDeviceRefresh { device });

        println!("registered random integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started random integration {}", self.id);

        let random = self.clone();

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        task::spawn(async { poll_sensor(random).await });

        Ok(())
    }

    async fn set_integration_device_state(&mut self, _device: &Device) -> Result<()> {
        // do nothing
        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
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
    let mut interval = stream::interval(poll_rate);

    loop {
        interval.next().await;

        let sender = random.event_tx.clone();

        let device = mk_random_device(&random);
        sender.send(Message::SetDeviceState {
            device,
            set_scene: false,
        });
    }
}

fn mk_random_device(random: &Random) -> Device {
    let state = DeviceState::Light(Light {
        power: true,
        brightness: Some(1.0),
        color: Some(get_random_color()),
    });

    Device {
        id: "color".into(),
        name: random.config.device_name.clone(),
        integration_id: random.id.clone(),
        scene: None,
        state,
    }
}
