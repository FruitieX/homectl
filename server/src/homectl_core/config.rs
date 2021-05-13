extern crate config;
use homectl_types::{
    group::GroupsConfig,
    integration::{IntegrationId, IntegrationsConfig},
    rule::RoutinesConfig,
    scene::ScenesConfig,
};
use anyhow::{Context, Result};
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

pub fn read_config() -> Result<(Config, OpaqueIntegrationsConfigs)> {
    let mut settings = config::Config::default();

    settings
        .merge(config::File::with_name("Settings"))
        .context("Failed to load Settings.toml config file")?;

    let config = settings.clone().try_into::<Config>().context(
        "Failed to deserialize config, compare your config file to Settings.toml.example!",
    )?;

    let integrations_config = settings
        .get::<OpaqueIntegrationsConfigs>("integrations")
        .context("Expected to find integrations key in config")?;

    Ok((config, integrations_config))
}
