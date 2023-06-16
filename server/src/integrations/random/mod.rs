use crate::types::{
    color::{Capabilities, ColorMode, DeviceColor},
    custom_integration::CustomIntegration,
    device::{Device, DeviceData, DeviceId, ManagedDevice},
    event::{Message, TxEventChannel},
    integration::IntegrationId,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
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
}

fn get_random_color() -> DeviceColor {
    let mut rng = rand::thread_rng();

    let r: u8 = rng.gen();
    let g: u8 = rng.gen();
    let b: u8 = rng.gen();

    DeviceColor::new_from_rgb(r, g, b)
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
    let state = DeviceData::Managed(ManagedDevice::new(
        None,
        true,
        Some(1.0),
        Some(get_random_color()),
        Some(500),
        Capabilities::singleton(ColorMode::Rgb),
    ));

    Device {
        id: DeviceId::new("color"),
        name: random.config.device_name.clone(),
        integration_id: random.id.clone(),
        data: state,
    }
}
