pub mod utils;

use anyhow::{Context, Result};
use async_trait::async_trait;
use homectl_types::{
    custom_integration::CustomIntegration,
    device::{Device, DeviceId, DeviceState, Light},
    event::{Message, TxEventChannel},
    integration::{IntegrationActionPayload, IntegrationId},
};
use rust_async_tuyapi::tuyadevice::TuyaDevice;
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio::time;

use crate::integrations::tuya::utils::terminate_tuya_connection;

use self::utils::{get_tuya_state, set_tuya_state};

#[derive(Clone, Debug, Deserialize)]
pub struct TuyaDeviceConfig {
    pub name: String,
    pub local_key: String,
    pub ip: String,
    pub version: Option<String>,
    pub brightness_field: Option<String>,
    pub color_field: Option<String>,
    pub color_temp_field: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TuyaConfig {
    pub devices: HashMap<DeviceId, TuyaDeviceConfig>,
}

pub type Connection = Arc<RwLock<Option<TuyaDevice>>>;

pub struct Tuya {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: TuyaConfig,
    connections: HashMap<DeviceId, Connection>,
    device_expected_states: HashMap<DeviceId, Arc<RwLock<Device>>>,
    device_poll_handles: HashMap<DeviceId, JoinHandle<()>>,
}

fn default_device(device_id: DeviceId, name: String, integration_id: IntegrationId) -> Device {
    Device {
        id: device_id,
        name,
        integration_id,
        scene: None,
        state: DeviceState::Light(Light {
            power: false,
            brightness: None,
            color: None,
            transition_ms: None,
        }),
    }
}

#[async_trait]
impl CustomIntegration for Tuya {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config: TuyaConfig = config
            .clone()
            .try_deserialize()
            .context("Failed to deserialize config of Tuya integration")?;

        let mut connections = HashMap::new();
        config.devices.iter().for_each(|(device_id, _)| {
            connections.insert(device_id.clone(), Default::default());
        });

        Ok(Tuya {
            id: id.clone(),
            config,
            event_tx,
            connections,
            device_expected_states: HashMap::new(),
            device_poll_handles: HashMap::new(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        let mut device_expected_states = HashMap::new();

        let integration_id = self.id.clone();

        for (device_id, device_config) in &self.config.devices {
            let device_id = device_id.clone();
            let device_config = device_config.clone();
            let event_tx = self.event_tx.clone();
            let integration_id = integration_id.clone();

            // println!("Getting initial state of {}", device_config.name);
            // let device = get_tuya_state(&device_id, &integration_id, &device_config).await;
            // let device = device.unwrap_or_else(|_| {
            //     println!("Failed to get initial state of Tuya device {}, creating Device with default state", device_config.name);

            //     default_device(device_id.clone(), device_config.name.clone(), integration_id)
            // });

            let device = default_device(
                device_id.clone(),
                device_config.name.clone(),
                integration_id,
            );

            device_expected_states.insert(device_id.clone(), Arc::new(RwLock::new(device.clone())));

            event_tx.send(Message::IntegrationDeviceRefresh { device });
        }

        self.device_expected_states = device_expected_states;

        println!("registered tuya integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("starting tuya integration {}", self.id);

        let device_expected_states = self.device_expected_states.clone();

        for (device_id, device_config) in &self.config.devices {
            let device_config = device_config.clone();
            let device_expected_state = device_expected_states.get(device_id).unwrap().clone();
            let sender = self.event_tx.clone();

            let connections = self.connections.clone();
            let handle = tokio::spawn(async move {
                poll_light(&device_config, sender, device_expected_state, connections).await
            });

            self.device_poll_handles.insert(device_id.clone(), handle);
        }

        println!("started tuya integration {}", self.id);

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        {
            let device_expected_state = self.device_expected_states.get(&device.id).unwrap();
            let mut device_expected_state = device_expected_state.write().await;
            *device_expected_state = device.clone();
        }

        let mut device_poll_handle = self.device_poll_handles.remove(&device.id);
        if let Some(poll_handle) = device_poll_handle.take() {
            poll_handle.abort();
        }

        let config = self.config.clone();
        let sender = self.event_tx.clone();

        let device_config = config
            .devices
            .get(&device.id)
            .context(format!(
                "Could not find TuyaDeviceConfig for device with id {}",
                device.id,
            ))?
            .clone();
        let device_expected_state = self.device_expected_states.get(&device.id).unwrap().clone();

        let handle = {
            let device_config = device_config.clone();
            let connections = self.connections.clone();
            tokio::spawn(async move {
                poll_light(&device_config, sender, device_expected_state, connections).await
            })
        };

        self.device_poll_handles.insert(device.id.clone(), handle);

        {
            let device = device.clone();
            let connections = self.connections.clone();
            tokio::spawn(async move {
                let result = set_tuya_state(&device, &device_config, &connections).await;
                if let Err(e) = result {
                    eprintln!("Error while calling set_tuya_state: {}", e);
                    terminate_tuya_connection(&device.id, &connections)
                        .await
                        .ok();
                }
            });
        }

        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        Ok(())
    }
}

pub async fn poll_light(
    device_config: &TuyaDeviceConfig,
    sender: TxEventChannel,
    device_expected_state: Arc<RwLock<Device>>,
    connections: HashMap<DeviceId, Connection>,
) {
    let poll_rate = Duration::from_millis(2000);
    let mut interval = time::interval(poll_rate);

    loop {
        interval.tick().await;

        let device_expected_state = { device_expected_state.read().await.clone() };

        // We still need to send our version of the device state to homectl core, in
        // case it has gone stale.
        // sender.send(Message::IntegrationDeviceRefresh {
        //     device: device_expected_state,
        // });
        // continue;

        let result = get_tuya_state(
            &device_expected_state.id,
            &device_expected_state.integration_id,
            device_config,
            &connections,
        )
        .await;
        // let result = set_tuya_state(&device_expected_state, device_config).await;

        match result {
            Ok(device) => {
                sender.send(Message::IntegrationDeviceRefresh { device });
            }
            Err(e) => {
                eprintln!(
                    "Error while polling Tuya state for device {}: {:?}",
                    device_expected_state.name, e
                );
                terminate_tuya_connection(&device_expected_state.id, &connections)
                    .await
                    .ok();
            }
        }
    }
}
