pub type SceneId = String;
use super::{device::DeviceId, group::GroupId, integration::IntegrationId};
use palette::{rgb::Rgb, Hsv, Lch};
use serde::Deserialize;
use std::collections::HashMap;

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
