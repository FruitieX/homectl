use super::color::DeviceColor;
use super::device::{DeviceKey, ManagedDeviceState};

use super::{device::DeviceId, group::GroupId, integration::IntegrationId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::convert::Infallible;
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
    #[ts(export)]
    pub struct SceneId(String);
}

impl SceneId {
    pub fn new(scene_id: String) -> SceneId {
        SceneId(scene_id)
    }
}

impl std::str::FromStr for SceneId {
    type Err = Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(SceneId(s.to_string()))
    }
}

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct SceneDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
    pub brightness: Option<f32>, // allow overriding brightness
}

#[derive(TS, Clone, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct SceneDescriptor {
    pub scene_id: SceneId,

    /// Optionally only apply scene to these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only apply scene to these groups
    pub group_keys: Option<Vec<GroupId>>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct CycleScenesDescriptor {
    pub scenes: Vec<SceneDescriptor>,
    pub nowrap: Option<bool>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct SceneDeviceState {
    pub power: bool,
    pub color: Option<DeviceColor>,
    pub brightness: Option<f32>,
    pub transition_ms: Option<u64>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[serde(untagged)]
#[ts(export)]
pub enum SceneDeviceConfig {
    /// Link to another device, means the scene should read current state from
    /// another device
    DeviceLink(SceneDeviceLink),

    /// Link to another scene, means the scene should merge all state from another
    /// scene
    SceneLink(SceneDescriptor),

    /// State to be applied to a device
    DeviceState(SceneDeviceState),
}

pub type SceneDevicesConfig = HashMap<IntegrationId, HashMap<DeviceId, SceneDeviceConfig>>;

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct SceneGroupsConfig(pub HashMap<GroupId, SceneDeviceConfig>);

/// Device "search" config as used directly in the configuration file. We use device names instead of device id as key.
#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct SceneDevicesSearchConfig(pub HashMap<IntegrationId, HashMap<String, SceneDeviceConfig>>);

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct SceneConfig {
    pub name: String,
    pub devices: Option<SceneDevicesSearchConfig>,
    pub groups: Option<SceneGroupsConfig>,
    pub hidden: Option<bool>,
}

pub type ScenesConfig = HashMap<SceneId, SceneConfig>;

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq)]
#[ts(export)]
pub struct SceneDeviceStates(pub HashMap<DeviceKey, ManagedDeviceState>);

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq)]
#[ts(export)]
pub struct FlattenedSceneConfig {
    pub name: String,
    pub devices: SceneDeviceStates,
    pub hidden: Option<bool>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Default)]
#[ts(export)]
pub struct FlattenedScenesConfig(pub HashMap<SceneId, FlattenedSceneConfig>);
