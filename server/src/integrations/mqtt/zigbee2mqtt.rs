//! Zigbee2MQTT protocol boundary. Discovery is separate from reported state.
use std::{
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
    time::{Duration, Instant},
};

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

/// Where the current device inventory came from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum InventorySource {
    #[default]
    None,
    /// Loaded from the database copy of an earlier `bridge/devices`.
    Cached,
    /// A `bridge/devices` message received from the broker.
    Live,
}

#[derive(Default)]
pub(super) struct Discovery {
    devices: HashMap<String, Metadata>,
    // Retained state may arrive before the retained device inventory.
    pending: HashMap<String, Value>,
    source: InventorySource,
    // Set when a valid live inventory was applied; see `take_live_inventory`.
    live_inventory: bool,
}

/// Button/remote events (`action`, `action_group`, ...) are momentary. They
/// are only decoded from live, immediately decodable messages; never from
/// retained or buffered payloads that could replay a press late.
fn strip_actions(value: &mut Value) {
    if let Some(object) = value.as_object_mut() {
        object.retain(|key, _| key != "action" && !key.starts_with("action_"));
    }
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
    if value["disabled"] == true {
        return None;
    }
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
    fn replace_inventory(&mut self, entries: &[Value]) {
        self.devices.clear();
        for item in entries.iter().filter_map(metadata) {
            self.devices.insert(item.id.clone(), item.clone());
            self.devices.insert(item.name.clone(), item);
        }
    }

    /// Seed the inventory from a stored `bridge/devices` payload so decoding
    /// and polling work before the broker delivers a live inventory. Returns
    /// false (and changes nothing) for an unusable payload.
    pub(super) fn load_cached(&mut self, payload: &[u8]) -> bool {
        let Ok(Value::Array(entries)) = serde_json::from_slice::<Value>(payload) else {
            return false;
        };
        if self.source == InventorySource::Live {
            return false;
        }
        self.replace_inventory(&entries);
        self.source = InventorySource::Cached;
        true
    }

    pub(super) fn source(&self) -> InventorySource {
        self.source
    }

    /// Number of distinct devices in the inventory (ids and names alias).
    pub(super) fn device_count(&self) -> usize {
        self.devices
            .values()
            .map(|meta| meta.id.as_str())
            .collect::<HashSet<_>>()
            .len()
    }

    /// True once after a valid live `bridge/devices` was applied.
    pub(super) fn take_live_inventory(&mut self) -> bool {
        std::mem::take(&mut self.live_inventory)
    }

    pub(super) fn poll_key(&self, base: &str, topic: &str) -> Option<String> {
        let key = topic.strip_prefix(&format!("{base}/"))?;
        let key = key
            .strip_suffix("/set")
            .or_else(|| key.strip_suffix("/availability"))
            .unwrap_or(key);
        self.devices
            .get(key)
            .map(|meta| format!("{base}/{}/get", meta.id))
    }
    pub(super) fn poll_requests(&self, base: &str, disabled: &[String]) -> Vec<(String, Value)> {
        let mut seen = HashSet::new();
        self.devices
            .values()
            .filter(|metadata| {
                !metadata.get_fields.is_empty()
                    && !disabled.contains(&metadata.id)
                    && seen.insert(metadata.id.as_str())
            })
            .map(|metadata| {
                let payload = metadata
                    .get_fields
                    .iter()
                    .map(|field| (field.clone(), Value::String(String::new())))
                    .collect::<serde_json::Map<_, _>>();
                (
                    format!("{base}/{}/get", metadata.id),
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
        retained: bool,
        integration: &IntegrationId,
        config: &MqttConfig,
    ) -> Vec<Device> {
        let Ok(mut value) = serde_json::from_slice::<Value>(payload) else {
            return vec![];
        };
        if topic == format!("{base}/bridge/devices") {
            let Some(entries) = value.as_array() else {
                return vec![];
            };
            self.replace_inventory(entries);
            self.source = InventorySource::Live;
            self.live_inventory = true;
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
        if retained {
            strip_actions(&mut value);
        }
        if let Some(meta) = self.devices.get(key) {
            return decode(value, meta, integration, config)
                .into_iter()
                .collect();
        }
        // Do not buffer commands, availability, or unbounded arbitrary topics.
        if !key.ends_with("/set") && !key.ends_with("/get") && self.pending.len() < 1024 {
            strip_actions(&mut value);
            self.pending.insert(key.to_owned(), value);
        }
        vec![]
    }
}

/// How long after connecting a live `bridge/devices` is expected.
pub(super) const BRIDGE_DEVICES_TIMEOUT: Duration = Duration::from_secs(60);

/// Tracks whether the broker delivered a live `bridge/devices` on the current
/// connection, so a missing retained inventory is loud instead of silent.
#[derive(Default)]
pub(super) struct BridgeWatch {
    connected_at: Option<Instant>,
    live: bool,
    warned: bool,
}

impl BridgeWatch {
    pub(super) fn connected(&mut self, now: Instant) {
        *self = Self {
            connected_at: Some(now),
            ..Self::default()
        };
    }

    /// Returns true when this ends a previously warned outage.
    pub(super) fn live_received(&mut self) -> bool {
        self.live = true;
        std::mem::take(&mut self.warned)
    }

    /// Whether `check` still needs to run (connected, waiting, not warned).
    pub(super) fn armed(&self) -> bool {
        self.connected_at.is_some() && !self.live && !self.warned
    }

    /// Returns the warning once when the timeout passes without a live list.
    pub(super) fn check(
        &mut self,
        now: Instant,
        base: &str,
        discovery: &Discovery,
    ) -> Option<String> {
        let connected_at = self.connected_at?;
        if !self.armed() || now.duration_since(connected_at) < BRIDGE_DEVICES_TIMEOUT {
            return None;
        }
        self.warned = true;
        let secs = BRIDGE_DEVICES_TIMEOUT.as_secs();
        Some(match discovery.source() {
            InventorySource::None => format!(
                "No live {base}/bridge/devices received within {secs}s of connecting and no cached \
                 device metadata is available; Zigbee device reports and button actions are \
                 ignored until zigbee2mqtt publishes its device list"
            ),
            source => format!(
                "No live {base}/bridge/devices received within {secs}s of connecting; using {} \
                 device metadata ({} devices) until zigbee2mqtt publishes its device list",
                if source == InventorySource::Cached {
                    "cached (database)"
                } else {
                    "previously received"
                },
                discovery.device_count()
            ),
        })
    }

    /// Health summary: waiting, live, cached (no live list, metadata in use)
    /// or missing (no live list, nothing to decode with).
    pub(super) fn status(&self, discovery: &Discovery) -> &'static str {
        if self.live {
            "live"
        } else if !self.warned {
            "waiting"
        } else if discovery.source() == InventorySource::None {
            "missing"
        } else {
            "cached"
        }
    }
}

/// Database cache key for one base topic's inventory. Including the base
/// topic keeps a changed integration config from reusing another inventory.
pub(super) fn cache_key(base: &str) -> String {
    format!("{base}/bridge/devices")
}

/// Avoids rewriting an unchanged (possibly large) inventory on every
/// republish or reconnect.
#[derive(Default)]
pub(super) struct StoredInventory(Option<u64>);

impl StoredInventory {
    fn digest(payload: &[u8]) -> u64 {
        let mut hasher = DefaultHasher::new();
        payload.hash(&mut hasher);
        hasher.finish()
    }

    pub(super) fn remember(&mut self, payload: &[u8]) {
        self.0 = Some(Self::digest(payload));
    }

    pub(super) fn forget(&mut self) {
        self.0 = None;
    }

    /// True when `payload` differs from the stored copy (and records it).
    pub(super) fn needs_store(&mut self, payload: &[u8]) -> bool {
        let digest = Some(Self::digest(payload));
        if self.0 == digest {
            return false;
        }
        self.0 = digest;
        true
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
        // Hue (and other) lights map HS through their own gamut model, so the
        // XY they report back never matches our HS->XY conversion. When the
        // device accepts XY, send XY so the reported chromaticity is exactly
        // what we requested and drift correction can compare like with like.
        // CT stays in its native mode.
        let color = if data.capabilities.xy && !matches!(color, DeviceColor::Ct(_)) {
            DeviceColor::Xy(color.to_xy().ok_or_else(|| eyre!("Unsupported color"))?)
        } else {
            color
                .to_device_preferred_mode(&data.capabilities)
                .ok_or_else(|| eyre!("Unsupported color"))?
        };
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
    fn polling_deduplicates_aliases_and_only_reads_get_capable_enabled_lights() {
        let mut inventory = inventory();
        inventory[0]["definition"]["exposes"][0]["features"][1]["access"] = json!(3);
        let mut disabled = inventory[0].clone();
        disabled["ieee_address"] = json!("disabled");
        disabled["friendly_name"] = json!("Disabled");
        disabled["disabled"] = json!(true);
        inventory.as_array_mut().unwrap().push(disabled);
        let mut discovery = Discovery::default();
        discovery.receive(
            "z",
            "z/bridge/devices",
            &serde_json::to_vec(&inventory).unwrap(),
            false,
            &"zigbee".parse().unwrap(),
            &MqttConfig::default(),
        );
        assert!(discovery.poll_requests("z", &["0x123".into()]).is_empty());
        assert_eq!(
            discovery.poll_requests("z", &[]),
            vec![(
                "z/0x123/get".into(),
                json!({"state":"", "color":"", "color_temp":""})
            )]
        );
        assert_eq!(
            discovery.poll_key("z", "z/Office/set"),
            Some("z/0x123/get".into())
        );
        assert_eq!(
            discovery.poll_key("z", "z/0x123/availability"),
            Some("z/0x123/get".into())
        );
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
                false,
                &integration,
                &config
            )
            .is_empty());
        let devices = discovery.receive(
            "z",
            "z/bridge/devices",
            &serde_json::to_vec(&inventory()).unwrap(),
            false,
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
                false,
                &integration,
                &config
            )
            .is_empty());
    }

    fn receive(
        discovery: &mut Discovery,
        topic: &str,
        payload: &Value,
        retained: bool,
    ) -> Vec<Device> {
        discovery.receive(
            "z",
            topic,
            &serde_json::to_vec(payload).unwrap(),
            retained,
            &"zigbee".parse().unwrap(),
            &dimmer_config(),
        )
    }

    fn dimmer_config() -> MqttConfig {
        MqttConfig {
            sensor_value_fields: Some(vec![jsonptr::PointerBuf::from_tokens(["action"])]),
            ..Default::default()
        }
    }

    fn inventory_with_dimmer() -> Value {
        let mut inventory = inventory();
        inventory.as_array_mut().unwrap().push(json!({
            "ieee_address": "0xdim",
            "friendly_name": "Dimmer",
            "definition": {"exposes": [{"name": "action", "type": "enum", "access": 1}]}
        }));
        inventory
    }

    fn action_of(device: &Device) -> Option<Value> {
        device
            .raw
            .as_ref()
            .and_then(|raw| raw.get("action").cloned())
    }

    #[test]
    fn cached_inventory_decodes_state_and_live_actions_immediately() {
        let mut discovery = Discovery::default();
        assert!(!discovery.load_cached(b""));
        assert!(!discovery.load_cached(b"{}"));
        assert_eq!(discovery.source(), InventorySource::None);
        assert!(discovery.load_cached(&serde_json::to_vec(&inventory_with_dimmer()).unwrap()));
        assert_eq!(discovery.source(), InventorySource::Cached);
        assert_eq!(discovery.device_count(), 2);
        // A cache load is not a live inventory and must not be re-persisted.
        assert!(!discovery.take_live_inventory());
        // Polling can start before any broker message.
        assert_eq!(discovery.poll_requests("z", &[]).len(), 1);

        let lights = receive(&mut discovery, "z/Office", &json!({"state": "ON"}), false);
        assert_eq!(lights.len(), 1);
        assert_eq!(lights[0].id.to_string(), "0x123");

        let presses = receive(&mut discovery, "z/Dimmer", &json!({"action": "on"}), false);
        assert_eq!(presses.len(), 1);
        assert_eq!(action_of(&presses[0]), Some(json!("on")));
    }

    #[test]
    fn live_inventory_replaces_cache_and_is_flagged_for_persistence() {
        let mut discovery = Discovery::default();
        assert!(discovery.load_cached(&serde_json::to_vec(&inventory_with_dimmer()).unwrap()));
        // zigbee2mqtt clears the retained inventory with an empty payload.
        assert!(receive(&mut discovery, "z/bridge/devices", &json!(""), true).is_empty());
        assert!(!discovery.take_live_inventory());
        assert_eq!(discovery.source(), InventorySource::Cached);

        receive(&mut discovery, "z/bridge/devices", &inventory(), true);
        assert_eq!(discovery.source(), InventorySource::Live);
        assert!(discovery.take_live_inventory());
        assert!(!discovery.take_live_inventory());
        assert_eq!(discovery.device_count(), 1);
        // The removed dimmer is no longer decoded (and its press is not buffered).
        assert!(receive(&mut discovery, "z/Dimmer", &json!({"action": "on"}), false).is_empty());
        // A stale cache never overrides a live inventory.
        assert!(!discovery.load_cached(&serde_json::to_vec(&inventory_with_dimmer()).unwrap()));

        let mut stored = StoredInventory::default();
        let payload = serde_json::to_vec(&inventory()).unwrap();
        stored.remember(&payload);
        assert!(!stored.needs_store(&payload));
        let changed = serde_json::to_vec(&inventory_with_dimmer()).unwrap();
        assert!(stored.needs_store(&changed));
        assert!(!stored.needs_store(&changed));
        stored.forget();
        assert!(stored.needs_store(&changed));
    }

    #[test]
    fn button_presses_are_never_replayed_late() {
        let mut discovery = Discovery::default();
        // Before any inventory: a press and a light report are buffered.
        assert!(receive(&mut discovery, "z/Dimmer", &json!({"action": "on"}), false).is_empty());
        assert!(receive(&mut discovery, "z/Office", &json!({"state": "ON"}), false).is_empty());
        let replayed = receive(
            &mut discovery,
            "z/bridge/devices",
            &inventory_with_dimmer(),
            true,
        );
        // Only the light state is replayed; the old press is dropped.
        assert_eq!(replayed.len(), 1);
        assert_eq!(replayed[0].id.to_string(), "0x123");

        // A retained press (e.g. device retain enabled) is not an event either.
        assert!(receive(&mut discovery, "z/Dimmer", &json!({"action": "on"}), true).is_empty());
        let retained = receive(
            &mut discovery,
            "z/Office",
            &json!({"state": "OFF", "action": "toggle"}),
            true,
        );
        assert_eq!(retained.len(), 1);
        assert_eq!(action_of(&retained[0]), None);
    }

    #[test]
    fn bridge_watch_warns_once_and_reports_status() {
        let start = Instant::now();
        let mut watch = BridgeWatch::default();
        let mut discovery = Discovery::default();
        assert!(!watch.armed());
        watch.connected(start);
        assert!(watch.armed());
        assert_eq!(watch.status(&discovery), "waiting");
        assert!(watch
            .check(start + Duration::from_secs(59), "z", &discovery)
            .is_none());

        let warning = watch
            .check(start + BRIDGE_DEVICES_TIMEOUT, "z", &discovery)
            .unwrap();
        assert!(warning.contains("z/bridge/devices") && warning.contains("no cached"));
        assert_eq!(watch.status(&discovery), "missing");
        assert!(!watch.armed());
        assert!(watch
            .check(start + Duration::from_secs(120), "z", &discovery)
            .is_none());

        // With cached metadata, the warning says so.
        assert!(discovery.load_cached(&serde_json::to_vec(&inventory()).unwrap()));
        watch.connected(start);
        let warning = watch
            .check(start + BRIDGE_DEVICES_TIMEOUT, "z", &discovery)
            .unwrap();
        assert!(warning.contains("cached (database)") && warning.contains("1 devices"));
        assert_eq!(watch.status(&discovery), "cached");

        // A live list ends the outage; a reconnect starts a new wait.
        assert!(watch.live_received());
        assert_eq!(watch.status(&discovery), "live");
        assert!(!watch.armed());
        watch.connected(start);
        assert!(!watch.live_received());
    }

    #[test]
    fn hs_reports_are_scaled_and_encoded_as_xy_when_supported() {
        let mut inventory = inventory();
        inventory[0]["definition"]["exposes"][0]["features"][2]["access"] = json!(1);
        let meta = metadata(&inventory[0]).unwrap();
        assert!(meta.capabilities.ct.is_none());
        let device = decode(json!({"state":"ON","color_mode":"hs","color":{"hue":120,"saturation":50,"x":0.3,"y":0.3},"color_temp":250}), &meta, &"zigbee".parse().unwrap(), &MqttConfig::default()).unwrap();
        let DeviceData::Controllable(data) = &device.data else {
            panic!()
        };
        assert_eq!(data.state.color, Some(DeviceColor::new_from_hs(120, 0.5)));
        // Hue-style bulbs map HS through their own gamut model; send XY so the
        // reported chromaticity matches our conversion exactly.
        let expected = DeviceColor::new_from_hs(120, 0.5).to_xy().unwrap();
        assert_eq!(
            encode(&device).unwrap()["color"],
            json!({"x": expected.x, "y": expected.y})
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
