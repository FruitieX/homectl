use crate::types::{
    color::DeviceColor,
    device::{ControllableState, Device, DeviceData, DeviceId, SensorDevice},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
};
use crate::utils::from_hh_mm;
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use palette::Mix;
use serde::Deserialize;
use std::time::Duration;
use tokio::time;

#[derive(Clone, Debug, Deserialize)]
pub struct CircadianConfig {
    device_name: String,

    #[serde(deserialize_with = "from_hh_mm")]
    day_fade_start: chrono::NaiveTime,
    day_fade_duration_hours: i64,
    day_color: DeviceColor,
    day_brightness: Option<f32>,

    #[serde(deserialize_with = "from_hh_mm")]
    night_fade_start: chrono::NaiveTime,
    night_fade_duration_hours: i64,
    night_color: DeviceColor,
    night_brightness: Option<f32>,
}

#[derive(Clone)]
pub struct Circadian {
    id: IntegrationId,
    config: CircadianConfig,
    event_tx: TxEventChannel,
    converted_day_color: DeviceColor,
    converted_night_color: DeviceColor,
}

#[async_trait]
impl Integration for Circadian {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config: CircadianConfig = config
            .clone()
            .try_deserialize()
            .wrap_err("Failed to deserialize config of Circadian integration")?;

        Ok(Circadian {
            id: id.clone(),
            config: config.clone(),
            event_tx,
            converted_day_color: config.day_color,
            converted_night_color: config.night_color,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_circadian_device(self);

        self.event_tx.send(Message::RecvDeviceState { device });

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        let circadian = self.clone();

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        tokio::spawn(async { poll_sensor(circadian).await });

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

        let p = d.num_milliseconds() as f32 / night_fade_duration.num_milliseconds() as f32;
        f32::sin(p * std::f32::consts::PI / 2.0)
    }
}

fn get_circadian_color(circadian: &Circadian) -> DeviceColor {
    match (
        circadian.converted_day_color.clone(),
        circadian.converted_night_color.clone(),
    ) {
        (DeviceColor::Hs(day), DeviceColor::Hs(night)) => {
            let i = get_night_fade(circadian);
            let day = palette::Hsv::new(day.h as f32, day.s, 1.0);
            let night = palette::Hsv::new(night.h as f32, night.s, 1.0);
            let color = day.mix(night, i);

            color.into()
        }
        (DeviceColor::Ct(_), DeviceColor::Ct(_)) => todo!(),
        _ => panic!("Mixed color types not supported"),
    }
}

fn get_circadian_brightness(circadian: &Circadian) -> Option<f32> {
    match (
        circadian.config.day_brightness,
        circadian.config.night_brightness,
    ) {
        (Some(day), Some(night)) => {
            let i = get_night_fade(circadian);

            let brightness = (1.0 - i) * day + i * night;

            Some(brightness)
        }
        (_, _) => None,
    }
}

static POLL_RATE: u64 = 60 * 1000;

async fn poll_sensor(circadian: Circadian) {
    let poll_rate = Duration::from_millis(POLL_RATE);
    let mut interval = time::interval(poll_rate);

    loop {
        interval.tick().await;

        let event_tx = circadian.event_tx.clone();

        let device = mk_circadian_device(&circadian);

        event_tx.send(Message::SetExpectedState {
            device,
            set_scene: false,
            skip_send: false,
        });
    }
}

fn mk_circadian_device(circadian: &Circadian) -> Device {
    let state = DeviceData::Sensor(SensorDevice::Color(ControllableState {
        power: true,
        color: Some(get_circadian_color(circadian)),
        brightness: get_circadian_brightness(circadian),
        transition_ms: Some(POLL_RATE),
    }));

    Device {
        id: DeviceId::new("color"),
        name: circadian.config.device_name.clone(),
        integration_id: circadian.id.clone(),
        data: state,
    }
}
