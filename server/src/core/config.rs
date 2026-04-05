use crate::types::{
    group::GroupsConfig,
    integration::IntegrationsConfig,
    rule::RoutinesConfig,
    scene::ScenesConfig,
};
use color_eyre::Result;
use serde::Deserialize;
use std::{fs::File, io::Read, path::Path};

#[derive(Deserialize, Debug)]
pub struct CoreConfig {
    pub warmup_time_seconds: Option<u64>,
    pub port: Option<u16>,
}

/// TOML file config structure, used only for importing/seeding the DB.
#[derive(Deserialize, Debug)]
pub struct TomlConfig {
    pub core: Option<CoreConfig>,
    pub integrations: Option<IntegrationsConfig>,
    pub scenes: Option<ScenesConfig>,
    pub groups: Option<GroupsConfig>,
    pub routines: Option<RoutinesConfig>,
}

/// Opaque integration configs: maps integration ID strings to their full
/// TOML values, which we convert to serde_json::Value for the integration
/// constructors.
pub type OpaqueIntegrationsConfigs =
    std::collections::HashMap<String, toml::Value>;

/// Full raw TOML config including opaque integrations.
#[derive(Deserialize, Debug)]
struct RawTomlConfig {
    #[serde(default)]
    integrations: Option<OpaqueIntegrationsConfigs>,
}

/// Parse a TOML config file into typed config + opaque integration values.
pub fn parse_toml_file(path: &Path) -> Result<(TomlConfig, OpaqueIntegrationsConfigs)> {
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;

    let config: TomlConfig = toml::from_str(&contents)?;
    let raw: RawTomlConfig = toml::from_str(&contents)?;

    Ok((config, raw.integrations.unwrap_or_default()))
}
