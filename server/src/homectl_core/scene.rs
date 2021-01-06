pub type SceneId = String;
use super::{device::{DeviceColor, DeviceId}, group::GroupId, integration::IntegrationId};
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

pub fn color_config_as_device_color(color_config: ColorConfig) -> DeviceColor {
    match color_config {
        ColorConfig::Lch(lch) => lch.into(),
        ColorConfig::Hsv(hsv) => hsv,
        ColorConfig::Rgb(rgb) => rgb.into(),
    }
}

#[derive(Clone, Deserialize, Debug)]
pub struct SceneDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
    pub brightness: Option<f64>, // allow overriding brightness
}

#[derive(Clone, Deserialize, Debug)]
pub struct SceneDescriptor {
    pub scene_id: SceneId,
    pub skip_locked_devices: Option<bool>
}

#[derive(Clone, Deserialize, Debug)]
pub struct CycleScenesDescriptor {
    pub scenes: Vec<SceneDescriptor>,
}

#[derive(Clone, Deserialize, Debug)]
pub struct SceneDeviceState {
    pub power: bool,
    pub color: Option<ColorConfig>,
    pub brightness: Option<f64>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(untagged)]
pub enum SceneDeviceConfig {
    /// Link to another device, means the scene should read current state from
    /// another device
    SceneDeviceLink(SceneDeviceLink),

    /// Link to another scene, means the scene should merge all state from another
    /// scene
    SceneLink(SceneDescriptor),

    /// State to be applied to a device
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
