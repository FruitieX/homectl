use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use async_std::{future, task};
use async_trait::async_trait;
use homectl_types::{
    device::{Device, DeviceId, DeviceState, Light, OnOffDevice},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
struct WakeOnLanMachine {
    id: String,
    mac: String,
    sleep_on_lan: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct WakeOnLanConfig {
    machines: Vec<WakeOnLanMachine>,
}

pub struct WakeOnLan {
    id: IntegrationId,
    config: WakeOnLanConfig,
    sender: TxEventChannel,
}

#[async_trait]
impl Integration for WakeOnLan {
    fn new(
        id: &IntegrationId,
        config: &config::Value,
        sender: TxEventChannel,
    ) -> Result<WakeOnLan> {
        let config = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of WakeOnLan integration")?;
        Ok(WakeOnLan {
            id: id.clone(),
            config,
            sender,
        })
    }

    async fn register(&mut self) -> anyhow::Result<()> {
        for machine in &self.config.machines {
            let state = DeviceState::OnOffDevice(OnOffDevice { power: true });

            let device = Device {
                id: DeviceId::new(&machine.id),
                name: machine.id.clone(),
                integration_id: self.id.clone(),
                scene: None,
                state,
            };

            self.sender
                .send(Message::IntegrationDeviceRefresh { device });
        }

        Ok(())
    }

    async fn start(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        let power = match device.state {
            DeviceState::OnOffDevice(OnOffDevice { power }) => Ok(power),
            DeviceState::Light(Light { power, .. }) => Ok(power),
            _ => Err(anyhow!(
                "Unsupported device kind received in wol integration"
            )),
        }?;

        let wol_machine = self
            .config
            .machines
            .iter()
            .find(|machine| machine.id == device.id.to_string())
            .context(format!(
                "Expected to find WOL device with matching id {}",
                device.id
            ))?;

        if power {
            wakey::WolPacket::from_string(&wol_machine.mac, ':').send_magic()?;
        } else if let Some(sleep_on_lan) = &wol_machine.sleep_on_lan {
            let endpoint = sleep_on_lan.clone();

            task::spawn(async move {
                // This timing out is normal... Responding host gets shut down after all
                future::timeout(Duration::from_secs(1), do_sleep_on_lan(endpoint))
                    .await
                    .ok();
            });
        }

        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}

async fn do_sleep_on_lan(endpoint: String) -> Result<()> {
    let mut res = surf::get(&endpoint).await.map_err(|err| anyhow!(err))?;
    println!(
        "res: {}",
        res.body_string().await.map_err(|err| anyhow!(err))?
    );

    Ok(())
}
