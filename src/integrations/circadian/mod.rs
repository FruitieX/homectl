use crate::homectl_core::{device::{Device, DeviceColor, DeviceState, Light}, events::{Message, TxEventChannel}, integration::{Integration, IntegrationActionPayload, IntegrationId}, scene::{color_config_as_device_color, ColorConfig}};
use anyhow::{Context, Result};
use async_std::{stream, task};
use async_trait::async_trait;
use async_std::prelude::*;
use palette::Gradient;
use serde::Deserialize;
use std::time::Duration;
use crate::utils::from_hh_mm;

#[derive(Clone, Debug, Deserialize)]
pub struct CircadianConfig {
    device_name: String,

    #[serde(deserialize_with = "from_hh_mm")]
    day_fade_start: chrono::NaiveTime,
    day_fade_duration_hours: i64,
    day_color: ColorConfig,

    #[serde(deserialize_with = "from_hh_mm")]
    night_fade_start: chrono::NaiveTime,
    night_fade_duration_hours: i64,
    night_color: ColorConfig,
}

#[derive(Clone)]
pub struct Circadian {
    id: String,
    config: CircadianConfig,
    sender: TxEventChannel,
    converted_day_color: DeviceColor,
    converted_night_color: DeviceColor,
}

#[async_trait]
impl Integration for Circadian {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Result<Self> {
        let config: CircadianConfig = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Circadian integration")?;

        Ok(Circadian {
            id: id.clone(),
            config: config.clone(),
            sender,
            converted_day_color: color_config_as_device_color(config.day_color),
            converted_night_color: color_config_as_device_color(config.night_color),
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_circadian_device(self);

        self.sender
            .send(Message::IntegrationDeviceRefresh { device });

        println!("registered circadian integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started circadian integration {}", self.id);

        let circadian = self.clone();

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        task::spawn(async { poll_sensor(circadian).await });

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

fn get_night_fade(circadian: &Circadian) -> f32 {
    let local = chrono::Local::now().naive_local().time();

    let day_fade_start = circadian.config.day_fade_start;
    let day_fade_duration = chrono::Duration::hours(circadian.config.day_fade_duration_hours);
    let day_fade_end = day_fade_start + day_fade_duration;

    let night_fade_start = circadian.config.night_fade_start;
    let night_fade_duration = chrono::Duration::hours(circadian.config.night_fade_duration_hours);
    let night_fade_end = night_fade_start + night_fade_duration;

    if local <= day_fade_start || local >= night_fade_end {
        return 1.0;
    }
    if local >= day_fade_end && local <= night_fade_start {
        return 0.0;
    }

    if local < day_fade_end {
        // fading from night to day
        let d = local - day_fade_start;
        let p = d.num_milliseconds() as f32 / day_fade_duration.num_milliseconds() as f32;

        1.0 - p
    } else {
        // fading from day to night
        let d = local - night_fade_start;
        
        d.num_milliseconds() as f32 / night_fade_duration.num_milliseconds() as f32
    }
}

fn get_circadian_color(circadian: &Circadian) -> DeviceColor {
    let gradient = Gradient::new(vec![
        circadian.converted_day_color,
        circadian.converted_night_color,
    ]);

    let i = get_night_fade(circadian);

    gradient.get(i)
}

async fn poll_sensor(circadian: Circadian) {
    let poll_rate = Duration::from_millis(60 * 1000);
    let mut interval = stream::interval(poll_rate);

    loop {
        interval.next().await;

        let sender = circadian.sender.clone();

        let device = mk_circadian_device(&circadian);
        sender.send(Message::SetDeviceState { device, set_scene: false });
    }
}

fn mk_circadian_device(circadian: &Circadian) -> Device {
    let state = DeviceState::Light(Light {
        power: true,
        brightness: Some(1.0),
        color: Some(get_circadian_color(circadian)),
    });

    Device {
        id: "color".into(),
        name: circadian.config.device_name.clone(),
        integration_id: circadian.id.clone(),
        scene: None,
        state,
        locked: false
    }
}
