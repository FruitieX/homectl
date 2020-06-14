extern crate config;
use super::{integration::IntegrationId, integrations_manager::DeviceId, scene::SceneId};
use palette::{rgb::Rgb, Hsv, Lch};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Debug)]
pub struct IntegrationConfig {
    pub plugin: String,
    // NOTE: integration configs may contain other fields as well.

    // but since we don't know what fields those might be, they have to be
    // deserialized by the integration itself
}

pub type IntegrationsConfig = HashMap<IntegrationId, IntegrationConfig>;

#[derive(Clone, Deserialize, Debug)]
#[serde(untagged)]
pub enum ColorConfig {
    Lch(Lch),
    Hsv(Hsv),
    Rgb(Rgb),
}

pub fn color_config_as_lch(color_config: ColorConfig) -> Lch {
    match color_config {
        ColorConfig::Lch(lch) => lch.into(),
        ColorConfig::Hsv(hsv) => hsv.into(),
        ColorConfig::Rgb(rgb) => rgb.into(),
    }
}

// TODO: this needs to be an enum which contains either an inline device or a "link" to another device
#[derive(Clone, Deserialize, Debug)]
pub struct SceneDeviceConfig {
    pub power: bool,
    pub color: Option<ColorConfig>,
    pub brightness: Option<f64>,
}

pub type SceneDevicesConfig = HashMap<DeviceId, SceneDeviceConfig>;

#[derive(Clone, Deserialize, Debug)]
pub struct SceneConfig {
    pub name: String,
    pub devices: SceneDevicesConfig,
}

pub type ScenesConfig = HashMap<SceneId, SceneConfig>;

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: IntegrationsConfig,
    pub scenes: ScenesConfig,
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
