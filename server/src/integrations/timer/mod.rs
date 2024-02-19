use crate::types::{
    device::{Device, DeviceData, DeviceId, SensorDevice},
    event::{Event, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
        let device = mk_timer_device(&self.id, &self.config, false, None, None);

        self.event_tx.send(Event::ExternalStateUpdate { device });

        Ok(())
    }

    async fn run_integration_action(&mut self, action: &IntegrationActionPayload) -> Result<()> {
        let payload = action.to_string();
        let timeout_ms: u64 = payload.parse()?;
        let started_at = SystemTime::now().duration_since(UNIX_EPOCH)?;

        let device = mk_timer_device(
            &self.id,
            &self.config,
            true,
            Some(started_at),
            Some(timeout_ms),
        );

        self.event_tx.send(Event::ExternalStateUpdate { device });

        let sender = self.event_tx.clone();
        let id = self.id.clone();
        let config = self.config.clone();
        let timer_task = tokio::spawn(async move {
            let sleep_duration = Duration::from_millis(timeout_ms);
            time::sleep(sleep_duration).await;

            let device = mk_timer_device(&id, &config, false, Some(started_at), Some(timeout_ms));
            sender.send(Event::ExternalStateUpdate { device });
        });

        if let Some(timer_task) = self.timer_task.take() {
            timer_task.abort();
        }

        self.timer_task = Some(timer_task);

        Ok(())
    }
}

fn mk_timer_device(
    id: &IntegrationId,
    config: &TimerConfig,
    value: bool,
    started_at: Option<Duration>,
    timeout_ms: Option<u64>,
) -> Device {
    let state = DeviceData::Sensor(SensorDevice::Boolean { value });

    Device {
        id: DeviceId::new("timer"),
        name: config.device_name.clone(),
        integration_id: id.clone(),
        data: state,
        raw: Some(
            json!({ "timeout_ms": timeout_ms, "started_at": started_at.map(|t| t.as_millis()) }),
        ),
    }
}
