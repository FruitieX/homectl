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

    let cwd = std::env::current_dir();
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR");

    let root = match manifest_dir {
        Ok(path) => vec![path].iter().collect(),
        Err(_) => cwd.unwrap(),
    };

    let sample_path = root.join("Settings.toml.example");

    let path = root.join("Settings.toml");

    if !path.exists() && std::env::var("SKIP_SAMPLE_CONFIG").is_err() {
        println!("Settings.toml not found, generating sample configuration.");
        println!("Set SKIP_SAMPLE_CONFIG environment variable to opt out of this behavior.");
        std::fs::copy(sample_path, path).unwrap();
    }

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
