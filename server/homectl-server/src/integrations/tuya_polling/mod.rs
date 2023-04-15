use std::collections::HashMap;

use anyhow::{Context, Result};
use async_trait::async_trait;
use homectl_types::{
    device::{Device, DeviceId},
    event::TxEventChannel,
    integration::IntegrationId,
    polling_integration::PollingIntegration,
};

use super::tuya::TuyaConfig;

pub struct TuyaPolling {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: TuyaConfig,
}

#[async_trait]
impl PollingIntegration for TuyaPolling {
    fn new(
        id: &IntegrationId,
        config: &config::Value,
        event_tx: TxEventChannel,
    ) -> Result<TuyaPolling> {
        let config: TuyaConfig = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Tuya integration")?;

        Ok(TuyaPolling {
            id: id.clone(),
            config,
            event_tx,
        })
    }

    async fn get_integration_devices_state(&self) -> Result<HashMap<DeviceId, Device>> {
	self.config.devices.iter().map(|(device_id, device)| {

	});
	todo!();
    }

    async fn set_integration_devices_state(
        &mut self,
        device: &HashMap<DeviceId, Device>,
    ) -> Result<()> {
        Ok(())
    }
}
