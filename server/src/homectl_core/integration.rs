use async_trait::async_trait;
// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use super::{device::Device, events::TxEventChannel};
use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;

pub type IntegrationId = String;

#[derive(Deserialize, Debug)]
pub struct IntegrationConfig {
    pub plugin: String,
    // NOTE: integration configs may contain other fields as well.

    // but since we don't know what fields those might be, they have to be
    // deserialized by the integration itself
}

pub type IntegrationsConfig = HashMap<IntegrationId, IntegrationConfig>;

#[async_trait]
pub trait Integration {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self>
    where
        Self: Sized;

    async fn register(&mut self) -> Result<()>;
    async fn start(&mut self) -> Result<()>;
    async fn set_integration_device_state(&mut self, device: Device);
}
