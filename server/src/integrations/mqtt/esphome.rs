//! ESPHome MQTT JSON light protocol boundary.
//!
//! This intentionally targets ESPHome's normal MQTT light topic convention,
//! rather than trying to express the protocol as generic JSON pointers.

use color_eyre::eyre::{eyre, Result};
use serde_json::{json, Value};
use std::collections::HashMap;

use super::MqttConfig;
use crate::types::{
    color::{Capabilities, DeviceColor},
    device::{ControllableDevice, Device, DeviceAvailability, DeviceData, DeviceId},
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

#[derive(Clone, Debug)]
struct Metadata {
    name: String,
    capabilities: Capabilities,
}

/// Metadata sent by ESPHome using Home Assistant MQTT discovery.
///
/// State and discovery messages are retained independently, so state can
/// arrive before the discovery config. In that case we decode the state with
/// the protocol fallback and replay it when the metadata arrives.
#[derive(Default)]
pub(super) struct Discovery {
    devices: HashMap<String, Metadata>,
    last_states: HashMap<String, Value>,
    availability: HashMap<String, DeviceAvailability>,
}

fn discovery_field<'a>(value: &'a Value, long: &str, short: &str) -> Option<&'a Value> {
    value.get(long).or_else(|| value.get(short))
}

fn expand_discovery_topic(value: &Value, long: &str, short: &str) -> Option<String> {
    let topic = discovery_field(value, long, short)?.as_str()?;
    let base = value.get("~").and_then(Value::as_str);
    match (base, topic) {
        (Some(base), "~") => Some(base.to_owned()),
        (Some(base), topic) => topic
            .strip_prefix("~/")
            .map(|suffix| format!("{base}/{suffix}"))
            .or_else(|| Some(topic.to_owned())),
        (None, topic) => Some(topic.to_owned()),
    }
}

fn range_from_mireds(value: &Value, config: &MqttConfig) -> Option<std::ops::Range<u16>> {
    let min_mireds = value
        .get("min_mireds")
        .or_else(|| value.get("min_mirs"))
        .and_then(Value::as_f64);
    let max_mireds = value
        .get("max_mireds")
        .or_else(|| value.get("max_mirs"))
        .and_then(Value::as_f64);
    match (min_mireds, max_mireds) {
        (Some(min), Some(max)) if min > 0.0 && max >= min => {
            let warm = (1_000_000.0 / max).ceil();
            let cold = (1_000_000.0 / min).floor();
            if warm >= 1.0 && cold <= u16::MAX as f64 && warm <= cold {
                return Some(warm as u16..cold as u16);
            }
            None
        }
        _ => Some(configured_range(config).0..configured_range(config).1),
    }
}

fn capabilities_from_discovery(value: &Value, config: &MqttConfig) -> Capabilities {
    let mut capabilities = Capabilities::default();
    let modes = discovery_field(value, "supported_color_modes", "sup_clrm")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();

    for mode in &modes {
        match mode {
            &"onoff" => capabilities.brightness = Some(false),
            &"brightness" | &"white" => capabilities.brightness = Some(true),
            &"color_temp" => {
                capabilities.brightness = Some(true);
                capabilities.ct = range_from_mireds(value, config);
            }
            &"hs" => {
                capabilities.brightness = Some(true);
                capabilities.hs = true;
            }
            &"xy" => {
                capabilities.brightness = Some(true);
                capabilities.xy = true;
            }
            &"rgb" | &"rgbw" => {
                capabilities.brightness = Some(true);
                capabilities.rgb = true;
            }
            &"rgbct" | &"rgbww" => {
                capabilities.brightness = Some(true);
                capabilities.rgb = true;
                capabilities.ct = range_from_mireds(value, config);
            }
            _ => {}
        }
    }

    // Older ESPHome discovery payloads may only have the legacy brightness
    // flag. Keep the normal ESPHome fallback when no mode list is available.
    if modes.is_empty() {
        capabilities.brightness = value
            .get("brightness")
            .and_then(Value::as_bool)
            .or(Some(true));
        capabilities.rgb = value
            .get("color_mode")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        capabilities.ct = Some(configured_range(config).0..configured_range(config).1);
    }

    capabilities
}

/// ESPHome's light component defaults its `name:` to "Light", a placeholder
/// rather than a label.
fn is_placeholder_light_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("light")
}

impl Discovery {
    pub(super) fn remember_availability(
        &mut self,
        device_id: &str,
        online: bool,
        observed_at_ms: i64,
    ) {
        self.availability.insert(
            device_id.to_owned(),
            DeviceAvailability {
                online,
                observed_at_ms,
            },
        );
    }

    fn apply_availability(&self, device: &mut Device) {
        let Some(availability) = self.availability.get(&device.id.to_string()) else {
            return;
        };
        if let DeviceData::Controllable(data) = &mut device.data {
            data.availability = Some(availability.clone());
        }
    }

    pub(super) fn receive(
        &mut self,
        prefix: &str,
        topic: &str,
        payload: &[u8],
        integration_id: IntegrationId,
        config: &MqttConfig,
    ) -> Vec<Device> {
        if !topic.starts_with(&format!("{prefix}/light/")) || !topic.ends_with("/config") {
            return vec![];
        }

        let config_id = topic
            .strip_prefix(&format!("{prefix}/light/"))
            .and_then(|topic| topic.strip_suffix("/config"))
            .and_then(|topic| {
                let mut segments = topic.split('/');
                let id = segments.next()?;
                (!id.is_empty() && segments.next().is_some() && segments.next().is_none())
                    .then_some(id.to_owned())
            });

        let Ok(value) = serde_json::from_slice::<Value>(payload) else {
            if payload.is_empty() {
                if let Some(id) = config_id {
                    self.devices.remove(&id);
                }
            }
            return vec![];
        };
        if value.is_null() {
            if let Some(id) = config_id {
                self.devices.remove(&id);
            }
            return vec![];
        }
        let Some(state_topic) = expand_discovery_topic(&value, "state_topic", "stat_t") else {
            return vec![];
        };
        let Some(id) = state_device_id(config, &state_topic) else {
            return vec![];
        };

        let entity_name = value
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty());
        // ESPHome gives a light component with no `name:` of its own the
        // placeholder "Light", which identifies nothing. The discovery
        // payload's device block carries the node name ("entryway-gx53"),
        // which is what the user recognises from their configuration.
        let device_block_name = value
            .get("device")
            .or_else(|| value.get("dev"))
            .and_then(|device| device.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let node_from_topic = config_id
            .as_deref()
            .and_then(|id| id.split('/').next())
            .filter(|node| !node.is_empty());
        let name = match entity_name {
            Some(name) if !is_placeholder_light_name(name) => name.to_owned(),
            _ => device_block_name
                .or(node_from_topic)
                .or(entity_name)
                .map(str::to_owned)
                .unwrap_or_else(|| id.clone()),
        };
        let metadata = Metadata {
            name,
            capabilities: capabilities_from_discovery(&value, config),
        };
        self.devices.insert(id.clone(), metadata);

        let mut replayed = self
            .last_states
            .get(&id)
            .and_then(|state| {
                decode_with_metadata(
                    &serde_json::to_vec(state).ok()?,
                    &state_topic,
                    integration_id,
                    config,
                    self.devices.get(&id),
                )
            })
            .into_iter()
            .collect::<Vec<_>>();
        for device in &mut replayed {
            self.apply_availability(device);
        }
        replayed
    }

    pub(super) fn state(
        &mut self,
        payload: &[u8],
        topic: &str,
        integration_id: IntegrationId,
        config: &MqttConfig,
    ) -> Vec<Device> {
        let Some(id) = state_device_id(config, topic) else {
            return vec![];
        };
        let Ok(value) = serde_json::from_slice::<Value>(payload) else {
            return vec![];
        };
        self.last_states.insert(id.clone(), value);
        let mut decoded = match self.devices.get(&id) {
            Some(metadata) => {
                decode_with_metadata(payload, topic, integration_id, config, Some(metadata))
            }
            None => decode(payload, topic, integration_id, config),
        };
        if let Some(device) = &mut decoded {
            self.apply_availability(device);
        }
        decoded.into_iter().collect()
    }
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
    decode_with_metadata(payload, topic, integration_id, config, None)
}

fn fallback_capabilities(config: &MqttConfig) -> Capabilities {
    // An ESPHome light that reports the UNKNOWN mode while off does not carry
    // enough information to infer its traits. Keep the historical fallback so
    // it remains controllable before retained discovery metadata arrives.
    Capabilities {
        brightness: Some(true),
        rgb: true,
        ct: Some(configured_range(config).0..configured_range(config).1),
        ..Default::default()
    }
}

fn capabilities_for_mode(
    mode: Option<&str>,
    object: &serde_json::Map<String, Value>,
    config: &MqttConfig,
) -> Capabilities {
    let (warm_kelvin, cold_kelvin) = configured_range(config);
    let mut capabilities = Capabilities::default();
    match mode {
        Some("onoff") => capabilities.brightness = Some(false),
        Some("brightness" | "white") => capabilities.brightness = Some(true),
        Some("color_temp" | "cwww") => {
            capabilities.brightness = Some(true);
            capabilities.ct = Some(warm_kelvin..cold_kelvin);
        }
        Some("rgb" | "rgbw") => {
            capabilities.brightness = Some(true);
            capabilities.rgb = true;
        }
        Some("rgbct" | "rgbww") => {
            capabilities.brightness = Some(true);
            capabilities.rgb = true;
            capabilities.ct = Some(warm_kelvin..cold_kelvin);
        }
        None if object.get("state").is_none()
            && object
                .get("color")
                .and_then(Value::as_object)
                .is_some_and(|color| {
                    ["r", "g", "b"].iter().all(|key| color.contains_key(*key))
                }) =>
        {
            capabilities.brightness = Some(true);
            capabilities.rgb = true;
        }
        None if object
            .get("color")
            .and_then(Value::as_object)
            .is_some_and(|color| color.contains_key("c") || color.contains_key("w"))
            || object.get("color_temp").is_some() =>
        {
            capabilities.brightness = Some(true);
            capabilities.ct = Some(warm_kelvin..cold_kelvin);
        }
        _ => return fallback_capabilities(config),
    }
    capabilities
}

fn decode_with_metadata(
    payload: &[u8],
    topic: &str,
    integration_id: IntegrationId,
    config: &MqttConfig,
    metadata: Option<&Metadata>,
) -> Option<Device> {
    let value = serde_json::from_slice::<Value>(payload).ok()?;
    let object = value.as_object()?;
    let id = state_device_id(config, topic)?;
    let power = match object.get("state").and_then(Value::as_str) {
        Some("ON") => true,
        Some("OFF") => false,
        None if object
            .get("color")
            .and_then(Value::as_object)
            .is_some_and(|color| {
                color.is_empty()
                    && object.get("brightness").is_none()
                    && object.get("color_temp").is_none()
                    && object
                        .get("color_mode")
                        .is_none_or(|mode| mode.as_str() == Some("unknown"))
            }) =>
        {
            false
        }
        _ => return None,
    };
    let brightness = match object.get("brightness") {
        Some(value) => Some(f32::from(channel_value(value)?) / 255.0),
        None => None,
    };
    let (warm_kelvin, cold_kelvin) = metadata
        .and_then(|metadata| {
            metadata
                .capabilities
                .ct
                .as_ref()
                .map(|range| (range.start, range.end))
        })
        .unwrap_or_else(|| configured_range(config));
    let color_mode = object.get("color_mode").and_then(Value::as_str);
    let color = match color_mode {
        Some("onoff") | Some("brightness") => None,
        Some("rgb" | "rgbw" | "rgbct") => {
            let color = object.get("color")?.as_object()?;
            Some(DeviceColor::new_from_rgb(
                channel(color, "r")?,
                channel(color, "g")?,
                channel(color, "b")?,
            ))
        }
        Some("cwww" | "rgbww") => {
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
        None => {
            let color = object.get("color")?.as_object()?;
            if ["r", "g", "b"].iter().all(|key| color.contains_key(*key)) {
                Some(DeviceColor::new_from_rgb(
                    channel(color, "r")?,
                    channel(color, "g")?,
                    channel(color, "b")?,
                ))
            } else if color.contains_key("c") && color.contains_key("w") {
                cwww_to_kelvin(
                    channel(color, "c")?,
                    channel(color, "w")?,
                    warm_kelvin,
                    cold_kelvin,
                )
                .map(DeviceColor::new_from_ct)
            } else {
                None
            }
        }
        Some(_) => return None,
    };
    let capabilities = metadata
        .map(|metadata| metadata.capabilities.clone())
        .unwrap_or_else(|| capabilities_for_mode(color_mode, object, config));
    let name = metadata
        .map(|metadata| metadata.name.clone())
        .unwrap_or_else(|| id.clone());

    Some(Device {
        id: DeviceId::new(&id),
        name,
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

const MAX_TRANSITION_SECONDS: f32 = u16::MAX as f32;
const MAX_TRANSITION_MILLISECONDS: u64 = u16::MAX as u64 * 1000;

/// Add the ESPHome transition extension and, where lossless, its stock
/// ESPHome counterpart. ESPHome's native field is whole seconds; the custom
/// field keeps the exact homectl duration in milliseconds.
pub(super) fn add_transition(value: &mut Value, transition: Option<f32>) {
    let Some(transition) = transition.filter(|value| value.is_finite()) else {
        return;
    };

    let seconds = transition.clamp(0.0, MAX_TRANSITION_SECONDS);
    let milliseconds = (f64::from(seconds) * 1000.0).round() as u64;
    value["transition_ms"] = json!(milliseconds.min(MAX_TRANSITION_MILLISECONDS));

    if seconds == 0.0 {
        value["transition"] = json!(0);
    } else if seconds.fract() == 0.0 {
        value["transition"] = json!(seconds as u64);
    }
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
    let transition = data
        .state
        .transition
        .map(|transition| transition.0)
        .filter(|transition| transition.is_finite())
        .or_else(|| {
            config
                .default_transition
                .filter(|transition| transition.is_finite())
        });
    add_transition(&mut value, transition);
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
    fn decodes_rgb_state_and_infers_rgb_capability() {
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
        assert!(data.capabilities.ct.is_none());
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
    fn decodes_esphome_unknown_mode_snapshot_as_off() {
        let device = decode(
            br#"{"color":{}}"#,
            "esphome/gx53-test/light/light/state",
            "mqtt".parse().unwrap(),
            &config(),
        )
        .expect("ESPHome publishes an empty color object while off");
        let DeviceData::Controllable(data) = device.data else {
            panic!()
        };
        assert!(!data.state.power);
        assert!(data.state.brightness.is_none());
        assert!(data.state.color.is_none());
    }

    #[test]
    fn cached_availability_is_attached_when_state_arrives_first() {
        let mut discovery = Discovery::default();
        let integration: IntegrationId = "mqtt".parse().unwrap();
        let config = config();
        discovery.remember_availability("gx53-test", true, 0);

        let devices = discovery.state(
            br#"{"color":{}}"#,
            "esphome/gx53-test/light/light/state",
            integration,
            &config,
        );
        let DeviceData::Controllable(data) = &devices[0].data else {
            panic!()
        };
        assert_eq!(
            data.availability,
            Some(crate::types::device::DeviceAvailability {
                online: true,
                observed_at_ms: 0,
            })
        );
    }

    #[test]
    fn discovery_replays_state_and_applies_capabilities() {
        let mut discovery = Discovery::default();
        let integration: IntegrationId = "mqtt".parse().unwrap();
        let config = config();
        let state_topic = "esphome/gx53-test/light/light/state";
        let state =
            br#"{"color_mode":"cwww","state":"ON","brightness":255,"color":{"c":255,"w":0}}"#;

        let first = discovery.state(state, state_topic, integration.clone(), &config);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].name, "gx53-test");

        let config_topic = "homeassistant/light/gx53-test/light/config";
        let discovery_payload = json!({
            "~": "esphome/gx53-test/light/light",
            "stat_t": "~/state",
            "cmd_t": "~/command",
            "schema": "json",
            "name": "Lower bathroom downlight 1",
            "sup_clrm": ["color_temp"],
            "min_mirs": 153,
            "max_mirs": 370
        });
        let replayed = discovery.receive(
            "homeassistant",
            config_topic,
            &serde_json::to_vec(&discovery_payload).unwrap(),
            integration,
            &config,
        );
        assert_eq!(replayed.len(), 1);
        assert_eq!(replayed[0].name, "Lower bathroom downlight 1");
        let DeviceData::Controllable(data) = &replayed[0].data else {
            panic!()
        };
        assert_eq!(data.capabilities.brightness, Some(true));
        assert!(!data.capabilities.rgb);
        assert_eq!(data.capabilities.ct, Some(2703..6535));
    }

    #[test]
    fn discovery_prefers_the_node_name_over_a_placeholder_light_name() {
        let mut discovery = Discovery::default();
        let integration: IntegrationId = "mqtt".parse().unwrap();
        let config = config();
        let config_topic = "homeassistant/light/gx53-test/light/config";

        let discover = |discovery: &mut Discovery, name: &str, device: Option<&str>| {
            let mut payload = json!({
                "~": "esphome/gx53-test/light/light",
                "stat_t": "~/state",
                "schema": "json",
                "name": name,
                "sup_clrm": ["color_temp"],
                "min_mirs": 153,
                "max_mirs": 370,
            });
            if let Some(device_name) = device {
                payload["device"] = json!({ "name": device_name, "identifiers": ["gx53-test"] });
            }
            discovery.receive(
                "homeassistant",
                config_topic,
                &serde_json::to_vec(&payload).unwrap(),
                integration.clone(),
                &config,
            );
            discovery
                .devices
                .get("gx53-test")
                .expect("discovery registered the device")
                .name
                .clone()
        };

        // ESPHome names a light component "Light" when it has no `name:` of its
        // own, so the node name from the device block is used instead.
        assert_eq!(
            discover(&mut discovery, "Light", Some("Lower bathroom gx53")),
            "Lower bathroom gx53"
        );
        // Without a device block the node segment of the discovery topic wins.
        assert_eq!(discover(&mut discovery, "light", None), "gx53-test");
        // A real entity name always wins.
        assert_eq!(
            discover(
                &mut discovery,
                "Lower bathroom downlight 1",
                Some("Lower bathroom gx53")
            ),
            "Lower bathroom downlight 1"
        );
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
            json!({"state":"ON","brightness":128,"color":{"r":255,"g":20,"b":0},"transition_ms":500})
        );

        let mut ct = rgb;
        if let DeviceData::Controllable(data) = &mut ct.data {
            data.state.color = Some(DeviceColor::new_from_ct(4000));
            data.state.transition = None;
        }
        assert_eq!(encode(&ct, &config()).unwrap()["color_temp"], json!(250));
    }

    #[test]
    fn outbound_hs_white_for_rgb_only_light_is_neutral_rgb() {
        let device = Device {
            id: DeviceId::new("gx53-test"),
            name: "gx53-test".into(),
            integration_id: "mqtt".parse().unwrap(),
            data: DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(1.0),
                Some(DeviceColor::new_from_hs(0, 0.0)),
                None,
                Capabilities {
                    brightness: Some(true),
                    rgb: true,
                    ..Default::default()
                },
                ManageKind::Full,
            )),
            raw: None,
        };
        assert_eq!(
            encode(&device, &config()).unwrap()["color"],
            json!({"r":255,"g":255,"b":255})
        );
    }

    #[test]
    fn transition_encoding_preserves_milliseconds_and_stock_compatibility() {
        for (seconds, expected) in [
            (None, json!({})),
            (Some(0.0), json!({"transition_ms": 0, "transition": 0})),
            (Some(0.25), json!({"transition_ms": 250})),
            (Some(1.0), json!({"transition_ms": 1000, "transition": 1})),
            (Some(1.5), json!({"transition_ms": 1500})),
            (Some(2.0), json!({"transition_ms": 2000, "transition": 2})),
            (
                Some(f32::MAX),
                json!({"transition_ms": MAX_TRANSITION_MILLISECONDS, "transition": u16::MAX}),
            ),
        ] {
            let mut payload = json!({});
            add_transition(&mut payload, seconds);
            assert_eq!(payload, expected);
        }
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
