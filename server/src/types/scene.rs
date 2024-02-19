use super::color::DeviceColor;
use super::device::{ControllableState, DeviceKey, DeviceRef};

use super::{group::GroupId, integration::IntegrationId};
use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, Ord, PartialOrd, NewtypeDisplay!, NewtypeFrom!)]
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

#[derive(TS, Clone, Deserialize, Debug, Serialize, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct SceneDeviceLink {
    #[ts(type = "number | null")]
    pub brightness: Option<OrderedFloat<f32>>, // allow overriding brightness

    #[serde(flatten)]
    #[ts(skip)]
    pub device_ref: DeviceRef,
}

/// Contains the information needed to activate a scene
#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct ActivateSceneDescriptor {
    pub scene_id: SceneId,

    /// Optionally only apply scene to these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only apply scene to these groups
    pub group_keys: Option<Vec<GroupId>>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct CycleScenesDescriptor {
    pub scenes: Vec<ActivateSceneDescriptor>,
    pub nowrap: Option<bool>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct SceneDeviceState {
    pub power: Option<bool>,
    pub color: Option<DeviceColor>,
    #[ts(type = "number | null")]
    pub brightness: Option<OrderedFloat<f32>>,
    #[ts(type = "number | null")]
    pub transition_ms: Option<u64>,
}

impl From<ControllableState> for SceneDeviceState {
    fn from(state: ControllableState) -> Self {
        SceneDeviceState {
            power: Some(state.power),
            color: state.color,
            brightness: state.brightness,
            transition_ms: state.transition_ms,
        }
    }
}

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq)]
#[serde(untagged)]
#[ts(export)]
pub enum SceneDeviceConfig {
    /// Link to another device, means the scene should read current state from
    /// another device
    DeviceLink(SceneDeviceLink),

    /// Link to another scene, means the scene should merge all state from another
    /// scene
    SceneLink(ActivateSceneDescriptor),

    /// State to be applied to a device
    DeviceState(SceneDeviceState),
}

pub type SceneDevicesConfig = HashMap<DeviceKey, SceneDeviceConfig>;
pub type SceneDevicesConfigs = HashMap<SceneId, (SceneConfig, SceneDevicesConfig)>;

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq)]
#[ts(export)]
pub struct SceneGroupsConfig(pub BTreeMap<GroupId, SceneDeviceConfig>);

/// Device "search" config as used directly in the configuration file. We use device names instead of device id as key.
#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq)]
#[ts(export)]
pub struct SceneDevicesSearchConfig(
    pub BTreeMap<IntegrationId, BTreeMap<String, SceneDeviceConfig>>,
);

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq)]
#[ts(export)]
pub struct SceneConfig {
    pub name: String,
    pub devices: Option<SceneDevicesSearchConfig>,
    pub groups: Option<SceneGroupsConfig>,
    pub hidden: Option<bool>,

    /// Evaluates given expression to compute scene config.
    #[ts(skip)]
    #[serde(skip_serializing)]
    pub expr: Option<evalexpr::Node>,
}

pub type ScenesConfig = BTreeMap<SceneId, SceneConfig>;

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Hash)]
#[ts(export)]
pub struct SceneDeviceStates(pub BTreeMap<DeviceKey, ControllableState>);

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq, Eq, Hash)]
#[ts(export)]
pub struct FlattenedSceneConfig {
    pub name: String,
    pub devices: SceneDeviceStates,
    pub hidden: Option<bool>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Default, Hash)]
#[ts(export)]
pub struct FlattenedScenesConfig(pub BTreeMap<SceneId, FlattenedSceneConfig>);
