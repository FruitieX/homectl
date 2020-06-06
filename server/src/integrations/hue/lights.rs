use crate::homectl_core::{
    device::{Device, DeviceKind, Light},
    events::{Message, TxEventChannel},
    integration::IntegrationId,
};

use super::bridge::BridgeLights;
use super::{utils::hue_to_palette, HueConfig};
use std::{error::Error, time::Duration};
use tokio::time::{interval_at, Instant};

pub async fn do_refresh_lights(
    config: HueConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
) -> Result<(), Box<dyn Error>> {
    let bridge_lights: BridgeLights = reqwest::get(&format!(
        "http://{}/api/{}/lights",
        config.addr, config.username
    ))
    .await?
    .json()
    .await?;

    for (light_id, bridge_light) in bridge_lights {
        let kind = Light {
            power: bridge_light.state.on,
            brightness: None,
            color: hue_to_palette(bridge_light.clone()),
        };

        let device = Device {
            id: light_id,
            name: bridge_light.name.clone(),
            integration_id: integration_id.clone(),
            scene: None,
            kind: DeviceKind::Light(kind),
        };

        sender.send(Message::DeviceRefresh { device }).unwrap();
    }

    Ok(())
}

pub async fn poll_lights(config: HueConfig, integration_id: IntegrationId, sender: TxEventChannel) {
    let poll_rate = Duration::from_millis(config.poll_rate_lights);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;
        println!("would poll lights");

        let sender = sender.clone();
        let result = do_refresh_lights(config.clone(), integration_id.clone(), sender).await;

        match result {
            Ok(()) => {}
            Err(e) => println!("Error while polling lights: {:?}", e),
        }
    }
}
