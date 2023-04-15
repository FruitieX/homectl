use anyhow::{anyhow, Context, Result};
use homectl_types::device::{CorrelatedColorTemperature, DeviceColor};
use homectl_types::utils::{cct_to_rgb, xy_to_cct};
use homectl_types::{
    device::{Device, DeviceId, DeviceState, Light},
    integration::IntegrationId,
};
use palette::{Hsv, Yxy};
use rust_async_tuyapi::{tuyadevice::TuyaDevice, Payload, PayloadStruct};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::IpAddr,
    str::FromStr,
    time::{Duration, SystemTime},
};

use super::{Connection, TuyaDeviceConfig};

const POWER_ON_FIELD: &str = "20";
const MODE_FIELD: &str = "21";
const BRIGHTNESS_FIELD: &str = "22";
const COLOR_TEMP_FIELD: &str = "23";
const COLOR_FIELD: &str = "24";

fn hsv_to_tuya(power: bool, brightness: Option<f32>, hsv: Hsv) -> TuyaState {
    let hue: f32 = hsv.hue.to_positive_degrees();
    let saturation = (hsv.saturation as f32) * 1000.0;
    let value = brightness.unwrap_or(1.0) * (hsv.value as f32) * 1000.0;
    let tuya_color_string = format!(
        "{:0>4x}{:0>4x}{:0>4x}",
        hue as i32, saturation as i32, value as i32
    );

    TuyaState {
        power_on: power,
        color: Some(tuya_color_string),
        brightness: None,
        color_temperature: None,
    }
}

fn ct_to_tuya(power: bool, brightness: Option<f32>, ct: f32) -> TuyaState {
    // Range of my bulbs is from 2700K - 4100K (and they express this as a
    // 0-1000 range), this is very likely not true for all Tuya bulbs
    let min_supported_temp = 2700.0;
    let max_supported_temp = 4100.0;

    // Scale the value into 0.0 - 1.0 range
    let q = (ct - min_supported_temp) / (max_supported_temp - min_supported_temp);
    let q = q.clamp(0.0, 1.0);

    // Scale the value into 0 - 1000 range
    let color_temperature = f32::floor(q * 1000.0) as u32;

    // Brightness goes from 10 to 1000 ¯\_(ツ)_/¯
    let brightness = brightness.map(|bri| f32::floor(bri * 990.0) as u32 + 10);

    TuyaState {
        power_on: power,
        color: None,
        brightness,
        color_temperature: Some(color_temperature),
    }
}

fn power_to_tuya(power: bool) -> TuyaState {
    TuyaState {
        power_on: power,
        brightness: None,
        color_temperature: None,
        color: None,
    }
}

#[derive(Debug)]
struct TuyaState {
    power_on: bool,
    brightness: Option<u32>,
    color_temperature: Option<u32>,
    color: Option<String>,
}

fn to_tuya_state(device: &Device, device_config: &TuyaDeviceConfig) -> Result<TuyaState> {
    let light_state = match device.state.clone() {
        DeviceState::Light(Light {
            brightness,
            color,
            power,
            transition_ms,
        }) => Ok(Light {
            power,
            brightness,
            color,
            transition_ms,
        }),
        _ => Err(anyhow!("Unsupported device state")),
    }?;

    // TODO: do this kind of conversion for the integrations in homectl core
    match light_state.color {
        Some(DeviceColor::Hsv(color)) => {
            if device_config.color_field.is_some() {
                // Received color and device supports color
                let state = hsv_to_tuya(light_state.power, light_state.brightness, color);
                Ok(state)
            } else if device_config.color_temp_field.is_some() {
                // Received color but device only supports color temperature, do conversion
                let xy: Yxy = color.into();
                let ct = xy_to_cct(&xy);

                let brightness = color.value * light_state.brightness.unwrap_or(1.0);
                let state = ct_to_tuya(light_state.power, Some(brightness), ct);
                Ok(state)
            } else {
                // No color support at all
                Ok(power_to_tuya(light_state.power))
            }
        }
        Some(DeviceColor::Cct(cct)) => {
            if device_config.color_temp_field.is_some() {
                // Received color temperature and device supports color temperatures
                let state = ct_to_tuya(light_state.power, light_state.brightness, cct.get_cct());

                Ok(state)
            } else if device_config.color_field.is_some() {
                // Received color temperature but device only supports colors, do conversion
                let rgb = cct_to_rgb(cct.get_cct());
                let hsv: Hsv = rgb.into();
                let state = hsv_to_tuya(light_state.power, light_state.brightness, hsv);

                Ok(state)
            } else {
                // No color support at all
                Ok(power_to_tuya(light_state.power))
            }
        }
        None => {
            // Brightness goes from 10 to 1000 ¯\_(ツ)_/¯
            let brightness = light_state
                .brightness
                .map(|bri| f32::floor(bri * 990.0) as u32 + 10);

            Ok(TuyaState {
                power_on: light_state.power,
                color: None,
                brightness,
                color_temperature: None,
            })
        }
    }
}

pub fn create_tuya_device(
    device_id: &DeviceId,
    device_config: &TuyaDeviceConfig,
) -> Result<TuyaDevice> {
    Ok(TuyaDevice::new(
        &device_config
            .version
            .clone()
            .unwrap_or_else(|| String::from("v3.3")),
        &device_id.to_string(),
        Some(&device_config.local_key),
        IpAddr::from_str(&device_config.ip).unwrap(),
    )?)
}

pub async fn ensure_tuya_connection(
    device_id: &DeviceId,
    device_config: &TuyaDeviceConfig,
    connections: &HashMap<DeviceId, Connection>,
) -> Result<()> {
    let mut connection = connections.get(device_id).unwrap().write().await;

    match &*connection {
        Some(_) => {}
        None => {
            let mut tuya_device = create_tuya_device(device_id, device_config)?;
            tuya_device.connect().await?;
            *connection = Some(tuya_device);
        }
    }

    Ok(())
}

pub async fn terminate_tuya_connection(
    device_id: &DeviceId,
    connections: &HashMap<DeviceId, Connection>,
) -> Result<()> {
    let mut connection = connections.get(device_id).unwrap().write().await;
    *connection = None;

    Ok(())
}

pub async fn set_tuya_state(
    device: &Device,
    device_config: &TuyaDeviceConfig,
    connections: &HashMap<DeviceId, Connection>,
) -> Result<()> {
    // println!("setting tuya state: {:?} {}", device.state, device.name);
    let tuya_state = to_tuya_state(device, device_config)?;

    ensure_tuya_connection(&device.id, device_config, connections)
        .await
        .ok();

    let mut tuya_device = connections.get(&device.id).unwrap().write().await;
    let tuya_device = tuya_device
        .as_mut()
        .context(anyhow!("Expected connected Tuya device"))?;

    {
        let mut dps = HashMap::new();
        dps.insert(POWER_ON_FIELD.to_string(), json!(tuya_state.power_on));

        match device.state.get_color() {
            Some(DeviceColor::Hsv(_)) => {
                if let (Some(field), Some(color)) =
                    (device_config.color_field.clone(), tuya_state.color)
                {
                    dps.insert(field, json!(color));
                    dps.insert(MODE_FIELD.to_string(), json!("colour"));
                }
            }
            Some(DeviceColor::Cct(_)) => {
                if let (Some(field), Some(brightness)) = (
                    device_config.brightness_field.clone(),
                    tuya_state.brightness,
                ) {
                    dps.insert(field, json!(brightness));
                }

                if let (Some(field), Some(ct)) = (
                    device_config.color_temp_field.clone(),
                    tuya_state.color_temperature,
                ) {
                    dps.insert(field, json!(ct));
                }
                dps.insert(MODE_FIELD.to_string(), json!("white"));
            }
            None => {}
        }

        tokio::time::timeout(Duration::from_millis(3000), tuya_device.set_values(dps)).await??
    }

    Ok(())
}

type TuyaDps = HashMap<String, serde_json::Value>;

#[derive(Deserialize)]
struct TuyaThreeFourPayload {
    dps: Option<TuyaDps>,
}

pub async fn get_tuya_state(
    device_id: &DeviceId,
    integration_id: &IntegrationId,
    device_config: &TuyaDeviceConfig,
    connections: &HashMap<DeviceId, Connection>,
) -> Result<Device> {
    let current_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs() as u32;

    ensure_tuya_connection(device_id, device_config, connections)
        .await
        .ok();

    let response = {
        let mut tuya_device = connections.get(device_id).unwrap().write().await;
        let tuya_device = tuya_device
            .as_mut()
            .context(anyhow!("Expected connected Tuya device"))?;

        // Create the payload to be sent, this will be serialized to the JSON format
        let payload = Payload::Struct(PayloadStruct {
            dev_id: device_id.to_string(),
            gw_id: Some(device_id.to_string()),
            uid: Some(device_id.to_string()),
            t: Some(current_time.to_string()),
            dp_id: None,
            dps: Some(HashMap::new()),
        });

        tokio::time::timeout(Duration::from_millis(5000), tuya_device.get(payload))
            .await?
            .context(format!("Error while polling {}", device_config.name))?
    };

    let first = response
        .first()
        .context("Could not find valid Tuya Message in response")?;

    let dps = match &first.payload {
        Payload::Struct(s) => s.dps.clone(),
        Payload::String(s) => match device_config.version.as_deref() {
            Some("3.4") => {
                let payload: Option<TuyaThreeFourPayload> = serde_json::from_str(s).ok();
                payload.and_then(|p| p.dps)
            }
            _ => {
                let dps: Option<TuyaDps> = serde_json::from_str(s).ok();
                dps
            }
        },
        _ => return Err(anyhow!("Unexpected Tuya device state struct")),
    };

    if let Some(dps) = &dps {
        let power = if let Some(Value::Bool(value)) = dps.get(POWER_ON_FIELD) {
            *value
        } else {
            true
        };

        let mode = dps.get(MODE_FIELD);
        let color = match mode {
            Some(Value::String(s)) if s == "white" => {
                if let Some(field) = &device_config.color_temp_field {
                    if let Some(Value::Number(value)) = dps.get(field) {
                        // Range of my bulbs is from 2700K - 4100K (and they express this as a
                        // 0-1000 range), this is very likely not true for all Tuya bulbs
                        let min_supported_temp = 2700.0;
                        let max_supported_temp = 4100.0;

                        let ct = value.as_u64().unwrap_or(1000);

                        // Scale range to 0-1
                        let q = ct as f32 / 1000.0;

                        let cct =
                            q * (max_supported_temp - min_supported_temp) + min_supported_temp;
                        Some(DeviceColor::Cct(CorrelatedColorTemperature::new(
                            cct,
                            min_supported_temp..max_supported_temp,
                        )))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            Some(Value::String(s)) if s == "colour" => {
                if let Some(field) = &device_config.color_field {
                    if let Some(Value::String(value)) = dps.get(field) {
                        let h = i32::from_str_radix(&value[0..4], 16)?;
                        let s = i32::from_str_radix(&value[4..8], 16)?;
                        Some(DeviceColor::Hsv(Hsv::new(h as f32, s as f32 / 1000., 1.)))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            _ => None,
        };

        let brightness = match mode {
            Some(Value::String(s)) if s == "white" => {
                if let Some(Value::Number(value)) = dps.get(BRIGHTNESS_FIELD) {
                    // Brightness goes from 10 to 1000 ¯\_(ツ)_/¯
                    let bri = value.as_u64().unwrap_or(1000);

                    // Scale range to 0-990
                    let bri = bri - 10;

                    // Scale range to 0-1
                    Some(bri as f32 / 990.0)
                } else {
                    None
                }
            }
            Some(Value::String(s)) if s == "colour" => {
                if let Some(field) = &device_config.color_field {
                    if let Some(Value::String(value)) = dps.get(field) {
                        Some(i32::from_str_radix(&value[8..12], 16)? as f32 / 1000.0)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            _ => None,
        };

        let state = DeviceState::Light(Light::new(power, brightness, color, Some(1000)));

        let device = Device {
            id: device_id.clone(),
            name: device_config.name.clone(),
            integration_id: integration_id.clone(),
            scene: None,
            state,
        };

        Ok(device)
    } else {
        Err(anyhow!(
            "Unsupported Tuya response in get_tuya_state: {:?}",
            first.payload
        ))
    }
}
