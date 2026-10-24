//! OpenMQTTGateway BLE sensors. Gateways publish each decoded advertisement as
//! JSON on `{base}/<gateway>/BTtoMQTT/<MAC>`; every allowlisted MAC becomes one
//! multi-reading sensor, whichever gateway heard it.
//!
//! Sensors advertise every few seconds and nearby gateways repeat the same
//! advertisement, so a reading is only reported when its rounded value changes,
//! or every [`KEEPALIVE`] to show the sensor is still alive.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::types::{
    device::{Device, DeviceData, DeviceId, SensorDevice},
    integration::IntegrationId,
};

use super::MqttConfig;

pub const DEFAULT_BASE_TOPIC: &str = "home";
const GATEWAY_TOPIC: &str = "BTtoMQTT";
pub const KEEPALIVE: Duration = Duration::from_secs(300);

/// OpenMQTTGateway field → homectl metric, rounded to `1 / scale`.
const METRICS: [(&str, &str, f64); 3] = [
    ("tempc", "temperature", 10.0),
    ("hum", "humidity", 10.0),
    ("batt", "battery", 1.0),
];

pub fn subscription(base: &str) -> String {
    format!("{base}/+/{GATEWAY_TOPIC}/+")
}

/// Canonical sensor id: the MAC as 12 upper-case hex digits, as the gateways
/// use in topics (and InfluxDB in `device_id`).
pub fn normalize_mac(value: &str) -> Option<String> {
    let mac: String = value
        .chars()
        .filter(|c| !matches!(c, ':' | '-'))
        .collect::<String>()
        .to_ascii_uppercase();
    (mac.len() == 12 && mac.chars().all(|c| c.is_ascii_hexdigit())).then_some(mac)
}

struct Reported {
    readings: BTreeMap<String, f64>,
    at: Instant,
}

#[derive(Default)]
pub struct Sensors {
    reported: HashMap<String, Reported>,
}

impl Sensors {
    pub fn receive(
        &mut self,
        base: &str,
        topic: &str,
        payload: &[u8],
        integration_id: IntegrationId,
        config: &MqttConfig,
        now: Instant,
    ) -> Option<Device> {
        let mut segments = topic.strip_prefix(base)?.strip_prefix('/')?.split('/');
        let (Some(gateway), Some(GATEWAY_TOPIC), Some(mac), None) = (
            segments.next(),
            segments.next(),
            segments.next(),
            segments.next(),
        ) else {
            return None;
        };
        let mac = normalize_mac(mac)?;
        let names = config
            .ble_devices
            .as_ref()
            .filter(|names| !names.is_empty());
        if names.is_some_and(|names| !names.contains_key(&mac)) {
            return None;
        }

        let value: Value = serde_json::from_slice(payload).ok()?;
        let incoming: BTreeMap<String, f64> = METRICS
            .iter()
            .filter_map(|(field, metric, scale)| {
                let raw = value.get(field)?.as_f64().filter(|v| v.is_finite())?;
                Some((metric.to_string(), (raw * scale).round() / scale))
            })
            .collect();
        // Not a climate sensor (or a packet without readings).
        if incoming.is_empty() {
            return None;
        }

        // Some sensors alternate packets carrying different fields.
        let previous = self.reported.get(&mac);
        let mut readings = previous
            .map(|reported| reported.readings.clone())
            .unwrap_or_default();
        readings.extend(incoming);
        if previous.is_some_and(|reported| {
            reported.readings == readings && now.duration_since(reported.at) < KEEPALIVE
        }) {
            return None;
        }
        self.reported.insert(
            mac.clone(),
            Reported {
                readings: readings.clone(),
                at: now,
            },
        );

        let text = |key: &str| value.get(key).and_then(Value::as_str);
        let name = names
            .and_then(|names| names.get(&mac))
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let model = [text("brand"), text("model")]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                let suffix = &mac[8..];
                if model.is_empty() {
                    format!("BLE sensor {suffix}")
                } else {
                    format!("{model} {suffix}")
                }
            });

        Some(Device::new(
            integration_id,
            DeviceId::new(&mac),
            name,
            DeviceData::Sensor(SensorDevice::Readings { readings }),
            Some(json!({
                "gateway": gateway,
                "rssi": value.get("rssi"),
                "brand": text("brand"),
                "model": text("model"),
                "model_id": text("model_id"),
            })),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SWITCHBOT: &str = r#"{"id":"C7:6A:00:46:20:55","rssi":-56,"brand":"SwitchBot","model":"Outdoor Meter","model_id":"W340001X","type":"THB","tempc":25.5,"tempf":77.9,"hum":33,"batt":68,"mac":"C7:6A:00:46:20:55"}"#;

    fn config(devices: &[(&str, &str)]) -> MqttConfig {
        MqttConfig {
            ble_devices: Some(
                devices
                    .iter()
                    .map(|(mac, name)| (mac.to_string(), name.to_string()))
                    .collect(),
            ),
            ..Default::default()
        }
    }

    fn readings(device: &Device) -> &BTreeMap<String, f64> {
        match &device.data {
            DeviceData::Sensor(SensorDevice::Readings { readings }) => readings,
            other => panic!("expected readings, got {other:?}"),
        }
    }

    fn receive(
        sensors: &mut Sensors,
        topic: &str,
        payload: &str,
        config: &MqttConfig,
        now: Instant,
    ) -> Option<Device> {
        sensors.receive(
            "home/sensors",
            topic,
            payload.as_bytes(),
            "ble".parse().unwrap(),
            config,
            now,
        )
    }

    #[test]
    fn decodes_climate_readings_with_configured_name() {
        let config = config(&[("C76A00462055", "Patio")]);
        let device = receive(
            &mut Sensors::default(),
            "home/sensors/ble3/BTtoMQTT/C76A00462055",
            SWITCHBOT,
            &config,
            Instant::now(),
        )
        .unwrap();
        assert_eq!(device.id.to_string(), "C76A00462055");
        assert_eq!(device.name, "Patio");
        assert_eq!(
            readings(&device),
            &BTreeMap::from([
                ("battery".to_string(), 68.0),
                ("humidity".to_string(), 33.0),
                ("temperature".to_string(), 25.5),
            ])
        );
        assert_eq!(device.raw.as_ref().unwrap()["gateway"], "ble3");
    }

    #[test]
    fn allowlist_drops_unlisted_and_non_climate_devices() {
        let mut sensors = Sensors::default();
        let listed = config(&[("C76A00462055", "Patio")]);
        let other = "home/sensors/ble3/BTtoMQTT/C76A0246647E";
        assert!(receive(&mut sensors, other, SWITCHBOT, &listed, Instant::now()).is_none());

        // Without an allowlist every climate sensor is accepted, but not other
        // BLE advertisements such as phones.
        let open = MqttConfig::default();
        assert!(receive(&mut sensors, other, SWITCHBOT, &open, Instant::now()).is_some());
        let phone = r#"{"id":"AA:BB:CC:DD:EE:FF","rssi":-70,"manufacturerdata":"4c00"}"#;
        let phone_topic = "home/sensors/ble3/BTtoMQTT/AABBCCDDEEFF";
        assert!(receive(&mut sensors, phone_topic, phone, &open, Instant::now()).is_none());
        let status = "home/sensors/ble3/BTtoMQTT/status";
        assert!(receive(&mut sensors, status, SWITCHBOT, &open, Instant::now()).is_none());
    }

    #[test]
    fn merges_gateways_and_throttles_unchanged_readings() {
        let config = config(&[("C48D1E3E5767", "")]);
        let mut sensors = Sensors::default();
        let start = Instant::now();
        let ruuvi = |temp: f64| {
            format!(r#"{{"brand":"Ruuvi","model":"RuuviTag","tempc":{temp},"hum":73.901875}}"#)
        };
        let first = receive(
            &mut sensors,
            "home/sensors/ble3/BTtoMQTT/C48D1E3E5767",
            &ruuvi(21.404),
            &config,
            start,
        )
        .unwrap();
        assert_eq!(first.name, "Ruuvi RuuviTag 5767");
        assert_eq!(readings(&first)["humidity"], 73.9);

        // The other gateway repeats the same advertisement: nothing new.
        let repeat = receive(
            &mut sensors,
            "home/sensors/ble4/BTtoMQTT/C48D1E3E5767",
            &ruuvi(21.396),
            &config,
            start + Duration::from_secs(2),
        );
        assert!(repeat.is_none());

        let changed = receive(
            &mut sensors,
            "home/sensors/ble4/BTtoMQTT/C48D1E3E5767",
            &ruuvi(21.5),
            &config,
            start + Duration::from_secs(4),
        )
        .unwrap();
        assert_eq!(first.get_device_key(), changed.get_device_key());
        assert_eq!(readings(&changed)["temperature"], 21.5);

        // A partial packet keeps earlier metrics.
        let battery = receive(
            &mut sensors,
            "home/sensors/ble4/BTtoMQTT/C48D1E3E5767",
            r#"{"batt":90}"#,
            &config,
            start + Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(readings(&battery).len(), 3);

        let keepalive = receive(
            &mut sensors,
            "home/sensors/ble3/BTtoMQTT/C48D1E3E5767",
            r#"{"batt":90}"#,
            &config,
            start + Duration::from_secs(5) + KEEPALIVE,
        );
        assert!(keepalive.is_some());
    }

    #[test]
    fn normalizes_mac_addresses() {
        assert_eq!(
            normalize_mac("c4:8d:1e:3e:57:67").as_deref(),
            Some("C48D1E3E5767")
        );
        assert_eq!(normalize_mac("status"), None);
        assert_eq!(normalize_mac("C48D1E3E576"), None);
    }
}
