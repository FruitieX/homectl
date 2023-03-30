extern crate config;

use anyhow::Result;
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
pub struct IntegrationActionDescriptor {
    pub integration_id: IntegrationId,
    pub payload: IntegrationActionPayload,
}
