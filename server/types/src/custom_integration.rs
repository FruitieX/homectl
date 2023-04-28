use super::{device::Device, event::TxEventChannel};
use crate::integration::{IntegrationActionPayload, IntegrationId};
use anyhow::Result;
use async_trait::async_trait;

#[async_trait]
pub trait CustomIntegration: Send {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self>
    where
        Self: Sized;

    async fn register(&mut self) -> Result<()>;
    async fn start(&mut self) -> Result<()>;
    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()>;
    async fn run_integration_action(&mut self, _payload: &IntegrationActionPayload) -> Result<()> {
        Ok(())
    }
}
