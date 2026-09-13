//! ESPHome MQTT JSON light protocol boundary.
//!
//! This intentionally targets ESPHome's normal MQTT light topic convention,
//! rather than trying to express the protocol as generic JSON pointers.

use color_eyre::eyre::{eyre, Result};
use serde_json::{json, Value};

use super::MqttConfig;
use crate::types::{
    color::{Capabilities, DeviceColor},
    device::{ControllableDevice, Device, DeviceData, DeviceId},
    integration::IntegrationId,
};

fn channel(value: &serde_json::Map<String, Value>, key: &str) -> Option<u8> {
    channel_value(value.get(key)?)
}

fn configured_range(config: &MqttConfig) -> (u16, u16) {
    (
        config.esphome_warm_white_kelvin.unwrap_or(2700),
        config.esphome_cold_white_kelvin.unwrap_or(6500),
    )
}

fn state_device_id(config: &MqttConfig, topic: &str) -> Option<String> {
    let base = config.esphome_base_topic.as_deref().unwrap_or("esphome");
    let object_id = config.esphome_light_object_id.as_deref().unwrap_or("light");
    let prefix = format!("{base}/");
    let suffix = format!("/light/{object_id}/state");
    let id = topic.strip_prefix(&prefix)?.strip_suffix(&suffix)?;
    (!id.is_empty() && id != "discover" && !id.contains('/')).then_some(id.to_owned())
}

/// Convert ESPHome's CWWW state channels into homectl's Kelvin representation.
///
/// ESPHome's `c` channel is cold white and `w` is warm white. Its light call
/// maps color temperature linearly in mired space, so the channel ratio is
/// sufficient even when `constant_brightness` changes their absolute values.
pub(super) fn cwww_to_kelvin(
    cold: u8,
    warm: u8,
    warm_kelvin: u16,
    cold_kelvin: u16,
) -> Option<u16> {
    let total = f64::from(cold) + f64::from(warm);
    if total <= 0.0 {
        return None;
    }
    let warm_fraction = f64::from(warm) / total;
    let cold_mired = 1_000_000.0 / f64::from(cold_kelvin);
    let warm_mired = 1_000_000.0 / f64::from(warm_kelvin);
    let mired = cold_mired + warm_fraction * (warm_mired - cold_mired);
    let kelvin = (1_000_000.0 / mired).round();
    Some((kelvin as u16).clamp(warm_kelvin, cold_kelvin))
}

pub(super) fn decode(
    payload: &[u8],
    topic: &str,
    integration_id: IntegrationId,
    config: &MqttConfig,
) -> Option<Device> {
    let value = serde_json::from_slice::<Value>(payload).ok()?;
    let object = value.as_object()?;
    let id = state_device_id(config, topic)?;
    let power = match object.get("state").and_then(Value::as_str) {
        Some("ON") => true,
        Some("OFF") => false,
        _ => return None,
    };
    let brightness = match object.get("brightness") {
        Some(value) => Some(f32::from(channel_value(value)?) / 255.0),
        None => None,
    };
    let (warm_kelvin, cold_kelvin) = configured_range(config);
    let color = match object.get("color_mode").and_then(Value::as_str) {
        None | Some("onoff") | Some("brightness") => None,
        Some("rgb") => {
            let color = object.get("color")?.as_object()?;
            Some(DeviceColor::new_from_rgb(
                channel(color, "r")?,
                channel(color, "g")?,
                channel(color, "b")?,
            ))
        }
        Some("cwww") => {
            let color = object.get("color")?.as_object()?;
            let cold = channel(color, "c")?;
            let warm = channel(color, "w")?;
            cwww_to_kelvin(cold, warm, warm_kelvin, cold_kelvin).map(DeviceColor::new_from_ct)
        }
        Some("color_temp") => {
            let mired = object.get("color_temp")?.as_f64()?;
            if !mired.is_finite() || mired <= 0.0 {
                return None;
            }
            let kelvin = (1_000_000.0 / mired).round();
            Some(DeviceColor::new_from_ct(
                kelvin.clamp(f64::from(warm_kelvin), f64::from(cold_kelvin)) as u16,
            ))
        }
        Some(_) => return None,
    };
    let capabilities = Capabilities {
        brightness: Some(true),
        rgb: true,
        ct: Some(warm_kelvin..cold_kelvin),
        ..Default::default()
    };

    Some(Device {
        id: DeviceId::new(&id),
        name: id,
        integration_id,
        data: DeviceData::Controllable(ControllableDevice::new(
            None,
            power,
            brightness,
            color,
            None,
            capabilities,
            config.managed.clone().unwrap_or_default(),
        )),
        raw: Some(value),
    })
}

fn channel_value(value: &Value) -> Option<u8> {
    let value = value.as_u64()?;
    (value <= u8::MAX as u64).then_some(value as u8)
}

pub(super) fn availability(base: &str, topic: &str, payload: &[u8]) -> Option<(String, bool)> {
    let id = topic
        .strip_prefix(&format!("{base}/"))?
        .strip_suffix("/status")?;
    if id.is_empty() || id == "discover" || id.contains('/') {
        return None;
    }
    let payload = std::str::from_utf8(payload).ok()?.trim();
    let status = match payload {
        "online" | "\"online\"" => true,
        "offline" | "\"offline\"" => false,
        _ => return None,
    };
    Some((id.to_owned(), status))
}

pub(super) fn encode(device: &Device, config: &MqttConfig) -> Result<Value> {
    let DeviceData::Controllable(data) = &device.data else {
        return Err(eyre!("Not a controllable device"));
    };
    let mut value = json!({"state": if data.state.power { "ON" } else { "OFF" }});
    if let Some(brightness) = data.state.brightness {
        let brightness = brightness.0.clamp(0.0, 1.0);
        value["brightness"] = json!((brightness * 255.0).round() as u8);
    }
    if let Some(color) = &data.state.color {
        match color
            .to_device_preferred_mode(&data.capabilities)
            .ok_or_else(|| eyre!("Unsupported ESPHome color"))?
        {
            DeviceColor::Rgb(rgb) => {
                value["color"] =
                    json!({"r": rgb.r.min(255), "g": rgb.g.min(255), "b": rgb.b.min(255)});
            }
            DeviceColor::Ct(ct) => {
                let range = data
                    .capabilities
                    .ct
                    .as_ref()
                    .ok_or_else(|| eyre!("Missing ESPHome CT range"))?;
                let kelvin = ct.ct.clamp(range.start as u64, range.end as u64).max(1);
                value["color_temp"] = json!((1_000_000.0 / kelvin as f64).round() as u64);
            }
            DeviceColor::Hs(_) | DeviceColor::Xy(_) => {
                return Err(eyre!("ESPHome encoder could not select RGB or CT"));
            }
        }
    }
    if let Some(transition) = data.state.transition {
        if transition.0.is_finite() {
            value["transition"] = json!(transition.0.clamp(0.0, u16::MAX as f32).round() as u16);
        }
    }
    if value.get("transition").is_none() {
        if let Some(transition) = config.default_transition {
            if transition.is_finite() {
                value["transition"] = json!(transition.clamp(0.0, u16::MAX as f32).round() as u16);
            }
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        color::{Capabilities, DeviceColor},
        device::{ControllableDevice, DeviceData, ManageKind},
    };
    use ordered_float::OrderedFloat;
    use serde_json::json;

    fn config() -> MqttConfig {
        MqttConfig {
            mode: Some(super::super::MqttMode::EspHome),
            esphome_base_topic: Some("esphome".into()),
            esphome_light_object_id: Some("light".into()),
            esphome_warm_white_kelvin: Some(2700),
            esphome_cold_white_kelvin: Some(6500),
            topic: "esphome/{id}/light/light/state".into(),
            topic_set: "esphome/{id}/light/light/command".into(),
            host: "localhost".into(),
            port: 1883,
            ..Default::default()
        }
    }

    #[test]
    fn decodes_rgb_state_and_preserves_configured_ct_capability() {
        let device = decode(
            br#"{"color_mode":"rgb","state":"ON","brightness":128,"color":{"r":255,"g":20,"b":0}}"#,
            "esphome/gx53-test/light/light/state",
            "mqtt".parse().unwrap(),
            &config(),
        )
        .unwrap();
        let DeviceData::Controllable(data) = device.data else {
            panic!()
        };
        assert!(data.state.power);
        assert_eq!(data.state.brightness, Some(OrderedFloat(128.0 / 255.0)));
        assert_eq!(
            data.state.color,
            Some(DeviceColor::new_from_rgb(255, 20, 0))
        );
        assert!(data.capabilities.rgb);
        assert_eq!(data.capabilities.ct, Some(2700..6500));
        assert!(device.raw.is_some());
    }

    #[test]
    fn cwww_ratio_is_independent_of_absolute_brightness() {
        let midpoint = cwww_to_kelvin(255, 255, 2700, 6500).unwrap();
        assert_eq!(midpoint, cwww_to_kelvin(128, 128, 2700, 6500).unwrap());
        assert_eq!(cwww_to_kelvin(255, 0, 2700, 6500), Some(6500));
        assert_eq!(cwww_to_kelvin(0, 255, 2700, 6500), Some(2700));
        assert!(cwww_to_kelvin(0, 0, 2700, 6500).is_none());
        assert!((midpoint as i32 - 3815).abs() <= 1);
    }

    #[test]
    fn decodes_cwww_state_without_inventing_zero_channel_ct() {
        let device = decode(
            br#"{"color_mode":"cwww","state":"ON","brightness":255,"color":{"c":255,"w":255}}"#,
            "esphome/gx53-test/light/light/state",
            "mqtt".parse().unwrap(),
            &config(),
        )
        .unwrap();
        let DeviceData::Controllable(data) = device.data else {
            panic!()
        };
        assert_eq!(data.state.color, Some(DeviceColor::new_from_ct(3815)));
    }

    #[test]
    fn outbound_rgb_and_ct_commands_use_esphome_json() {
        let rgb = Device {
            id: DeviceId::new("gx53-test"),
            name: "gx53-test".into(),
            integration_id: "mqtt".parse().unwrap(),
            data: DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(0.5),
                Some(DeviceColor::new_from_rgb(255, 20, 0)),
                Some(0.5),
                Capabilities {
                    brightness: Some(true),
                    rgb: true,
                    ct: Some(2700..6500),
                    ..Default::default()
                },
                ManageKind::Full,
            )),
            raw: None,
        };
        assert_eq!(
            encode(&rgb, &config()).unwrap(),
            json!({"state":"ON","brightness":128,"color":{"r":255,"g":20,"b":0},"transition":1})
        );

        let mut ct = rgb;
        if let DeviceData::Controllable(data) = &mut ct.data {
            data.state.color = Some(DeviceColor::new_from_ct(4000));
            data.state.transition = None;
        }
        assert_eq!(encode(&ct, &config()).unwrap()["color_temp"], json!(250));
    }

    #[test]
    fn malformed_messages_are_ignored() {
        let config = config();
        for payload in [
            br#"not json"#.as_slice(),
            br#"{"color_mode":"unknown","state":"ON"}"#,
            br#"{"color_mode":"rgb","state":"ON","color":{"r":1}}"#,
            br#"{"color_mode":"rgb","state":"ON","brightness":999,"color":{"r":1,"g":2,"b":3}}"#,
        ] {
            assert!(decode(
                payload,
                "esphome/gx53-test/light/light/state",
                "mqtt".parse().unwrap(),
                &config
            )
            .is_none());
        }
        let zero_channels = decode(
            br#"{"color_mode":"cwww","state":"ON","color":{"c":0,"w":0}}"#,
            "esphome/gx53-test/light/light/state",
            "mqtt".parse().unwrap(),
            &config,
        )
        .unwrap();
        let DeviceData::Controllable(data) = zero_channels.data else {
            panic!()
        };
        assert!(data.state.color.is_none());
    }

    #[test]
    fn availability_accepts_retained_style_status_payloads() {
        assert_eq!(
            availability("esphome", "esphome/gx53-test/status", b"online"),
            Some(("gx53-test".into(), true))
        );
        assert_eq!(
            availability("esphome", "esphome/gx53-test/status", b"offline"),
            Some(("gx53-test".into(), false))
        );
        assert!(availability("esphome", "esphome/discover/status", b"online").is_none());
        assert!(availability("esphome", "esphome/gx53-test/status/extra", b"online").is_none());
    }
}
