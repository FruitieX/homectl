use crate::homectl_core::{
    device::{Device, DeviceColor, DeviceState, Light},
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
};
use async_trait::async_trait;
use palette::rgb::Rgb;
use rand::prelude::*;
use serde::Deserialize;
use std::{error::Error, time::Duration};
use tokio::time::{interval_at, Instant};

#[derive(Clone, Debug, Deserialize)]
pub struct RandomConfig {
    device_name: String,
}

#[derive(Clone)]
pub struct Random {
    id: String,
    config: RandomConfig,
    sender: TxEventChannel,
}

#[async_trait]
impl Integration for Random {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Self {
        let config: RandomConfig = config.clone().try_into().unwrap();

        Random {
            id: id.clone(),
            config: config.clone(),
            sender,
        }
    }

    async fn register(&mut self) -> Result<(), Box<dyn Error>> {
        let device = mk_random_device(self);

        self.sender
            .send(Message::IntegrationDeviceRefresh { device })
            .unwrap();

        println!("registered random integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<(), Box<dyn Error>> {
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

        let sender = random.sender.clone();

        let device = mk_random_device(&random);
        sender.send(Message::SetDeviceState { device }).unwrap();
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
