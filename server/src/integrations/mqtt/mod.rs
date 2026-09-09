#![allow(clippy::redundant_closure_call)]

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
use rand::{distributions::Alphanumeric, Rng};
use rumqttc::{AsyncClient, MqttOptions, QoS};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::integrations::mqtt::utils::mqtt_to_homectl;

use self::utils::homectl_to_mqtt;

fn configure_packet_limits(options: &mut MqttOptions, zigbee2mqtt: bool) {
    if zigbee2mqtt {
        // Bridge metadata is much larger than individual device reports.
        options.set_max_packet_size(4 * 1024 * 1024, 64 * 1024);
    }
}

#[derive(Default, Debug, Deserialize, Clone)]
pub struct MqttConfig {
    /// Enable the Zigbee2MQTT wire format and discovery for this base topic.
    zigbee2mqtt_base_topic: Option<String>,
    /// Poll GET-capable Zigbee2MQTT devices when attribute reporting is unavailable.
    zigbee2mqtt_poll_interval_secs: Option<u64>,
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

#[async_trait]
impl Integration for Mqtt {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let mut config: MqttConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Mqtt integration")?;
        config.zigbee2mqtt_base_topic = config
            .zigbee2mqtt_base_topic
            .take()
            .filter(|value| !value.trim().is_empty());
        if let Some(base) = config.zigbee2mqtt_base_topic.clone() {
            let base = base.trim().trim_end_matches('/');
            if base.is_empty() || base.contains(['#', '+']) {
                return Err(eyre!("Invalid Zigbee2MQTT base topic"));
            }
            config.zigbee2mqtt_base_topic = Some(base.to_owned());
            config.topic = format!("{base}/{{id}}");
            config.topic_set = format!("{base}/{{id}}/set");
        } else if config.topic.is_empty() || config.topic_set.is_empty() {
            return Err(eyre!("MQTT topic and topic_set are required"));
        }

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
        let random_string: String = rand::thread_rng()
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
        configure_packet_limits(&mut options, self.config.zigbee2mqtt_base_topic.is_some());

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
            let mut polling = polling::Polling::configured(
                config.zigbee2mqtt_base_topic.is_some(),
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
                                client
                                    .subscribe(format!("{base}/bridge/devices"), QoS::AtLeastOnce)
                                    .await?;
                            }
                            client
                                .subscribe(
                                    if let Some(base) = &config.zigbee2mqtt_base_topic {
                                        format!("{base}/#")
                                    } else {
                                        config.topic.replace("{id}", "+")
                                    },
                                    QoS::AtMostOnce,
                                )
                                .await?;
                        }

                        rumqttc::Event::Incoming(rumqttc::Packet::Publish(msg)) => {
                            let devices = if let Some(base) = &config.zigbee2mqtt_base_topic {
                                discovery.receive(base, &msg.topic, &msg.payload, &id, &config)
                            } else {
                                mqtt_to_homectl(&msg.payload, &msg.topic, id.clone(), &config)
                                    .into_iter()
                                    .collect()
                            };

                            if let (Some(base), Some(scheduler)) =
                                (&config.zigbee2mqtt_base_topic, polling.as_mut())
                            {
                                let now = Instant::now();
                                if msg.topic == format!("{base}/bridge/devices") {
                                    scheduler.sync(discovery.poll_requests(base), now);
                                } else if let Some(key) = discovery.poll_key(base, &msg.topic) {
                                    let value =
                                        serde_json::from_slice::<serde_json::Value>(&msg.payload)
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
                                                || config
                                                    .zigbee2mqtt_base_topic
                                                    .as_ref()
                                                    .is_some_and(|base| {
                                                        msg.topic
                                                            == format!("{base}/bridge/devices")
                                                    }),
                                            matches_requested: false,
                                        }));
                                }
                                let event = Event::ExternalStateUpdate { device };
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

        let mqtt_device = if self.config.zigbee2mqtt_base_topic.is_some() {
            let mut payload = zigbee2mqtt::encode(device)?;
            if payload.get("transition").is_none() {
                if let Some(transition) = self.config.default_transition {
                    payload["transition"] = serde_json::json!(transition);
                }
            }
            payload
        } else {
            homectl_to_mqtt(device.clone(), &self.config)?
        };
        let json = serde_json::to_string(&mqtt_device)?;

        if !self.cli.dry_run {
            client
                .publish(
                    topic,
                    QoS::AtLeastOnce,
                    self.config.zigbee2mqtt_base_topic.is_none(),
                    json,
                )
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
        configure_packet_limits(&mut options, true);
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
