use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;

use homectl_types::{
    custom_integration::CustomIntegration,
    device::{Device, DeviceId, DeviceState, OnOffDevice},
    event::{Message, TxEventChannel},
    integration::{IntegrationActionPayload, IntegrationId},
};
use serde::Deserialize;
use tokio::time;

#[derive(Debug, Deserialize, Clone)]
pub struct PingConfig {
    machines: Vec<PingMachine>,
}

#[derive(Debug, Deserialize, Clone)]
struct PingMachine {
    id: String,
    ip: String,
}

pub struct Ping {
    id: IntegrationId,
    config: PingConfig,
    sender: TxEventChannel,
}

#[async_trait]
impl CustomIntegration for Ping {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Result<Ping> {
        let config = config
            .clone()
            .try_deserialize()
            .context("Failed to deserialize config of Ping integration")?;
        Ok(Ping {
            id: id.clone(),
            config,
            sender,
        })
    }

    async fn register(&mut self) -> Result<()> {
        let config = self.config.clone();
        let id = self.id.clone();
        let sender = self.sender.clone();
        for machine in &self.config.machines {
            let state = DeviceState::OnOffDevice(OnOffDevice { power: false });
            let device = Device {
                id: DeviceId::new(&machine.id),
                name: machine.id.clone(),
                integration_id: self.id.clone(),
                state,
                scene: None,
            };
            self.sender
                .send(Message::IntegrationDeviceRefresh { device });
        }

        tokio::spawn(async move {
            loop {
                let poll_rate = Duration::from_millis(10000);
                let mut interval = time::interval(poll_rate);

                for device in &config.machines {
                    interval.tick().await;
                    let status = Command::new("sh")
                        .arg("-c")
                        .arg("ping")
                        .arg(&device.ip)
                        .arg("-w 5")
                        .status();

                    update_state(device, &id, status.is_ok(), &sender)
                }
            }
        });
        Ok(())
    }
    async fn start(&mut self) -> Result<()> {
        Ok(())
    }

    async fn set_integration_device_state(&mut self, _device: &Device) -> Result<()> {
        // self.devices.insert(device.id.clone(), device.clone());
        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}
fn update_state(machine: &PingMachine, id: &IntegrationId, state_b: bool, sender: &TxEventChannel) {
    let state = DeviceState::OnOffDevice(OnOffDevice { power: state_b });
    let device = Device {
        id: DeviceId::new(&machine.id.to_string()),
        name: machine.id.to_string(),
        integration_id: id.clone(),
        state,
        scene: None,
    };
    sender.send(Message::IntegrationDeviceRefresh { device });
}
