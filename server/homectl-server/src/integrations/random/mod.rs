use anyhow::{Context, Result};
use async_trait::async_trait;
use homectl_types::{
    custom_integration::CustomIntegration,
    device::{Device, DeviceColor, DeviceId, DeviceState, Light},
    event::{Message, TxEventChannel},
    integration::{IntegrationActionPayload, IntegrationId},
};
use palette::{rgb::Rgb, FromColor, Hsv};
use rand::prelude::*;
use serde::Deserialize;
use std::time::Duration;
use tokio::time;

#[derive(Clone, Debug, Deserialize)]
pub struct RandomConfig {
    device_name: String,
}

#[derive(Clone)]
pub struct Random {
    id: IntegrationId,
    config: RandomConfig,
    event_tx: TxEventChannel,
}

#[async_trait]
impl CustomIntegration for Random {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config: RandomConfig = config
            .clone()
            .try_deserialize()
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
        tokio::spawn(async { poll_sensor(random).await });

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
    DeviceColor::Hsv(Hsv::from_color(rgb))
}

async fn poll_sensor(random: Random) {
    let poll_rate = Duration::from_millis(1000);
    let mut interval = time::interval(poll_rate);

    loop {
        interval.tick().await;

        let sender = random.event_tx.clone();

        let device = mk_random_device(&random);
        sender.send(Message::SetDeviceState {
            device,
            set_scene: false,
        });
    }
}

fn mk_random_device(random: &Random) -> Device {
    let state = DeviceState::Light(Light::new(
        true,
        Some(1.0),
        Some(get_random_color()),
        Some(500),
    ));

    Device {
        id: DeviceId::new("color"),
        name: random.config.device_name.clone(),
        integration_id: random.id.clone(),
        scene: None,
        state,
    }
}
