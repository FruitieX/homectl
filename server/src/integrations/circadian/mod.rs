use crate::core::automation::sources::circadian_compat::{
    CircadianCompatCurve, CIRCADIAN_COMPAT_TRANSITION_MS,
};
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
    /// The shared pure curve (P11). Constructed through the legacy
    /// constructor so historical configs keep their exact behavior.
    curve: CircadianCompatCurve,
    event_tx: TxEventChannel,
    tasks: tokio::task::JoinSet<()>,
}

fn mk_curve(config: &CircadianConfig) -> CircadianCompatCurve {
    CircadianCompatCurve::new(
        config.day_fade_start,
        chrono::Duration::hours(config.day_fade_duration_hours),
        config.day_color.clone(),
        config.day_brightness,
        config.night_fade_start,
        chrono::Duration::hours(config.night_fade_duration_hours),
        config.night_color.clone(),
        config.night_brightness,
    )
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
        let curve = mk_curve(&config);

        Ok(Circadian {
            id: id.clone(),
            config: config.clone(),
            curve,
            event_tx,
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
            curve: self.curve.clone(),
            event_tx: self.event_tx.clone(),
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
    mk_circadian_device_at(circadian, chrono::Local::now().naive_local().time())
}

fn mk_circadian_device_at(circadian: &Circadian, local: chrono::NaiveTime) -> Device {
    let profile = circadian.curve.profile_at(local);
    let state = DeviceData::Sensor(SensorDevice::Color(ControllableState {
        power: true,
        color: profile.color,
        brightness: profile.brightness,
        transition: Some(OrderedFloat(CIRCADIAN_COMPAT_TRANSITION_MS as f32 / 1000.0)),
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
        let curve = mk_curve(&config);
        Circadian {
            id: IntegrationId::from("circadian".to_string()),
            config,
            curve,
            event_tx,
            tasks: tokio::task::JoinSet::new(),
        }
    }

    /// B06/D01: the integration delegates to the shared pure curve, so the
    /// legacy adapter and the v2 preset cannot drift. Curve goldens live in
    /// `core::automation::sources::circadian_compat`.
    #[test]
    fn b06_circadian_device_matches_shared_curve() {
        let circadian = circadian_with(config());
        let device = mk_circadian_device_at(&circadian, time(12, 0));

        assert_eq!(device.id, DeviceId::new("color"));
        assert_eq!(device.integration_id, circadian.id);
        let DeviceData::Sensor(SensorDevice::Color(state)) = device.data else {
            panic!("expected a color sensor");
        };
        assert!(state.power);
        assert_eq!(state.transition, Some(OrderedFloat(POLL_RATE)));
        assert_eq!(state.color, Some(DeviceColor::new_from_kelvin(3000)));
        assert_eq!(state.brightness, Some(OrderedFloat(0.8)));

        // Night: the night color and brightness apply.
        let night = mk_circadian_device_at(&circadian, time(23, 0));
        let DeviceData::Sensor(SensorDevice::Color(state)) = night.data else {
            panic!("expected a color sensor");
        };
        assert_eq!(state.color, Some(DeviceColor::new_from_kelvin(2000)));
        assert_eq!(state.brightness, Some(OrderedFloat(0.2)));
    }
}
