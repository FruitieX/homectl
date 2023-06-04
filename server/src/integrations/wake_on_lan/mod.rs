use std::{net::SocketAddr, time::Duration};

use crate::types::{
    color::SupportedColorModes,
    custom_integration::CustomIntegration,
    device::{Device, DeviceData, DeviceId, ManagedDevice},
    event::{Message, TxEventChannel},
    integration::IntegrationId,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use tokio::time;

#[derive(Clone, Debug, Deserialize)]
struct WakeOnLanMachine {
    id: String,
    mac: String,
    broadcast_ip: Option<SocketAddr>,
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
impl CustomIntegration for WakeOnLan {
    fn new(
        id: &IntegrationId,
        config: &config::Value,
        sender: TxEventChannel,
    ) -> Result<WakeOnLan> {
        let config = config
            .clone()
            .try_deserialize()
            .context("Failed to deserialize config of WakeOnLan integration")?;
        Ok(WakeOnLan {
            id: id.clone(),
            config,
            sender,
        })
    }

    async fn register(&mut self) -> anyhow::Result<()> {
        for machine in &self.config.machines {
            let data = DeviceData::Managed(ManagedDevice::new(
                None,
                true,
                None,
                None,
                None,
                SupportedColorModes::default(),
            ));

            let device = Device {
                id: DeviceId::new(&machine.id),
                name: machine.id.clone(),
                integration_id: self.id.clone(),
                data,
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
        let power = match &device.data {
            DeviceData::Managed(ManagedDevice { state, .. }) => Ok(state.power),
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
            match wol_machine.broadcast_ip {
                Some(broadcast_ip) => {
                    let src = SocketAddr::from(([0, 0, 0, 0], 0));
                    wakey::WolPacket::from_string(&wol_machine.mac, ':')?
                        .send_magic_to(&src, &broadcast_ip)?;
                }
                None => {
                    wakey::WolPacket::from_string(&wol_machine.mac, ':')?.send_magic()?;
                }
            }
        } else if let Some(sleep_on_lan) = &wol_machine.sleep_on_lan {
            let endpoint = sleep_on_lan.clone();

            tokio::spawn(async move {
                // This timing out is normal... Responding host gets shut down after all

                time::timeout(Duration::from_secs(1), do_sleep_on_lan(endpoint))
                    .await
                    .ok();
            });
        }

        Ok(())
    }
}

async fn do_sleep_on_lan(endpoint: String) -> Result<()> {
    surf::get(&endpoint).await.map_err(|err| anyhow!(err))?;

    Ok(())
}
