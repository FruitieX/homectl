#![allow(clippy::redundant_closure_call)]

mod esphome;
mod polling;
mod utils;
mod zigbee2mqtt;

use crate::{
    types::{
        color::Capabilities,
        device::{Device, ManageKind},
        event::{Event, TxEventChannel},
        integration::{Integration, IntegrationActionPayload, IntegrationId},
    },
    utils::cli::Cli,
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::{eyre, Context};
use rand::{distr::Alphanumeric, RngExt};
use rumqttc::{AsyncClient, MqttOptions, QoS};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::integrations::mqtt::utils::{mqtt_to_homectl, validate_mqtt_topic_template};

use self::utils::homectl_to_mqtt;

fn configure_packet_limits(options: &mut MqttOptions, mode: MqttMode) {
    if mode == MqttMode::Zigbee2Mqtt {
        // Bridge metadata is much larger than individual device reports.
        options.set_max_packet_size(4 * 1024 * 1024, 64 * 1024);
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum MqttMode {
    #[serde(rename = "generic")]
    Generic,
    #[serde(rename = "zigbee2mqtt")]
    Zigbee2Mqtt,
    #[serde(rename = "esphome")]
    EspHome,
}

#[derive(Default, Debug, Deserialize, Clone)]
pub struct MqttConfig {
    /// Explicit protocol profile. Missing values are inferred for legacy configs.
    mode: Option<MqttMode>,
    /// Enable the Zigbee2MQTT wire format and discovery for this base topic.
    zigbee2mqtt_base_topic: Option<String>,
    /// Poll GET-capable Zigbee2MQTT devices when attribute reporting is unavailable.
    zigbee2mqtt_poll_interval_secs: Option<u64>,
    /// ESPHome MQTT light topic prefix and light object id.
    esphome_base_topic: Option<String>,
    esphome_light_object_id: Option<String>,
    /// Home Assistant MQTT discovery prefix used by ESPHome (default: homeassistant).
    esphome_discovery_prefix: Option<String>,
    esphome_warm_white_kelvin: Option<u16>,
    esphome_cold_white_kelvin: Option<u16>,
    #[serde(default)]
    disabled_device_ids: Vec<String>,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    #[serde(default)]
    topic: String,
    #[serde(default)]
    topic_set: String,

    /// Can be used to control whether the devices published by this integration
    /// are "managed" or not, i.e.  whether homectl should keep track of the
    /// devices' expected states or not.
    managed: Option<ManageKind>,

    id_field: Option<jsonptr::PointerBuf>,
    name_field: Option<jsonptr::PointerBuf>,
    color_field: Option<jsonptr::PointerBuf>,
    power_field: Option<jsonptr::PointerBuf>,
    power_on_value: Option<serde_json::Value>,
    power_off_value: Option<serde_json::Value>,
    brightness_field: Option<jsonptr::PointerBuf>,
    brightness_range: Option<(f32, f32)>,
    sensor_value_fields: Option<Vec<jsonptr::PointerBuf>>,
    transition_field: Option<jsonptr::PointerBuf>,
    transition_range: Option<(f32, f32)>,
    default_transition: Option<f32>,
    capabilities_field: Option<jsonptr::PointerBuf>,
    capabilities_override: Option<Capabilities>,
    raw_field: Option<jsonptr::PointerBuf>,
    include_id_name_in_set_payload: Option<bool>,
    /// Generic MQTT retains commands by default for backwards compatibility.
    retain_commands: Option<bool>,
}

impl MqttConfig {
    fn mode(&self) -> MqttMode {
        self.mode.unwrap_or_else(|| {
            if self
                .zigbee2mqtt_base_topic
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty())
            {
                MqttMode::Zigbee2Mqtt
            } else {
                MqttMode::Generic
            }
        })
    }
}

pub struct Mqtt {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: MqttConfig,
    cli: Cli,
    client: Option<AsyncClient>,
    tasks: tokio::task::JoinSet<()>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CustomMqttAction {
    topic: String,
    json: String,
}

fn normalize_topic_prefix(value: Option<String>, label: &str, default: &str) -> Result<String> {
    let value = value
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.to_owned());
    let value = value.trim().trim_end_matches('/').to_owned();
    if value.is_empty() {
        return Err(eyre!("MQTT {label} must not be empty"));
    }
    validate_mqtt_topic_template(&value, false, false)
        .wrap_err_with(|| format!("Invalid MQTT {label} '{value}'"))?;
    Ok(value)
}

fn normalize_topic_segment(value: Option<String>, label: &str, default: &str) -> Result<String> {
    let value = value
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.to_owned());
    let value = value.trim().to_owned();
    if value.is_empty()
        || value.contains(['/', '#', '+', '{', '}', '\0'])
        || value.chars().any(char::is_whitespace)
    {
        return Err(eyre!(
            "MQTT ESPHome {label} must be one non-empty topic segment"
        ));
    }
    Ok(value)
}

fn normalize_config(mut config: MqttConfig) -> Result<MqttConfig> {
    if config.host.trim().is_empty() {
        return Err(eyre!("MQTT host is required"));
    }
    if config.port == 0 {
        return Err(eyre!("MQTT port must be between 1 and 65535"));
    }
    config.host = config.host.trim().to_owned();

    let mode = config.mode();
    match mode {
        MqttMode::Generic => {
            if config.topic.trim().is_empty() || config.topic_set.trim().is_empty() {
                return Err(eyre!("Generic MQTT requires both 'topic' and 'topic_set'"));
            }
            validate_mqtt_topic_template(&config.topic, false, true)
                .wrap_err("Invalid generic MQTT state topic")?;
            validate_mqtt_topic_template(&config.topic_set, true, false)
                .wrap_err("Invalid generic MQTT command topic")?;
            config.mode = Some(MqttMode::Generic);
        }
        MqttMode::Zigbee2Mqtt => {
            let base = normalize_topic_prefix(
                config.zigbee2mqtt_base_topic.take(),
                "Zigbee2MQTT base topic",
                "zigbee2mqtt",
            )?;
            config.zigbee2mqtt_base_topic = Some(base.clone());
            config.topic = format!("{base}/{{id}}");
            config.topic_set = format!("{base}/{{id}}/set");
            config.mode = Some(MqttMode::Zigbee2Mqtt);
        }
        MqttMode::EspHome => {
            let base = normalize_topic_prefix(
                config.esphome_base_topic.take(),
                "ESPHome base topic",
                "esphome",
            )?;
            let discovery_prefix = normalize_topic_prefix(
                config.esphome_discovery_prefix.take(),
                "ESPHome discovery prefix",
                "homeassistant",
            )?;
            let light_object_id = normalize_topic_segment(
                config.esphome_light_object_id.take(),
                "light object id",
                "light",
            )?;
            let warm_kelvin = config.esphome_warm_white_kelvin.unwrap_or(2700);
            let cold_kelvin = config.esphome_cold_white_kelvin.unwrap_or(6500);
            if warm_kelvin == 0 || cold_kelvin == 0 {
                return Err(eyre!(
                    "ESPHome warm and cold white Kelvin values must be > 0"
                ));
            }
            if warm_kelvin >= cold_kelvin {
                return Err(eyre!(
                    "ESPHome warm white Kelvin must be lower than cold white Kelvin"
                ));
            }
            config.esphome_base_topic = Some(base.clone());
            config.esphome_light_object_id = Some(light_object_id.clone());
            config.esphome_discovery_prefix = Some(discovery_prefix);
            config.esphome_warm_white_kelvin = Some(warm_kelvin);
            config.esphome_cold_white_kelvin = Some(cold_kelvin);
            config.topic = format!("{base}/{{id}}/light/{light_object_id}/state");
            config.topic_set = format!("{base}/{{id}}/light/{light_object_id}/command");
            config.mode = Some(MqttMode::EspHome);
        }
    }

    Ok(config)
}

fn retain_commands(config: &MqttConfig) -> bool {
    match config.mode() {
        MqttMode::Generic => config.retain_commands.unwrap_or(true),
        MqttMode::Zigbee2Mqtt | MqttMode::EspHome => false,
    }
}

#[async_trait]
impl Integration for Mqtt {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config: MqttConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Mqtt integration")?;
        let config = normalize_config(config)?;

        Ok(Mqtt {
            id: id.clone(),
            config,
            cli: cli.clone(),
            event_tx,
            client: None,
            tasks: tokio::task::JoinSet::new(),
        })
    }

    async fn start(&mut self) -> Result<()> {
        self.stop().await?;
        let random_string: String = rand::rng()
            .sample_iter(&Alphanumeric)
            .take(8)
            .map(char::from)
            .collect();

        let mut options = MqttOptions::new(
            format!("{}-{}", self.id, random_string),
            self.config.host.clone(),
            self.config.port,
        );
        options.set_keep_alive(Duration::from_secs(5));
        configure_packet_limits(&mut options, self.config.mode());

        // Set credentials if provided
        if let Some(username) = &self.config.username {
            options.set_credentials(username, self.config.password.as_deref().unwrap_or(""));
        }

        let (client, mut eventloop) = AsyncClient::new(options, 10);

        self.client = Some(client.clone());

        let id = self.id.clone();
        let event_tx = self.event_tx.clone();
        let config = Arc::new(self.config.clone());

        let dry_run = self.cli.dry_run;
        self.tasks.spawn(async move {
            let mut discovery = zigbee2mqtt::Discovery::default();
            let mut esphome_discovery = esphome::Discovery::default();
            let mut polling = polling::Polling::configured(
                config.mode() == MqttMode::Zigbee2Mqtt,
                dry_run,
                config.zigbee2mqtt_poll_interval_secs,
            );
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut connected = false;
            loop {
                let notification = tokio::select! {
                    notification = eventloop.poll() => notification,
                    _ = tick.tick(), if polling.is_some() && connected => {
                        polling.as_mut().unwrap().publish_due(&client, Instant::now());
                        continue;
                    }
                };

                let id = id.clone();
                let event_tx = event_tx.clone();
                let config = Arc::clone(&config);

                let res = (|| async {
                    match notification? {
                        rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_)) => {
                            connected = true;
                            if let Some(base) = &config.zigbee2mqtt_base_topic {
                                if config.mode() == MqttMode::Zigbee2Mqtt {
                                    client
                                        .subscribe(
                                            format!("{base}/bridge/devices"),
                                            QoS::AtLeastOnce,
                                        )
                                        .await?;
                                }
                            }
                            match config.mode() {
                                MqttMode::Generic => {
                                    client
                                        .subscribe(
                                            config.topic.replace("{id}", "+"),
                                            QoS::AtMostOnce,
                                        )
                                        .await?;
                                }
                                MqttMode::Zigbee2Mqtt => {
                                    let base = config.zigbee2mqtt_base_topic.as_ref().unwrap();
                                    client
                                        .subscribe(format!("{base}/#"), QoS::AtMostOnce)
                                        .await?;
                                }
                                MqttMode::EspHome => {
                                    let state_topic = config.topic.replace("{id}", "+");
                                    client.subscribe(state_topic, QoS::AtMostOnce).await?;
                                    let base = config.esphome_base_topic.as_ref().unwrap();
                                    client
                                        .subscribe(format!("{base}/+/status"), QoS::AtMostOnce)
                                        .await?;
                                    let prefix = config.esphome_discovery_prefix.as_ref().unwrap();
                                    client
                                        .subscribe(format!("{prefix}/light/#"), QoS::AtMostOnce)
                                        .await?;
                                }
                            }
                        }

                        rumqttc::Event::Incoming(rumqttc::Packet::Publish(msg)) => {
                            let devices = match config.mode() {
                                MqttMode::Generic => {
                                    mqtt_to_homectl(&msg.payload, &msg.topic, id.clone(), &config)
                                        .into_iter()
                                        .collect()
                                }
                                MqttMode::Zigbee2Mqtt => {
                                    let base = config.zigbee2mqtt_base_topic.as_ref().unwrap();
                                    discovery.receive(base, &msg.topic, &msg.payload, &id, &config)
                                }
                                MqttMode::EspHome => {
                                    let prefix = config.esphome_discovery_prefix.as_ref().unwrap();
                                    if msg.topic.starts_with(&format!("{prefix}/light/")) {
                                        esphome_discovery.receive(
                                            prefix,
                                            &msg.topic,
                                            &msg.payload,
                                            id.clone(),
                                            &config,
                                        )
                                    } else {
                                        esphome_discovery.state(
                                            &msg.payload,
                                            &msg.topic,
                                            id.clone(),
                                            &config,
                                        )
                                    }
                                }
                            };

                            if config.mode() == MqttMode::Zigbee2Mqtt {
                                let base = config.zigbee2mqtt_base_topic.as_ref().unwrap();
                                if let Some(scheduler) = polling.as_mut() {
                                    let now = Instant::now();
                                    if msg.topic == format!("{base}/bridge/devices") {
                                        scheduler.sync(
                                            discovery
                                                .poll_requests(base, &config.disabled_device_ids),
                                            now,
                                        );
                                    } else if let Some(key) = discovery.poll_key(base, &msg.topic) {
                                        let value = serde_json::from_slice::<serde_json::Value>(
                                            &msg.payload,
                                        )
                                        .unwrap_or_default();
                                        if msg.topic.ends_with("/availability") {
                                            let state =
                                                value.as_str().or_else(|| value["state"].as_str());
                                            if let Some(state) = state {
                                                scheduler.availability(&key, state == "online");
                                            }
                                        } else if !msg.retain && msg.topic.ends_with("/set") {
                                            scheduler.command(
                                                &key,
                                                value["transition"].as_f64().unwrap_or(0.0),
                                                now,
                                            );
                                        } else if !msg.retain && !devices.is_empty() {
                                            scheduler.report(&key, now);
                                        }
                                    }
                                }
                            }
                            if config.mode() == MqttMode::Zigbee2Mqtt
                                && msg.topic.ends_with("/availability")
                            {
                                let base = config.zigbee2mqtt_base_topic.as_ref().unwrap();
                                if let Some(key) = discovery.poll_key(base, &msg.topic) {
                                    let value =
                                        serde_json::from_slice::<serde_json::Value>(&msg.payload)
                                            .unwrap_or_default();
                                    if let Some(status @ ("online" | "offline")) =
                                        value.as_str().or_else(|| value["state"].as_str())
                                    {
                                        let device_id = key
                                            .trim_start_matches(&format!("{base}/"))
                                            .trim_end_matches("/get");
                                        event_tx.send(Event::DeviceAvailability {
                                            device_key: crate::types::device::DeviceKey::new(
                                                id.clone(),
                                                crate::types::device::DeviceId::new(device_id),
                                            ),
                                            online: status == "online",
                                            observed_at_ms: if msg.retain {
                                                0
                                            } else {
                                                chrono::Utc::now().timestamp_millis()
                                            },
                                            integration_epoch: None,
                                        });
                                    }
                                }
                            } else if config.mode() == MqttMode::EspHome {
                                if let Some((device_id, online)) = esphome::availability(
                                    config.esphome_base_topic.as_ref().unwrap(),
                                    &msg.topic,
                                    &msg.payload,
                                ) {
                                    let observed_at_ms = if msg.retain {
                                        0
                                    } else {
                                        chrono::Utc::now().timestamp_millis()
                                    };
                                    esphome_discovery.remember_availability(
                                        &device_id,
                                        online,
                                        observed_at_ms,
                                    );
                                    event_tx.send(Event::DeviceAvailability {
                                        device_key: crate::types::device::DeviceKey::new(
                                            id.clone(),
                                            crate::types::device::DeviceId::new(&device_id),
                                        ),
                                        online,
                                        observed_at_ms,
                                        integration_epoch: None,
                                    });
                                }
                            }
                            for mut device in devices {
                                if let crate::types::device::DeviceData::Controllable(data) =
                                    &mut device.data
                                {
                                    data.last_report =
                                        Some(Box::new(crate::types::device::DeviceReport {
                                            state: data.state.clone(),
                                            received_at_ms: chrono::Utc::now().timestamp_millis(),
                                            // Buffered discovery replay has unknown original freshness.
                                            retained: msg.retain
                                                || (config.mode() == MqttMode::Zigbee2Mqtt
                                                    && config
                                                        .zigbee2mqtt_base_topic
                                                        .as_ref()
                                                        .is_some_and(|base| {
                                                            msg.topic
                                                                == format!("{base}/bridge/devices")
                                                        })),
                                            matches_requested: false,
                                        }));
                                }
                                let event = Event::ExternalStateUpdate {
                                    device,
                                    integration_epoch: None,
                                };
                                event_tx.send(event);
                            }
                        }
                        _ => {}
                    }

                    Ok::<(), Box<dyn std::error::Error + Sync + Send>>(())
                })()
                .await;

                if let Err(e) = res {
                    connected = false;
                    error!(
                        target: &format!("homectl_server::integrations::mqtt::{id}"),
                        "MQTT error: {e:?}"
                    );
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        });

        Ok(())
    }
    async fn stop(&mut self) -> Result<()> {
        self.tasks.shutdown().await;
        self.client = None;
        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        let client = self.client.as_ref().ok_or_else(|| {
            eyre!("MQTT client is not initialized; start phase has not completed")
        })?;

        let topic = self
            .config
            .topic_set
            .replace("{id}", &device.id.to_string())
            .replace("{name}", &device.name.to_string());

        let mode = self.config.mode();
        let mut mqtt_device = match mode {
            MqttMode::Generic => homectl_to_mqtt(device.clone(), &self.config)?,
            MqttMode::Zigbee2Mqtt => zigbee2mqtt::encode(device)?,
            MqttMode::EspHome => esphome::encode(device, &self.config)?,
        };
        if mode != MqttMode::EspHome && mqtt_device.get("transition").is_none() {
            if let Some(transition) = self.config.default_transition {
                mqtt_device["transition"] = serde_json::json!(transition);
            }
        };
        let json = serde_json::to_string(&mqtt_device)?;

        if !self.cli.dry_run {
            client
                .publish(topic, QoS::AtLeastOnce, retain_commands(&self.config), json)
                .await?;
        } else {
            debug!("(dry run) would publish device state: {device}");
        }

        Ok(())
    }

    /// Can be used for pushing arbitrary values to the MQTT broker
    async fn run_integration_action(&mut self, payload: &IntegrationActionPayload) -> Result<()> {
        let action: CustomMqttAction = serde_json::from_str(&payload.to_string())?;

        let client = self.client.as_ref().ok_or_else(|| {
            eyre!("MQTT client is not initialized; start phase has not completed")
        })?;

        client
            .publish(action.topic, QoS::AtLeastOnce, true, action.json)
            .await?;

        Ok(())
    }
}

#[cfg(test)]
mod packet_tests {
    use super::*;
    use serde_json::json;

    fn normalized(value: serde_json::Value) -> MqttConfig {
        normalize_config(serde_json::from_value(value).unwrap()).unwrap()
    }

    #[test]
    fn legacy_zigbee_config_infers_the_zigbee_profile() {
        let config = normalized(json!({
            "host": "mqtt.example.org",
            "port": 1883,
            "zigbee2mqtt_base_topic": "zigbee2mqtt"
        }));
        assert_eq!(config.mode(), MqttMode::Zigbee2Mqtt);
        assert_eq!(config.topic, "zigbee2mqtt/{id}");
        assert_eq!(config.topic_set, "zigbee2mqtt/{id}/set");
        assert!(!retain_commands(&config));
    }

    #[test]
    fn explicit_zigbee_profile_matches_legacy_derived_topics() {
        let legacy = normalized(json!({
            "host": "mqtt.example.org",
            "port": 1883,
            "zigbee2mqtt_base_topic": "z"
        }));
        let explicit = normalized(json!({
            "mode": "zigbee2mqtt",
            "host": "mqtt.example.org",
            "port": 1883,
            "zigbee2mqtt_base_topic": "z",
            "topic": "ignored/state",
            "topic_set": "ignored/set"
        }));
        assert_eq!(legacy.mode(), explicit.mode());
        assert_eq!(legacy.topic, explicit.topic);
        assert_eq!(legacy.topic_set, explicit.topic_set);
        assert_eq!(retain_commands(&legacy), retain_commands(&explicit));
    }

    #[test]
    fn generic_retain_default_is_backward_compatible_and_overrideable() {
        let legacy = normalized(json!({
            "host": "mqtt.example.org",
            "port": 1883,
            "topic": "home/{id}/state",
            "topic_set": "home/{id}/set"
        }));
        assert_eq!(legacy.mode(), MqttMode::Generic);
        assert!(retain_commands(&legacy));

        let non_retained = normalized(json!({
            "mode": "generic",
            "host": "mqtt.example.org",
            "port": 1883,
            "topic": "home/{id}/state",
            "topic_set": "home/{id}/set",
            "retain_commands": false
        }));
        assert!(!retain_commands(&non_retained));
    }

    #[test]
    fn esphome_profile_applies_defaults_and_derives_topics() {
        let config = normalized(json!({
            "mode": "esphome",
            "host": "mqtt.example.org",
            "port": 1883
        }));
        assert_eq!(config.mode(), MqttMode::EspHome);
        assert_eq!(config.topic, "esphome/{id}/light/light/state");
        assert_eq!(config.topic_set, "esphome/{id}/light/light/command");
        assert_eq!(
            config.esphome_discovery_prefix.as_deref(),
            Some("homeassistant")
        );
        assert_eq!(config.esphome_warm_white_kelvin, Some(2700));
        assert_eq!(config.esphome_cold_white_kelvin, Some(6500));
        assert!(!retain_commands(&config));
    }

    #[test]
    fn profile_validation_reports_bad_esphome_ranges() {
        let error = normalize_config(
            serde_json::from_value(json!({
                "mode": "esphome",
                "host": "mqtt.example.org",
                "port": 1883,
                "esphome_warm_white_kelvin": 6500,
                "esphome_cold_white_kelvin": 2700
            }))
            .unwrap(),
        )
        .unwrap_err();
        assert!(error.to_string().contains("lower than cold"));
    }

    #[test]
    fn bridge_sized_packets_decode_but_incoming_size_remains_bounded() {
        let mut options = MqttOptions::new("test", "localhost", 1883);
        let mut bytes = bytes::BytesMut::new();
        let packet = rumqttc::mqttbytes::v4::Publish::new(
            "zigbee2mqtt/bridge/devices",
            QoS::AtMostOnce,
            vec![b' '; 261080],
        );
        packet.write(&mut bytes).unwrap();
        assert!(rumqttc::mqttbytes::v4::Packet::read(
            &mut bytes.clone(),
            options.max_packet_size()
        )
        .is_err());
        configure_packet_limits(&mut options, MqttMode::Zigbee2Mqtt);
        assert!(
            rumqttc::mqttbytes::v4::Packet::read(&mut bytes, options.max_packet_size()).is_ok()
        );
        let huge = rumqttc::mqttbytes::v4::Publish::new(
            "zigbee2mqtt/bridge/devices",
            QoS::AtMostOnce,
            vec![b' '; 4 * 1024 * 1024],
        );
        huge.write(&mut bytes).unwrap();
        assert!(
            rumqttc::mqttbytes::v4::Packet::read(&mut bytes, options.max_packet_size()).is_err()
        );
    }
}
