//! Zigbee2MQTT protocol boundary. Discovery is separate from reported state.
use std::collections::{HashMap, HashSet};

use color_eyre::eyre::{eyre, Result};
use serde_json::{json, Value};

use super::{utils::mqtt_to_homectl, MqttConfig};
use crate::types::{
    color::{Capabilities, DeviceColor},
    device::{Device, DeviceData},
    integration::IntegrationId,
};

#[derive(Clone)]
struct Metadata {
    id: String,
    name: String,
    capabilities: Capabilities,
    get_fields: Vec<String>,
}

#[derive(Default)]
pub(super) struct Discovery {
    devices: HashMap<String, Metadata>,
    // Retained state may arrive before the retained device inventory.
    pending: HashMap<String, Value>,
}

fn writable(feature: &Value) -> bool {
    feature["access"]
        .as_u64()
        .is_some_and(|access| access & 2 != 0)
        || (feature.get("access").is_none()
            && feature["features"]
                .as_array()
                .is_some_and(|children| !children.is_empty() && children.iter().all(writable)))
}

fn metadata(value: &Value) -> Option<Metadata> {
    let id = value["ieee_address"].as_str()?.to_owned();
    let name = value["friendly_name"].as_str()?.to_owned();
    let exposes = value["definition"]["exposes"].as_array()?;
    let mut capabilities = Capabilities {
        brightness: Some(false),
        ..Default::default()
    };
    // Endpoint-specific lights need separate homectl devices; never merge their
    // properties into a root light and accidentally address the wrong endpoint.
    let light = exposes.iter().find(|entry| {
        matches!(entry["type"].as_str(), Some("light" | "switch"))
            && entry.get("endpoint").is_none()
    });
    let Some(light) = light else {
        // Preserve explicitly configured sensor mappings on this integration.
        return Some(Metadata {
            id,
            name,
            capabilities,
            get_fields: vec![],
        });
    };
    let features = light["features"].as_array()?;
    if !features
        .iter()
        .any(|f| f["property"] == "state" && writable(f))
    {
        return None;
    }
    let get_fields = features
        .iter()
        .filter(|feature| {
            feature["access"]
                .as_u64()
                .is_some_and(|access| access & 4 != 0)
        })
        .filter_map(|feature| feature["property"].as_str())
        .filter(|property| matches!(*property, "state" | "brightness" | "color" | "color_temp"))
        .map(str::to_owned)
        .collect();
    for feature in features.iter().filter(|f| writable(f)) {
        match feature["name"].as_str() {
            Some("brightness") if feature["property"] == "brightness" => {
                capabilities.brightness = Some(true);
            }
            Some("color_xy") if feature["property"] == "color" => capabilities.xy = true,
            Some("color_hs") if feature["property"] == "color" => capabilities.hs = true,
            Some("color_temp") if feature["property"] == "color_temp" => {
                if let (Some(min), Some(max)) =
                    (feature["value_min"].as_f64(), feature["value_max"].as_f64())
                {
                    if min > 0.0 && max >= min {
                        let start = (1_000_000.0 / max).ceil();
                        let end = (1_000_000.0 / min).floor();
                        if start >= 1.0 && end <= u16::MAX as f64 && start <= end {
                            capabilities.ct = Some(start as u16..end as u16);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Some(Metadata {
        id,
        name,
        capabilities,
        get_fields,
    })
}

impl Discovery {
    pub(super) fn poll_requests(&self, base: &str) -> Vec<(String, Value)> {
        let mut seen = HashSet::new();
        self.devices
            .values()
            .filter(|metadata| !metadata.get_fields.is_empty() && seen.insert(metadata.id.as_str()))
            .map(|metadata| {
                let payload = metadata
                    .get_fields
                    .iter()
                    .map(|field| (field.clone(), Value::String(String::new())))
                    .collect::<serde_json::Map<_, _>>();
                (
                    format!("{base}/{}/get", metadata.name),
                    Value::Object(payload),
                )
            })
            .collect()
    }

    pub(super) fn receive(
        &mut self,
        base: &str,
        topic: &str,
        payload: &[u8],
        integration: &IntegrationId,
        config: &MqttConfig,
    ) -> Vec<Device> {
        let Ok(value) = serde_json::from_slice::<Value>(payload) else {
            return vec![];
        };
        if topic == format!("{base}/bridge/devices") {
            let Some(entries) = value.as_array() else {
                return vec![];
            };
            self.devices.clear();
            for item in entries.iter().filter_map(metadata) {
                self.devices.insert(item.id.clone(), item.clone());
                self.devices.insert(item.name.clone(), item);
            }
            // Only replay state held while waiting for initial discovery. A
            // metadata refresh alone is never treated as a new device report.
            return std::mem::take(&mut self.pending)
                .into_iter()
                .filter_map(|(key, state)| {
                    self.devices
                        .get(&key)
                        .and_then(|m| decode(state, m, integration, config))
                })
                .collect();
        }
        let Some(key) = topic.strip_prefix(&format!("{base}/")) else {
            return vec![];
        };
        if key.starts_with("bridge/") || !value.is_object() {
            return vec![];
        }
        if let Some(meta) = self.devices.get(key) {
            return decode(value, meta, integration, config)
                .into_iter()
                .collect();
        }
        // Do not buffer commands, availability, or unbounded arbitrary topics.
        if !key.ends_with("/set") && !key.ends_with("/get") && self.pending.len() < 1024 {
            self.pending.insert(key.to_owned(), value);
        }
        vec![]
    }
}

fn decode(
    mut value: Value,
    meta: &Metadata,
    integration: &IntegrationId,
    config: &MqttConfig,
) -> Option<Device> {
    let raw = value.clone();
    // Do not invent an off report from metadata or an incomplete update.
    if !matches!(value["state"].as_str(), Some("ON" | "OFF"))
        && !config.sensor_value_fields.as_ref().is_some_and(|fields| {
            fields
                .iter()
                .any(|field| field.resolve(&value).is_ok_and(|value| !value.is_null()))
        })
    {
        return None;
    }
    let color = match value["color_mode"].as_str() {
        Some("color_temp") => value["color_temp"]
            .as_f64()
            .filter(|v| *v > 0.0)
            .map(|v| json!({"ct": (1_000_000.0 / v).round() as u64})),
        Some("hs") => {
            let color = &value["color"];
            color["hue"]
                .as_f64()
                .zip(color["saturation"].as_f64())
                .map(|(h, s)| json!({"h": h.round() as u64, "s": s / 100.0}))
        }
        Some("xy") => value["color"]["x"]
            .as_f64()
            .zip(value["color"]["y"].as_f64())
            .map(|(x, y)| json!({"x": x, "y": y})),
        // Absence of a mode is ambiguous if multiple converted values coexist.
        _ => None,
    };
    value["color"] = color.unwrap_or(Value::Null);
    value["id"] = json!(meta.id);
    value["name"] = json!(meta.name);
    value["capabilities"] = serde_json::to_value(&meta.capabilities).ok()?;
    let normalized = MqttConfig {
        power_field: Some(jsonptr::PointerBuf::from_tokens(["state"])),
        power_on_value: Some(json!("ON")),
        power_off_value: Some(json!("OFF")),
        brightness_range: Some((0.0, 254.0)),
        managed: config.managed.clone(),
        sensor_value_fields: config.sensor_value_fields.clone(),
        ..Default::default()
    };
    let mut device = mqtt_to_homectl(
        &serde_json::to_vec(&value).ok()?,
        &meta.name,
        integration.clone(),
        &normalized,
    )?;
    device.raw = Some(raw);
    Some(device)
}

pub(super) fn encode(device: &Device) -> Result<Value> {
    let DeviceData::Controllable(data) = &device.data else {
        return Err(eyre!("Not a controllable device"));
    };
    let mut value = json!({"state": if data.state.power { "ON" } else { "OFF" }});
    if data.capabilities.brightness == Some(true) {
        if let Some(brightness) = data.state.brightness {
            value["brightness"] =
                json!((brightness.clamp(0.0.into(), 1.0.into()).0 * 254.0).round() as u16);
        }
    }
    if let Some(color) = &data.state.color {
        let color = color
            .to_device_preferred_mode(&data.capabilities)
            .ok_or_else(|| eyre!("Unsupported color"))?;
        match color {
            DeviceColor::Ct(ct) => {
                let range = data
                    .capabilities
                    .ct
                    .as_ref()
                    .ok_or_else(|| eyre!("Missing CT range"))?;
                let kelvin = ct.ct.clamp(range.start as u64, range.end as u64).max(1);
                value["color_temp"] = json!((1_000_000.0 / kelvin as f64).round() as u64);
            }
            DeviceColor::Hs(hs) => {
                value["color"] = json!({"hue": hs.h, "saturation": hs.s.0.clamp(0.0, 1.0) * 100.0})
            }
            DeviceColor::Xy(xy) => value["color"] = json!({"x": xy.x, "y": xy.y}),
            DeviceColor::Rgb(_) => return Err(eyre!("Unexpected Zigbee2MQTT RGB capability")),
        }
    }
    if let Some(transition) = data.state.transition {
        value["transition"] = json!(transition);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inventory() -> Value {
        json!([{"ieee_address":"0x123", "friendly_name":"Office", "definition":{"exposes":[{"type":"light","features":[
            {"name":"state","property":"state","access":7},
            {"name":"brightness","property":"brightness","access":7},
            {"name":"color_temp","property":"color_temp","access":7,"value_min":153,"value_max":500},
            {"name":"color_xy","property":"color","access":7},
            {"name":"color_hs","property":"color","access":7}
        ]}]}}])
    }

    #[test]
    fn discovery_order_mode_and_round_trip() {
        let mut discovery = Discovery::default();
        let config = MqttConfig::default();
        let integration = "zigbee".parse().unwrap();
        let state = json!({"state":"ON","brightness":127,"color_mode":"color_temp","color_temp":250,"color":{"x":0.3,"y":0.3}});
        assert!(discovery
            .receive(
                "z",
                "z/Office",
                &serde_json::to_vec(&state).unwrap(),
                &integration,
                &config
            )
            .is_empty());
        let devices = discovery.receive(
            "z",
            "z/bridge/devices",
            &serde_json::to_vec(&inventory()).unwrap(),
            &integration,
            &config,
        );
        assert_eq!(devices.len(), 1);
        let device = &devices[0];
        assert_eq!(device.id.to_string(), "0x123");
        let DeviceData::Controllable(data) = &device.data else {
            panic!()
        };
        assert_eq!(data.capabilities.ct, Some(2000..6535));
        assert!(data.capabilities.hs && data.capabilities.xy);
        assert_eq!(data.state.color, Some(DeviceColor::new_from_ct(4000)));
        assert_eq!(
            encode(device).unwrap(),
            json!({"state":"ON","brightness":127,"color_temp":250})
        );
        assert!(discovery
            .receive(
                "z",
                "z/bridge/devices",
                &serde_json::to_vec(&inventory()).unwrap(),
                &integration,
                &config
            )
            .is_empty());
    }

    #[test]
    fn hs_is_scaled_and_readonly_temperature_is_not_advertised() {
        let mut inventory = inventory();
        inventory[0]["definition"]["exposes"][0]["features"][2]["access"] = json!(1);
        let meta = metadata(&inventory[0]).unwrap();
        assert!(meta.capabilities.ct.is_none());
        let device = decode(json!({"state":"ON","color_mode":"hs","color":{"hue":120,"saturation":50,"x":0.3,"y":0.3},"color_temp":250}), &meta, &"zigbee".parse().unwrap(), &MqttConfig::default()).unwrap();
        assert_eq!(
            encode(&device).unwrap()["color"],
            json!({"hue":120,"saturation":50.0})
        );
    }

    #[test]
    fn mode_wins_over_alternate_color_and_metadata_is_not_state() {
        let meta = metadata(&inventory()[0]).unwrap();
        let config = MqttConfig::default();
        let integration = "zigbee".parse().unwrap();
        assert!(decode(json!({"linkquality":100}), &meta, &integration, &config).is_none());
        let device = decode(json!({"state":"ON","color_mode":"xy","color":{"x":0.3,"y":0.4,"hue":120,"saturation":50},"color_temp":250}), &meta, &integration, &config).unwrap();
        assert_eq!(
            encode(&device).unwrap()["color"],
            json!({"x":0.3_f32,"y":0.4_f32})
        );
        assert!(encode(&device).unwrap().get("color_temp").is_none());
    }

    #[test]
    fn configured_sensor_mappings_survive_profile_selection() {
        let meta = metadata(&json!({"ieee_address":"sensor-id","friendly_name":"sensor","definition":{"exposes":[{"name":"temperature","type":"numeric","access":1}]}})).unwrap();
        let config = MqttConfig {
            sensor_value_fields: Some(vec![jsonptr::PointerBuf::from_tokens(["temperature"])]),
            ..Default::default()
        };
        let device = decode(
            json!({"temperature":21.0}),
            &meta,
            &"zigbee".parse().unwrap(),
            &config,
        )
        .unwrap();
        assert!(device.is_sensor());
        assert_eq!(device.id.to_string(), "sensor-id");
    }
}
