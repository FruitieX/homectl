use crate::types::{
    device::{Device, DeviceData, DeviceId, SensorDevice},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time;

#[derive(Clone, Debug, Deserialize)]
pub struct TimerConfig {
    device_name: String,
}

pub struct Timer {
    id: IntegrationId,
    config: TimerConfig,
    event_tx: TxEventChannel,
    timer_task: Option<JoinHandle<()>>,
}

#[async_trait]
impl Integration for Timer {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config: TimerConfig = config
            .clone()
            .try_deserialize()
            .wrap_err("Failed to deserialize config of Timer integration")?;

        Ok(Timer {
            id: id.clone(),
            config,
            event_tx,
            timer_task: None,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let device = mk_timer_device(&self.id, &self.config, false);

        self.event_tx.send(Message::RecvDeviceState { device });

        Ok(())
    }

    async fn run_integration_action(&mut self, action: &IntegrationActionPayload) -> Result<()> {
        let device = mk_timer_device(&self.id, &self.config, true);

        self.event_tx.send(Message::RecvDeviceState { device });

        let payload = action.to_string();
        let timeout_ms: u64 = payload.parse()?;

        let sender = self.event_tx.clone();
        let id = self.id.clone();
        let config = self.config.clone();
        let timer_task = tokio::spawn(async move {
            let sleep_duration = Duration::from_millis(timeout_ms);
            time::sleep(sleep_duration).await;

            let device = mk_timer_device(&id, &config, false);
            sender.send(Message::RecvDeviceState { device });
        });

        if let Some(timer_task) = self.timer_task.take() {
            timer_task.abort();
        }

        self.timer_task = Some(timer_task);

        Ok(())
    }
}

fn mk_timer_device(id: &IntegrationId, config: &TimerConfig, value: bool) -> Device {
    let state = DeviceData::Sensor(SensorDevice::Boolean { value });

    Device {
        id: DeviceId::new("timer"),
        name: config.device_name.clone(),
        integration_id: id.clone(),
        data: state,
    }
}
