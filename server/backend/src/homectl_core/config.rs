extern crate config;
use anyhow::{Context, Result};
use homectl_types::{
    group::GroupsConfig,
    integration::{IntegrationId, IntegrationsConfig},
    rule::RoutinesConfig,
    scene::ScenesConfig,
};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: Option<IntegrationsConfig>,
    pub scenes: Option<ScenesConfig>,
    pub groups: Option<GroupsConfig>,
    pub routines: Option<RoutinesConfig>,
}

type OpaqueIntegrationsConfigs = HashMap<IntegrationId, config::Value>;

pub fn read_config() -> Result<(Config, OpaqueIntegrationsConfigs)> {
    let mut settings = config::Config::default();

    settings
        .merge(config::File::with_name("Settings"))
        .context("Failed to load Settings.toml config file")?;

    let config: Config = serde_path_to_error::deserialize(settings.clone()).context(
        "Failed to deserialize config, compare your config file to Settings.toml.example!",
    )?;

    let integrations_config = settings
        .get::<OpaqueIntegrationsConfigs>("integrations")
        .context("Expected to find integrations key in config")?;

    Ok((config, integrations_config))
}
