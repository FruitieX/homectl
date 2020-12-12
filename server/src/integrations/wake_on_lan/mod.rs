use crate::homectl_core::{device::{Device, DeviceState, OnOffDevice}, events::TxEventChannel, integration::{Integration, IntegrationId}};
use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;

pub struct WakeOnLan {
  id: IntegrationId
}

#[async_trait]
impl Integration for WakeOnLan {
    fn new(id: &IntegrationId, config: &config::Value, _: TxEventChannel) -> Result<WakeOnLan> {
        Ok(WakeOnLan { id: id.clone() })
    }

    async fn register(&mut self) -> anyhow::Result<()> {
        todo!()
    }

    async fn start(&mut self) -> anyhow::Result<()> {
        todo!()
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        let power = match device.state {
            DeviceState::OnOffDevice(OnOffDevice { power }) => {Ok(power)}
            _ => { Err(anyhow!(""))}
        }?;

        Ok(())
    }
}

// https://github.com/LesnyRumcajs/wakey