use crate::device::{CorrelatedColorTemperature, DeviceKey, DeviceState};

use super::{
    device::{DeviceColor, DeviceId},
    group::GroupId,
    integration::IntegrationId,
};
use palette::{rgb::Rgb, Hsv, Lch};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
    pub struct SceneId(String);
}

impl SceneId {
    pub fn new(scene_id: String) -> SceneId {
        SceneId(scene_id)
    }
}

#[derive(Clone, Deserialize, Debug, Serialize)]
#[serde(untagged)]
pub enum ColorConfig {
    Lch(Lch),
    Hsv(Hsv),
    Rgb(Rgb),
}

pub fn color_config_as_device_color(color_config: ColorConfig) -> DeviceColor {
    DeviceColor::Hsv(match color_config {
        ColorConfig::Lch(lch) => lch.into(),
        ColorConfig::Hsv(hsv) => hsv,
        ColorConfig::Rgb(rgb) => rgb.into(),
    })
}

#[derive(Clone, Deserialize, Debug, Serialize)]
pub struct SceneDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
    pub brightness: Option<f32>, // allow overriding brightness
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct SceneDescriptor {
    pub scene_id: SceneId,

    /// Optionally only apply scene to these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only apply scene to these groups
    pub group_keys: Option<Vec<GroupId>>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct CycleScenesDescriptor {
    pub scenes: Vec<SceneDescriptor>,
    pub nowrap: Option<bool>,
}

#[derive(Clone, Deserialize, Debug, Serialize)]
pub struct SceneDeviceState {
    pub power: bool,
    pub color: Option<ColorConfig>,
    pub brightness: Option<f32>,
    pub cct: Option<CorrelatedColorTemperature>,
    pub transition_ms: Option<u64>,
}

#[derive(Clone, Deserialize, Debug, Serialize)]
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

/// Device "search" config as used directly in the configuration file. We use device names instead of device id as key.
pub type SceneDevicesSearchConfig = HashMap<IntegrationId, HashMap<String, SceneDeviceConfig>>;

#[derive(Clone, Deserialize, Debug, Serialize)]
pub struct SceneConfig {
    pub name: String,
    pub devices: Option<SceneDevicesSearchConfig>,
    pub groups: Option<SceneGroupsConfig>,
    pub hidden: Option<bool>,
}

pub type ScenesConfig = HashMap<SceneId, SceneConfig>;

pub type SceneDeviceStates = HashMap<DeviceKey, DeviceState>;

#[derive(Clone, Deserialize, Debug, Serialize, PartialEq)]
pub struct FlattenedSceneConfig {
    pub name: String,
    pub devices: SceneDeviceStates,
    pub hidden: Option<bool>,
}
pub type FlattenedScenesConfig = HashMap<SceneId, FlattenedSceneConfig>;
