use crate::{
    types::{
        action::Action,
        color::Capabilities,
        device::{ControllableDevice, Device, DeviceData, DeviceId, ManageKind},
        event::{Event, TxEventChannel},
        integration::{Integration, IntegrationActionPayload, IntegrationId},
    },
    utils::cli::Cli,
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
    tasks: tokio::task::JoinSet<()>,
}

#[async_trait]
impl Integration for Cron {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        _cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config: CronConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Cron integration")?;

        for schedule in config.schedules.values() {
            schedule.schedule.parse::<croner::Cron>()?;
        }

        Ok(Cron {
            id: id.clone(),
            config,
            event_tx,
            devices: Default::default(),
            tasks: tokio::task::JoinSet::new(),
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
            self.event_tx.send(Event::ExternalStateUpdate {
                device,
                integration_epoch: None,
            });
        }

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        self.stop().await?;
        for (id, config) in &self.config.schedules {
            let devices = self.devices.clone();
            let event_tx = self.event_tx.clone();
            let action = config.action.clone();
            let id = id.clone();

            let cron = config.schedule.parse::<croner::Cron>()?;

            self.tasks.spawn(async move {
                loop {
                    let next = match cron.find_next_occurrence(&Local::now(), false) {
                        Ok(next) => next,
                        Err(error) => {
                            warn!(
                                "Cron schedule for device {id} failed to calculate next occurrence: {error}; stopping task"
                            );
                            break;
                        }
                    };

                    let duration = next - Local::now();
                    trace!("Sleeping for {duration:?}");
                    let Ok(duration) = duration.to_std() else {
                        warn!(
                            "Cron schedule for device {id} produced a negative duration; retrying"
                        );
                        continue;
                    };
                    sleep_until(Instant::now() + duration).await;

                    debug!("Running cron job for device {id}");

                    let devices = devices.read().await;
                    let Some(device) = devices.get(&id) else {
                        warn!("Cron device {id} is not registered; skipping action");
                        continue;
                    };
                    if device.is_powered_on() == Some(true) {
                        event_tx.send(Event::Action(action.clone()));
                    }
                }
            });
        }

        Ok(())
    }

    async fn stop(&mut self) -> Result<()> {
        self.tasks.shutdown().await;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::event::mk_event_channel;
    use chrono::{Local, TimeZone};

    fn test_cli() -> Cli {
        Cli {
            dry_run: true,
            port: 45289,
            database_url: None,
            config: None,
            warmup_time: None,
            command: None,
        }
    }

    /// B06: pin the supported cron grammar and its next-occurrence behavior
    /// against the pinned croner parser. This is the compatibility baseline for
    /// the v2 schedule trigger.
    #[test]
    fn b06_cron_parser_next_occurrence_is_pinned() {
        let cron = "0 0 * * *".parse::<croner::Cron>().unwrap();
        let from = Local.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        let next = cron.find_next_occurrence(&from, false).unwrap();
        assert_eq!(next, Local.with_ymd_and_hms(2024, 1, 2, 0, 0, 0).unwrap());

        // Day-of-month and day-of-week both set. The pinned croner parser
        // implements OR semantics (next is the Monday, not the 1st), matching
        // Vixie cron. This is the grammar the v2 schedule compiler must expose.
        let dom_dow = "0 0 1 * 1".parse::<croner::Cron>().unwrap();
        let next = dom_dow.find_next_occurrence(&from, false).unwrap();
        assert_eq!(
            next,
            Local.with_ymd_and_hms(2024, 1, 8, 0, 0, 0).unwrap(),
            "croner uses OR semantics for restricted day-of-month and day-of-week"
        );
    }

    /// B06: the cron compatibility device's power gates the dispatch, and the
    /// initial enabled flag comes from `init_enabled` (defaulting to true).
    #[tokio::test]
    async fn b06_cron_register_respects_init_enabled() {
        let (tx, mut rx) = mk_event_channel();
        let config = serde_json::json!({
            "schedules": {
                "on": {
                    "name": "On",
                    "schedule": "0 0 * * *",
                    "init_enabled": true,
                    "action": { "action": "Dim", "device_keys": null, "group_keys": null, "step": -0.1 }
                },
                "off": {
                    "name": "Off",
                    "schedule": "0 0 * * *",
                    "init_enabled": false,
                    "action": { "action": "Dim", "device_keys": null, "group_keys": null, "step": -0.1 }
                },
                "defaulted": {
                    "name": "Defaulted",
                    "schedule": "0 0 * * *",
                    "action": { "action": "Dim", "device_keys": null, "group_keys": null, "step": -0.1 }
                }
            }
        });

        let mut cron = Cron::new(
            &IntegrationId::from("cron".to_string()),
            &config,
            &test_cli(),
            tx,
        )
        .unwrap();
        cron.register().await.unwrap();

        let mut powers = std::collections::HashMap::new();
        while let Ok(event) = rx.try_recv() {
            if let Event::ExternalStateUpdate { device, .. } = event {
                powers.insert(device.name.clone(), device.is_powered_on());
            }
        }

        assert_eq!(powers.get("On"), Some(&Some(true)));
        assert_eq!(powers.get("Off"), Some(&Some(false)));
        assert_eq!(
            powers.get("Defaulted"),
            Some(&Some(true)),
            "init_enabled defaults to true"
        );
    }
}
