use crate::types::{
    group::GroupsConfig,
    integration::{IntegrationId, IntegrationsConfig},
    rule::RoutinesConfig,
    scene::ScenesConfig,
};
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use std::{collections::HashMap, fs::File, io::Read};

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: Option<IntegrationsConfig>,
    pub scenes: Option<ScenesConfig>,
    pub groups: Option<GroupsConfig>,
    pub routines: Option<RoutinesConfig>,
}

type OpaqueIntegrationsConfigs = HashMap<IntegrationId, config::Value>;

pub fn read_config() -> Result<(Config, OpaqueIntegrationsConfigs)> {
    let builder = config::Config::builder();

    let root = std::env::current_dir().unwrap();
    let sample_path = root.join("Settings.toml.example");

    let path = root.join("Settings.toml");

    if !path.exists() && std::env::var("SKIP_SAMPLE_CONFIG").is_err() {
        error!("Settings.toml not found, generating sample configuration.");
        error!("Set SKIP_SAMPLE_CONFIG environment variable to opt out of this behavior.");
        std::fs::copy(sample_path, path.clone()).unwrap();
    }

    let builder = builder.add_source(config::File::with_name("Settings"));

    let settings = builder.build()?;

    // TODO: until https://github.com/mehcode/config-rs/issues/531 is fixed
    let config = {
        let mut file = File::open(&path)?;
        let mut contents = Default::default();
        file.read_to_string(&mut contents)?;
        toml::from_str(&contents)?
    };

    // let config: Config = serde_path_to_error::deserialize(settings.clone()).wrap_err(
    //     "Failed to deserialize config, compare your config file to Settings.toml.example!",
    // )?;

    let integrations_config = settings
        .get::<OpaqueIntegrationsConfigs>("integrations")
        .wrap_err("Expected to find integrations key in config")?;

    Ok((config, integrations_config))
}
