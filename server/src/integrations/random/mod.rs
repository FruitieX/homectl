use crate::{
    types::{
        color::DeviceColor,
        device::{ControllableState, Device, DeviceData, DeviceId, SensorDevice},
        event::{Event, TxEventChannel},
        integration::{Integration, IntegrationId},
    },
    utils::cli::Cli,
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use ordered_float::OrderedFloat;
use rand::prelude::*;
use serde::Deserialize;
use std::time::Duration;
use tokio::time;

#[derive(Clone, Debug, Deserialize)]
pub struct RandomConfig {
    device_name: String,
    min_brightness: Option<f32>,
    max_brightness: Option<f32>,
    min_saturation: Option<f32>,
    max_saturation: Option<f32>,
    // transition is the number of seconds
    // it takes for the device to transition from one state to another.
    transition: Option<f32>,
    // strobe_interval is the number of milliseconds between
    // each strobe when the device is in strobe mode.
    // If None, defaults to 1000 milliseconds.
    strobe_interval: Option<u64>,
}

pub struct Random {
    id: IntegrationId,
    config: RandomConfig,
    event_tx: TxEventChannel,
    handle: Option<tokio::task::JoinHandle<()>>,
}

impl Clone for Random {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            config: self.config.clone(),
            event_tx: self.event_tx.clone(),
            handle: None,
        }
    }
}

#[async_trait]
impl Integration for Random {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        _cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config: RandomConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Random integration")?;

        Ok(Random {
            id: id.clone(),
            config,
            event_tx,
            handle: None,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_random_device(self);

        self.event_tx.send(Event::ExternalStateUpdate { device });

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        let random = self.clone();

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        // store the join handle in self
        self.handle = Some(tokio::spawn(async { poll_sensor(random).await }));

        Ok(())
    }

    // stop is needed so we can stop the interval tick that 
    // is created by start. 
    async fn stop(&mut self) -> Result<()> {
        if let Some(handle) = &self.handle {
            handle.abort();
        }

        Ok(())
    }

}

fn get_random_color(random: &Random) -> DeviceColor {
    let mut rng = rand::thread_rng();

    // h should be between 0 and 360
    let h: u16 = rng.gen_range(0..360);
    let min_s = random.config.min_saturation.unwrap_or(0.0).clamp(0.2, 1.0);
    let max_s = random.config.max_saturation.unwrap_or(1.0).clamp(0.2, 1.0);
    let s: f32 = rng.gen_range(min_s..=max_s);

    DeviceColor::new_from_hs(h, s)
}

fn get_random_brightness(random: &Random) -> f32 {
    let mut rng = rand::thread_rng();

    let min = random.config.min_brightness.unwrap_or(0.0).clamp(0.0, 1.0);
    let max = random.config.max_brightness.unwrap_or(1.0).clamp(0.0, 1.0);

    rng.gen_range(min..=max)
}

async fn poll_sensor(random: Random) {
    let poll_rate = Duration::from_millis(random.config.strobe_interval.unwrap_or(1000).clamp(20, 10000));
    let mut interval = time::interval(poll_rate);

    loop {
        interval.tick().await;

        let event_tx = random.event_tx.clone();

        let device = mk_random_device(&random);

        event_tx.send(Event::ExternalStateUpdate { device });
    }
}

fn mk_random_device(random: &Random) -> Device {
    let state = DeviceData::Sensor(SensorDevice::Color(ControllableState {
        power: true,
        color: Some(get_random_color(random)),
        brightness: Some(OrderedFloat(get_random_brightness(random))),
        transition: Some(OrderedFloat(
            random.config.transition.unwrap_or(0.6).clamp(0.0, 10.0),
        )),
    }));

    Device {
        id: DeviceId::new("color"),
        name: random.config.device_name.clone(),
        integration_id: random.id.clone(),
        data: state,
        raw: None,
    }
}
