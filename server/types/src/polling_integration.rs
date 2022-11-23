use std::collections::HashMap;

use super::{device::Device, event::TxEventChannel};
use crate::{device::DeviceId, integration::IntegrationId};
use anyhow::Result;
use async_trait::async_trait;

#[async_trait]
pub trait PollingIntegration: Send + Sync {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self>
    where
        Self: Sized;

    async fn get_integration_devices_state(&self) -> Result<HashMap<DeviceId, Device>>;
    async fn set_integration_devices_state(
        &mut self,
        device: &HashMap<DeviceId, Device>,
    ) -> Result<()>;
}
