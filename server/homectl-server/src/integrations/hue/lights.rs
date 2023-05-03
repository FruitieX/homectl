use homectl_types::{
    device::{Device, DeviceColor, DeviceState},
    event::{Message, TxEventChannel},
    integration::IntegrationId,
};

use super::bridge::BridgeLights;
use super::{light_utils::bridge_light_to_device, HueConfig};
use anyhow::anyhow;
use palette::{FromColor, Yxy};
use serde::{Deserialize, Serialize};
use std::{error::Error, time::Duration};
use tokio::time;

pub async fn do_refresh_lights(
    config: HueConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
) -> Result<(), Box<dyn Error>> {
    let bridge_lights: BridgeLights = surf::get(&format!(
        "http://{}/api/{}/lights",
        config.addr, config.username
    ))
    .await
    .map_err(|err| anyhow!(err))?
    .body_json()
    .await
    .map_err(|err| anyhow!(err))?;

    for (light_id, bridge_light) in bridge_lights {
        let device = bridge_light_to_device(light_id, integration_id.clone(), bridge_light);

        sender.send(Message::IntegrationDeviceRefresh { device });
    }

    Ok(())
}

pub async fn poll_lights(config: HueConfig, integration_id: IntegrationId, sender: TxEventChannel) {
    let poll_rate = Duration::from_millis(config.poll_rate_lights);
    let mut interval = time::interval(poll_rate);

    loop {
        interval.tick().await;

        let sender = sender.clone();
        let result = do_refresh_lights(config.clone(), integration_id.clone(), sender).await;

        match result {
            Ok(()) => {}
            Err(e) => println!("Error while polling lights: {:?}", e),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OnOffDeviceMsg {
    on: bool,
    transitiontime: Option<u16>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LightMsg {
    on: bool,
    bri: u8,

    #[serde(skip_serializing_if = "Option::is_none")]
    xy: Option<Vec<f32>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    ct: Option<u16>,

    #[serde(skip_serializing_if = "Option::is_none")]
    transitiontime: Option<u16>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum HueMsg {
    OnOffDeviceMsg(OnOffDeviceMsg),
    LightMsg(LightMsg),
}

pub async fn set_device_state(config: HueConfig, device: &Device) -> Result<(), Box<dyn Error>> {
    let body = match &device.state {
        DeviceState::OnOffDevice(state) => Ok(HueMsg::OnOffDeviceMsg(OnOffDeviceMsg {
            on: state.power,
            transitiontime: None,
        })),
        DeviceState::Light(state) => {
            // Hue repserents transition times as multiples of 100 ms
            let transitiontime = state
                .transition_ms
                .map(|transition_ms| ((transition_ms as f64) / 100.0) as u16);

            Ok(match state.color {
                Some(DeviceColor::Hsv(color)) => {
                    let hsv = color;
                    let color: Yxy = Yxy::from_color(color);

                    // palette hue value is [0, 360[, Hue uses [0, 65536[
                    // let hue = ((color.hue.to_positive_degrees() / 360.0) * 65536.0).floor() as u16;

                    // palette sat value is [0, 1], Hue uses [0, 254]
                    // let sat = (f32::min(color.saturation * 254.0, 1.0)).floor() as u16;

                    // palette bri value is [0, 1], Hue uses [0, 254]
                    // let bri = (f32::min(color.value, 1.0) * 254.0).floor() as u16;

                    let x = color.x;
                    let y = color.y;

                    let xy = Some(vec![x, y]);
                    // let bri = (color.luma * 254.0 * state.brightness.unwrap_or(1.0) as f32).floor()
                    //     as u32;
                    let bri = (hsv.value * 254.0 * state.brightness.unwrap_or(1.0)).floor() as u8;

                    HueMsg::LightMsg(LightMsg {
                        on: state.power,
                        xy,
                        ct: None,
                        bri,
                        transitiontime,
                    })
                }
                Some(DeviceColor::Cct(ref ct)) => {
                    let bri = (254.0 * state.brightness.unwrap_or(1.0)).floor() as u8;

                    HueMsg::LightMsg(LightMsg {
                        on: state.power,
                        xy: None,
                        ct: Some(f32::floor(1000000.0 / ct.get_cct()) as u16),
                        bri,
                        transitiontime,
                    })
                }
                None => HueMsg::OnOffDeviceMsg(OnOffDeviceMsg {
                    on: state.power,
                    transitiontime,
                }),
            })
        }
        DeviceState::Sensor(_) => {
            // Do nothing
            return Ok(());
        }
        _ => Err(format!(
            "Unsupported device type encountered in hue set_device_state: {:?}",
            device.state
        )),
    }?;

    // println!("setting light \"{}\" state: {:?}", device.name, serde_json::to_string(&body));

    surf::put(&format!(
        "http://{}/api/{}/{}/state",
        config.addr, config.username, device.id
    ))
    .body(surf::Body::from_json(&body).map_err(|err| anyhow!(err))?)
    .await
    .map_err(|err| anyhow!(err))?
    .body_string()
    .await
    .map_err(|err| anyhow!(err))?;

    Ok(())
}
