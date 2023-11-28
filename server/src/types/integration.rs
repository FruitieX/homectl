use super::{device::Device, event::TxEventChannel};
use async_trait::async_trait;
use color_eyre::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, convert::Infallible, str::FromStr};
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
    #[ts(export)]
    pub struct IntegrationId(String);
}

impl FromStr for IntegrationId {
    type Err = Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(IntegrationId(s.to_string()))
    }
}

#[derive(Deserialize, Debug)]
pub struct IntegrationConfig {
    pub plugin: String,
    // NOTE: integration configs may contain other fields as well.

    // but since we don't know what fields those might be, they have to be
    // deserialized by the integration itself
}

pub type IntegrationsConfig = HashMap<IntegrationId, IntegrationConfig>;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    #[ts(export)]
    pub struct IntegrationActionPayload(String);
}

#[derive(TS, Clone, Debug, Deserialize, Serialize)]
#[ts(export)]
pub struct CustomActionDescriptor {
    pub integration_id: IntegrationId,
    pub payload: IntegrationActionPayload,
}

#[async_trait]
pub trait Integration: Send {
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
