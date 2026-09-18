use crate::utils::from_hh_mm;
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
use palette::{IntoColor, Mix};
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

pub struct Circadian {
    id: IntegrationId,
    config: CircadianConfig,
    event_tx: TxEventChannel,
    converted_day_color: DeviceColor,
    converted_night_color: DeviceColor,
    tasks: tokio::task::JoinSet<()>,
}

#[async_trait]
impl Integration for Circadian {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        _cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config: CircadianConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Circadian integration")?;

        Ok(Circadian {
            id: id.clone(),
            config: config.clone(),
            event_tx,
            converted_day_color: config.day_color,
            converted_night_color: config.night_color,
            tasks: tokio::task::JoinSet::new(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_circadian_device(self);

        self.event_tx.send(Event::ExternalStateUpdate {
            device,
            integration_epoch: None,
        });

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        self.stop().await?;
        let circadian = Circadian {
            id: self.id.clone(),
            config: self.config.clone(),
            event_tx: self.event_tx.clone(),
            converted_day_color: self.converted_day_color.clone(),
            converted_night_color: self.converted_night_color.clone(),
            tasks: tokio::task::JoinSet::new(),
        };

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        self.tasks.spawn(async { poll_sensor(circadian).await });

        Ok(())
    }
    async fn stop(&mut self) -> Result<()> {
        self.tasks.shutdown().await;
        Ok(())
    }
}

fn get_night_fade(circadian: &Circadian) -> f32 {
    night_fade_at(chrono::Local::now().naive_local().time(), &circadian.config)
}

/// Pure variant of the night-fade curve with an injected local time. The
/// behavior is byte-for-byte the original curve; P00 only extracts it so it
/// can be characterized deterministically before P11 builds a source on it.
pub(crate) fn night_fade_at(local: chrono::NaiveTime, config: &CircadianConfig) -> f32 {
    let day_fade_start = config.day_fade_start;
    let day_fade_duration = chrono::Duration::hours(config.day_fade_duration_hours);
    let day_fade_end = day_fade_start + day_fade_duration;

    let night_fade_start = config.night_fade_start;
    let night_fade_duration = chrono::Duration::hours(config.night_fade_duration_hours);
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
    circadian_color_at(
        get_night_fade(circadian),
        &circadian.converted_day_color,
        &circadian.converted_night_color,
    )
}

/// Pure color mixing with an injected night-fade factor. Extracted from
/// `get_circadian_color` without changing behavior.
pub(crate) fn circadian_color_at(
    i: f32,
    day_color: &DeviceColor,
    night_color: &DeviceColor,
) -> DeviceColor {
    match (day_color.clone(), night_color.clone()) {
        (DeviceColor::Hs(day), DeviceColor::Hs(night)) => {
            let day = palette::Hsv::new(day.h as f32, *day.s, 1.0);
            let night = palette::Hsv::new(night.h as f32, *night.s, 1.0);
            let color = day.mix(night, i);

            color.into()
        }
        (DeviceColor::Ct(day), DeviceColor::Ct(night)) => {
            let ct = ((1.0 - i) * day.ct as f32 + i * night.ct as f32)
                .round()
                .clamp(0.0, u16::MAX as f32) as u16;
            DeviceColor::new_from_ct(ct)
        }
        (day, night) => {
            let day_yxy: palette::Yxy = (&day).into();
            let night_yxy: palette::Yxy = (&night).into();
            let day: palette::Hsv = day_yxy.into_color();
            let night: palette::Hsv = night_yxy.into_color();

            day.mix(night, i).into()
        }
    }
}

fn get_circadian_brightness(circadian: &Circadian) -> Option<f32> {
    circadian_brightness_at(
        get_night_fade(circadian),
        circadian.config.day_brightness,
        circadian.config.night_brightness,
    )
}

/// Pure brightness interpolation with an injected night-fade factor. Extracted
/// from `get_circadian_brightness` without changing behavior.
pub(crate) fn circadian_brightness_at(
    i: f32,
    day_brightness: Option<f32>,
    night_brightness: Option<f32>,
) -> Option<f32> {
    match (day_brightness, night_brightness) {
        (Some(day), Some(night)) => Some((1.0 - i) * day + i * night),
        (_, _) => None,
    }
}

static POLL_RATE: f32 = 60.0;

async fn poll_sensor(circadian: Circadian) {
    let poll_rate = Duration::from_secs_f32(POLL_RATE);
    let mut interval = time::interval(poll_rate);

    loop {
        interval.tick().await;

        let event_tx = circadian.event_tx.clone();

        let device = mk_circadian_device(&circadian);

        event_tx.send(Event::SetInternalState {
            device,
            skip_external_update: None,
            skip_db_update: None,
            origin: Some(crate::types::automation_event::EventOrigin::Derived),
            causation: None,
            integration_epoch: None,
        });
    }
}

fn mk_circadian_device(circadian: &Circadian) -> Device {
    let state = DeviceData::Sensor(SensorDevice::Color(ControllableState {
        power: true,
        color: Some(get_circadian_color(circadian)),
        brightness: get_circadian_brightness(circadian).map(OrderedFloat),
        transition: Some(OrderedFloat(POLL_RATE)),
    }));

    Device {
        id: DeviceId::new("color"),
        name: circadian.config.device_name.clone(),
        integration_id: circadian.id.clone(),
        data: state,
        raw: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::event::mk_event_channel;

    fn time(hour: u32, minute: u32) -> chrono::NaiveTime {
        chrono::NaiveTime::from_hms_opt(hour, minute, 0).unwrap()
    }

    fn config() -> CircadianConfig {
        CircadianConfig {
            device_name: "Circadian".into(),
            day_fade_start: time(6, 0),
            day_fade_duration_hours: 2,
            day_color: DeviceColor::new_from_ct(3000),
            day_brightness: Some(0.8),
            night_fade_start: time(20, 0),
            night_fade_duration_hours: 2,
            night_color: DeviceColor::new_from_ct(2000),
            night_brightness: Some(0.2),
        }
    }

    fn circadian_with(config: CircadianConfig) -> Circadian {
        let (event_tx, _rx) = mk_event_channel();
        Circadian {
            id: IntegrationId::from("circadian".to_string()),
            converted_day_color: config.day_color.clone(),
            converted_night_color: config.night_color.clone(),
            config,
            event_tx,
            tasks: tokio::task::JoinSet::new(),
        }
    }

    /// B06: golden samples of the legacy fade curve at fixed injected times.
    #[test]
    fn b06_circadian_night_fade_samples() {
        let config = config();
        assert_eq!(night_fade_at(time(3, 0), &config), 1.0);
        assert!((night_fade_at(time(7, 0), &config) - 0.5).abs() < 1e-6);
        assert_eq!(night_fade_at(time(12, 0), &config), 0.0);
        assert!((night_fade_at(time(21, 0), &config) - 2f32.sqrt() / 2.0).abs() < 1e-6);
        assert_eq!(night_fade_at(time(23, 0), &config), 1.0);
    }

    /// B06: color/brightness mapping preserved, including optional brightness.
    #[test]
    fn b06_circadian_color_and_brightness_mapping() {
        let day = DeviceColor::new_from_ct(3000);
        let night = DeviceColor::new_from_ct(2000);
        assert_eq!(
            circadian_color_at(0.5, &day, &night),
            DeviceColor::new_from_ct(2500)
        );

        assert_eq!(
            circadian_brightness_at(0.5, Some(0.8), Some(0.2)),
            Some(0.5)
        );
        assert_eq!(circadian_brightness_at(0.5, Some(0.8), None), None);
        assert_eq!(circadian_brightness_at(0.5, None, None), None);
    }

    /// B06: the synthetic color sensor's shape (id, transition, power) is the
    /// compatibility adapter the v2 computed source must reproduce.
    #[test]
    fn b06_circadian_synthetic_device_shape() {
        let circadian = circadian_with(config());
        let device = mk_circadian_device(&circadian);

        assert_eq!(device.id, DeviceId::new("color"));
        assert_eq!(device.integration_id, circadian.id);
        let DeviceData::Sensor(SensorDevice::Color(state)) = device.data else {
            panic!("expected a color sensor");
        };
        assert!(state.power);
        assert_eq!(state.transition, Some(OrderedFloat(POLL_RATE)));
        assert!(state.brightness.is_some());
        assert!(state.color.is_some());
    }
}
