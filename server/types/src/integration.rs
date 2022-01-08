extern crate config;

use async_trait::async_trait;
// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use super::{device::Device, event::TxEventChannel};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, str::FromStr, convert::Infallible};

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
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
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    pub struct IntegrationActionPayload(String);
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IntegrationActionDescriptor {
    pub integration_id: IntegrationId,
    pub payload: IntegrationActionPayload,
}

#[async_trait]
pub trait Integration {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self>
    where
        Self: Sized;

    async fn register(&mut self) -> Result<()>;
    async fn start(&mut self) -> Result<()>;
    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()>;
    async fn run_integration_action(&mut self, payload: &IntegrationActionPayload) -> Result<()>;
}
