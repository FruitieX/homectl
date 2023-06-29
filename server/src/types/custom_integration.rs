use super::integration::{IntegrationActionPayload, IntegrationId};
use super::{device::Device, event::TxEventChannel};
use async_trait::async_trait;
use color_eyre::Result;

#[async_trait]
pub trait CustomIntegration: Send {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self>
    where
        Self: Sized;

    async fn register(&mut self) -> Result<()> {
        Ok(())
    }
    async fn start(&mut self) -> Result<()> {
        Ok(())
    }
    async fn set_integration_device_state(&mut self, _device: &Device) -> Result<()> {
        Ok(())
    }
    async fn run_integration_action(&mut self, _payload: &IntegrationActionPayload) -> Result<()> {
        Ok(())
    }
}
