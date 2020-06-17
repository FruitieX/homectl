extern crate config;
use super::{
    group::GroupsConfig,
    integration::{IntegrationId, IntegrationsConfig},
    rule::RoutinesConfig,
    scene::ScenesConfig,
};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: IntegrationsConfig,
    pub scenes: ScenesConfig,
    pub groups: GroupsConfig,
    pub routines: RoutinesConfig,
}

type OpaqueIntegrationsConfigs = HashMap<IntegrationId, config::Value>;

pub fn read_config() -> (Config, OpaqueIntegrationsConfigs) {
    let mut settings = config::Config::default();

    settings.merge(config::File::with_name("Settings")).unwrap();

    let config = settings.clone().try_into::<Config>().unwrap();

    let integrations_config = settings
        .get::<OpaqueIntegrationsConfigs>("integrations")
        .unwrap();

    (config, integrations_config)
}
