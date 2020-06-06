use super::HueConfig;
use crate::homectl_core::{
    device::{Device, DeviceKind, Light},
    events::{Message, TxEventChannel},
    integration::IntegrationId,
};
use std::time::Duration;
use tokio::time::{interval_at, Instant};

pub async fn poll_sensors(
    config: HueConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
) {
    let poll_rate = Duration::from_millis(config.poll_rate_sensors);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;
        println!("would poll sensors");

        let kind = Light {
            power: true,
            brightness: Some(1.0),
            color: None,
        };

        let device = Device {
            id: String::from("test"),
            name: String::from("Test sensor"),
            integration_id: integration_id.clone(),
            scene: None,
            kind: DeviceKind::Light(kind),
        };

        sender.send(Message::DeviceRefresh { device }).unwrap();
    }
}
