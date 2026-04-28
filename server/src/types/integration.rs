use crate::utils::cli::Cli;

use super::{device::Device, event::TxEventChannel};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, convert::Infallible, str::FromStr, time::Duration};
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd, Hash, NewtypeDisplay!, NewtypeFrom!)]
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

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct IntegrationConfigSchema {
    pub plugin: String,
    pub name: String,
    pub description: String,
    pub fields: Vec<IntegrationConfigFieldSchema>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct IntegrationConfigFieldSchema {
    /// Dot-separated config path, for example
    /// `outbound_device_updates.min_interval_ms`.
    pub key: String,
    pub label: String,
    pub kind: IntegrationConfigFieldKind,
    pub required: bool,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<IntegrationConfigFieldOption>,
    pub default_value: Option<serde_json::Value>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub help_text: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationConfigFieldKind {
    Text,
    Password,
    Number,
    Boolean,
    Select,
    Color,
    Json,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct IntegrationConfigFieldOption {
    pub label: String,
    pub value: serde_json::Value,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
pub struct OutboundDeviceUpdatePolicy {
    /// Minimum spacing between two outbound device state updates for one
    /// integration actor. A value of 0 keeps the legacy immediate behavior.
    #[serde(default)]
    pub min_interval_ms: u64,
}

impl OutboundDeviceUpdatePolicy {
    const CONFIG_KEY: &'static str = "outbound_device_updates";

    pub fn from_config(config: &serde_json::Value) -> Result<Self> {
        let Some(value) = config
            .get(Self::CONFIG_KEY)
            .filter(|value| !value.is_null())
        else {
            return Ok(Self::default());
        };

        serde_json::from_value(value.clone()).wrap_err_with(|| {
            format!(
                "Failed to deserialize {} integration config",
                Self::CONFIG_KEY
            )
        })
    }

    pub fn min_interval(&self) -> Option<Duration> {
        if self.min_interval_ms == 0 {
            None
        } else {
            Some(Duration::from_millis(self.min_interval_ms))
        }
    }
}

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
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
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self>
    where
        Self: Sized;

    async fn register(&mut self) -> Result<()> {
        Ok(())
    }
    async fn start(&mut self) -> Result<()> {
        Ok(())
    }
    async fn stop(&mut self) -> Result<()> {
        Ok(())
    }
    async fn set_integration_device_state(&mut self, _device: &Device) -> Result<()> {
        Ok(())
    }
    async fn run_integration_action(&mut self, _payload: &IntegrationActionPayload) -> Result<()> {
        Ok(())
    }
}
