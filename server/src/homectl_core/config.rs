extern crate config;
use super::{device::DeviceId, group::GroupId, integration::IntegrationId, scene::SceneId};
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

/// Link to another device, means the scene should read current state from
/// another device
#[derive(Clone, Deserialize, Debug)]
pub struct SceneDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
    pub brightness: Option<f64>, // allow overriding brightness
}

/// Link to another scene, means the scene should merge all state from another
/// scene
#[derive(Clone, Deserialize, Debug)]
pub struct SceneLink {
    pub scene_id: SceneId,
}

/// State to be applied to a device
#[derive(Clone, Deserialize, Debug)]
pub struct SceneDeviceState {
    pub power: bool,
    pub color: Option<ColorConfig>,
    pub brightness: Option<f64>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(untagged)]
pub enum SceneDeviceConfig {
    SceneDeviceLink(SceneDeviceLink),
    SceneLink(SceneLink),
    SceneDeviceState(SceneDeviceState),
}

pub type SceneDevicesConfig = HashMap<IntegrationId, HashMap<DeviceId, SceneDeviceConfig>>;
pub type SceneGroupsConfig = HashMap<GroupId, SceneDeviceConfig>;

#[derive(Clone, Deserialize, Debug)]
pub struct SceneConfig {
    pub name: String,
    pub devices: Option<SceneDevicesConfig>,
    pub groups: Option<SceneGroupsConfig>,
}

pub type ScenesConfig = HashMap<SceneId, SceneConfig>;

#[derive(Clone, Deserialize, Debug)]
pub struct GroupDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
}

pub type GroupDevicesConfig = Vec<GroupDeviceLink>;

#[derive(Clone, Deserialize, Debug)]
pub struct GroupLink {
    pub group_id: GroupId,
}

pub type GroupLinksConfig = Vec<GroupLink>;

#[derive(Clone, Deserialize, Debug)]
pub struct GroupConfig {
    pub name: String,
    pub devices: Option<GroupDevicesConfig>,
    pub groups: Option<GroupLinksConfig>,
}

pub type GroupsConfig = HashMap<GroupId, GroupConfig>;

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: IntegrationsConfig,
    pub scenes: ScenesConfig,
    pub groups: GroupsConfig,
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
