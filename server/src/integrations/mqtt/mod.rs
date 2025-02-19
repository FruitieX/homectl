#![allow(clippy::redundant_closure_call)]

mod utils;

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
use eyre::Context;
use rand::{distributions::Alphanumeric, Rng};
use rumqttc::{AsyncClient, MqttOptions, QoS};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::task;

use crate::integrations::mqtt::utils::mqtt_to_homectl;

use self::utils::homectl_to_mqtt;

#[derive(Default, Debug, Deserialize, Clone)]
pub struct MqttConfig {
    host: String,
    port: u16,
    topic: String,
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
        config: &config::Value,
        cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config = config
            .clone()
            .try_deserialize()
            .wrap_err("Failed to deserialize config of Mqtt integration")?;

        Ok(Mqtt {
            id: id.clone(),
            config,
            cli: cli.clone(),
            event_tx,
            client: None,
        })
    }

    async fn start(&mut self) -> Result<()> {
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
        let (client, mut eventloop) = AsyncClient::new(options, 10);

        self.client = Some(client.clone());

        let id = self.id.clone();
        let event_tx = self.event_tx.clone();
        let config = Arc::new(self.config.clone());

        task::spawn(async move {
            loop {
                let notification = eventloop.poll().await;

                let id = id.clone();
                let event_tx = event_tx.clone();
                let config = Arc::clone(&config);

                let res = (|| async {
                    match notification? {
                        rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_)) => {
                            client
                                .subscribe(config.topic.replace("{id}", "+"), QoS::AtMostOnce)
                                .await?;
                        }

                        rumqttc::Event::Incoming(rumqttc::Packet::Publish(msg)) => {
                            let device =
                                mqtt_to_homectl(&msg.payload, &msg.topic, id.clone(), &config);

                            if let Some(device) = device {
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

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .expect("Expected self.client to be set in start phase");

        let topic = self
            .config
            .topic_set
            .replace("{id}", &device.id.to_string())
            .replace("{name}", &device.name.to_string());

        let mqtt_device = homectl_to_mqtt(device.clone(), &self.config)?;
        let json = serde_json::to_string(&mqtt_device)?;

        if !self.cli.dry_run {
            client.publish(topic, QoS::AtLeastOnce, true, json).await?;
        } else {
            debug!("(dry run) would publish device state: {device}");
        }

        Ok(())
    }

    /// Can be used for pushing arbitrary values to the MQTT broker
    async fn run_integration_action(&mut self, payload: &IntegrationActionPayload) -> Result<()> {
        let action: CustomMqttAction = serde_json::from_str(&payload.to_string())?;

        let client = self
            .client
            .as_ref()
            .expect("Expected self.client to be set in start phase");

        client
            .publish(action.topic, QoS::AtLeastOnce, true, action.json)
            .await?;

        Ok(())
    }
}
