extern crate config;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Debug)]
pub struct IntegrationConfig {
    pub plugin: String,
    // NOTE: integration configs may contain other fields as well.

    // but since we don't know what fields those might be, they have to be
    // deserialized by the integration itself
}

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: HashMap<String, IntegrationConfig>,
}

type OpaqueIntegrationsConfigs = HashMap<String, config::Value>;

pub fn read_config() -> (Config, OpaqueIntegrationsConfigs) {
    let mut settings = config::Config::default();

    settings.merge(config::File::with_name("Settings")).unwrap();

    let config = settings.clone().try_into::<Config>().unwrap();

    let integrations_config = settings
        .get::<OpaqueIntegrationsConfigs>("integrations")
        .unwrap();

    (config, integrations_config)
}
