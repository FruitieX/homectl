use crate::homectl_core::{
    device::{Device, DeviceState, Light},
    events::{Message, TxEventChannel},
    integration::{Integration, IntegrationId},
    scene::{color_config_as_lch, ColorConfig},
};
use async_trait::async_trait;
use palette::{Gradient, Lch};
use serde::Deserialize;
use std::{error::Error, time::Duration};
use tokio::time::{interval_at, Instant};

#[derive(Clone, Debug, Deserialize)]
pub struct CircadianConfig {
    device_name: String,
    day_color: ColorConfig,
    day_fade_start: String,
    day_fade_duration_hours: i64,
    night_color: ColorConfig,
    night_fade_start: String,
    night_fade_duration_hours: i64,
}

#[derive(Clone)]
pub struct Circadian {
    id: String,
    config: CircadianConfig,
    sender: TxEventChannel,
    converted_day_color: Lch,
    converted_night_color: Lch,
}

#[async_trait]
impl Integration for Circadian {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Self {
        let config: CircadianConfig = config.clone().try_into().unwrap();

        Circadian {
            id: id.clone(),
            config: config.clone(),
            sender,
            converted_day_color: color_config_as_lch(config.day_color),
            converted_night_color: color_config_as_lch(config.night_color),
        }
    }

    async fn register(&mut self) -> Result<(), Box<dyn Error>> {
        let device = mk_circadian_device(self);

        self.sender
            .send(Message::IntegrationDeviceRefresh { device })
            .unwrap();

        println!("registered circadian integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<(), Box<dyn Error>> {
        println!("started circadian integration {}", self.id);

        let circadian = self.clone();

        // FIXME: can we restructure the integrations / devices systems such
        // that polling is not needed here?
        tokio::spawn(async { poll_sensor(circadian).await });

        Ok(())
    }

    fn set_integration_device_state(&mut self, _device: Device) {
        // do nothing
    }
}

fn get_night_fade(circadian: &Circadian) -> f32 {
    let local = chrono::Local::now().naive_local().time();

    let day_fade_start =
        chrono::NaiveTime::parse_from_str(&circadian.config.day_fade_start, "%H:%M").unwrap();
    let day_fade_duration = chrono::Duration::hours(circadian.config.day_fade_duration_hours);
    let day_fade_end = day_fade_start + day_fade_duration;

    let night_fade_start =
        chrono::NaiveTime::parse_from_str(&circadian.config.night_fade_start, "%H:%M").unwrap();
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

        p
    }
}

fn get_circadian_color(circadian: &Circadian) -> Lch {
    let gradient = Gradient::new(vec![
        circadian.converted_day_color,
        circadian.converted_night_color,
    ]);

    let i = get_night_fade(circadian);

    gradient.get(i)
}

async fn poll_sensor(circadian: Circadian) {
    let poll_rate = Duration::from_millis(60 * 1000);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;

        let sender = circadian.sender.clone();

        let device = mk_circadian_device(&circadian);
        sender.send(Message::SetDeviceState { device }).unwrap();
    }
}

fn mk_circadian_device(circadian: &Circadian) -> Device {
    let state = DeviceState::Light(Light {
        power: true,
        brightness: Some(1.0),
        color: Some(get_circadian_color(circadian)),
    });

    let device = Device {
        id: "color".into(),
        name: circadian.config.device_name.clone(),
        integration_id: circadian.id.clone(),
        scene: None,
        state,
    };

    device
}
