use crate::types::{
    action::Action,
    color::Capabilities,
    device::{ControllableDevice, Device, DeviceData, DeviceId, ManageKind},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use async_trait::async_trait;
use chrono::Local;
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc};
use tokio::{
    sync::RwLock,
    time::{sleep_until, Instant},
};

#[derive(Debug, Deserialize)]
pub struct CronScheduleConfig {
    name: String,
    schedule: String,
    action: Action,
    init_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CronConfig {
    schedules: HashMap<DeviceId, CronScheduleConfig>,
}

pub struct Cron {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: CronConfig,
    devices: Arc<RwLock<HashMap<DeviceId, Device>>>,
}

#[async_trait]
impl Integration for Cron {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_deserialize()
            .wrap_err("Failed to deserialize config of Cron integration")?;

        Ok(Cron {
            id: id.clone(),
            config,
            event_tx,
            devices: Default::default(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        for (id, device) in &self.config.schedules {
            let state = DeviceData::Controllable(ControllableDevice::new(
                None,
                device.init_enabled.unwrap_or(true),
                None,
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            ));

            let device = Device::new(
                self.id.clone(),
                id.clone(),
                device.name.clone(),
                state,
                None,
            );
            {
                let mut devices = self.devices.write().await;
                devices.insert(id.clone(), device.clone());
            }
            self.event_tx.send(Message::ExternalStateUpdate { device });
        }

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        for (id, config) in &self.config.schedules {
            let devices = self.devices.clone();
            let event_tx = self.event_tx.clone();
            let action = config.action.clone();
            let id = id.clone();

            let cron = croner::Cron::new(&config.schedule).parse()?;

            tokio::spawn(async move {
                loop {
                    let next = cron.find_next_occurrence(&Local::now(), false).unwrap();

                    let duration = next - Local::now();
                    trace!("Sleeping for {duration:?}");
                    sleep_until(Instant::now() + duration.to_std().unwrap()).await;

                    debug!("Running cron job for device {id}");

                    let devices = devices.read().await;
                    let device = devices.get(&id).unwrap();
                    if device.is_powered_on() == Some(true) {
                        event_tx.send(Message::Action(action.clone()));
                    }
                }
            });
        }

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        {
            let mut devices = self.devices.write().await;
            devices.insert(device.id.clone(), device.clone());
        }

        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}
