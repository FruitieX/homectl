extern crate config;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, convert::Infallible, str::FromStr};

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
