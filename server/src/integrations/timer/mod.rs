use crate::{
    types::{
        device::{Device, DeviceData, DeviceId, SensorDevice},
        event::{Event, TxEventChannel},
        integration::{Integration, IntegrationActionPayload, IntegrationId},
    },
    utils::cli::Cli,
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::task::JoinSet;
use tokio::time;

#[derive(Clone, Debug, Deserialize)]
pub struct TimerConfig {
    device_name: String,
}

pub struct Timer {
    id: IntegrationId,
    config: TimerConfig,
    event_tx: TxEventChannel,
    tasks: JoinSet<()>,
}

#[async_trait]
impl Integration for Timer {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        _cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config: TimerConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Timer integration")?;

        Ok(Timer {
            id: id.clone(),
            config,
            event_tx,
            tasks: JoinSet::new(),
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

        self.stop().await?;
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
        self.tasks.spawn(async move {
            let sleep_duration = Duration::from_millis(timeout_ms);
            time::sleep(sleep_duration).await;

            let device = mk_timer_device(&id, &config, false, Some(started_at), Some(timeout_ms));
            sender.send(Event::ExternalStateUpdate { device });
        });

        Ok(())
    }
    async fn stop(&mut self) -> Result<()> {
        self.tasks.shutdown().await;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stop_cancels_timer_expiration() {
        let (state, mut rx) = crate::core::event::tests::test_state();
        let mut timer = Timer {
            id: IntegrationId::from("timer".to_string()),
            config: TimerConfig {
                device_name: "Timer".into(),
            },
            event_tx: state.event_tx.clone(),
            tasks: JoinSet::new(),
        };
        timer
            .run_integration_action(&IntegrationActionPayload::from("20".to_string()))
            .await
            .unwrap();
        assert!(matches!(
            rx.recv().await.unwrap(),
            Event::ExternalStateUpdate { .. }
        ));
        timer.stop().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(60), rx.recv())
                .await
                .is_err(),
            "stopped timer emitted an expiration"
        );
    }

    #[tokio::test]
    async fn dropping_timer_cancels_expiration() {
        let (state, mut rx) = crate::core::event::tests::test_state();
        let mut timer = Timer {
            id: IntegrationId::from("timer".to_string()),
            config: TimerConfig {
                device_name: "Timer".into(),
            },
            event_tx: state.event_tx.clone(),
            tasks: JoinSet::new(),
        };
        timer
            .run_integration_action(&IntegrationActionPayload::from("20".to_string()))
            .await
            .unwrap();
        rx.recv().await.unwrap();
        drop(timer);
        assert!(tokio::time::timeout(Duration::from_millis(60), rx.recv())
            .await
            .is_err());
    }
}
