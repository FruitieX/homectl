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
    pub brightness: Option<OrderedFloat<f32>>, // allow overriding brightness

    #[serde(flatten)]
    #[ts(skip)]
    pub device_ref: DeviceRef,
}

/// Contains the information needed to activate a scene
#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct ActivateSceneDescriptor {
    /// Scene to activate. When `mirror_from_group` is set, this acts as a
    /// fallback that is used only if the referenced group has no unanimous
    /// currently-active scene.
    pub scene_id: SceneId,

    /// If set, resolve the scene to activate from the currently active scene
    /// of this group at dispatch time. Falls back to `scene_id` if that group
    /// has no unanimous active scene.
    #[serde(default)]
    pub mirror_from_group: Option<GroupId>,

    /// Optionally only apply scene to these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only apply scene to these groups
    pub group_keys: Option<Vec<GroupId>>,

    /// Whether scene-derived transitions should be preserved during activation.
    #[serde(default)]
    pub use_scene_transition: bool,

    /// Optionally override the transition applied when activating this scene.
    #[ts(type = "number | null")]
    pub transition: Option<OrderedFloat<f32>>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RolloutStyle {
    Spatial,
}

/// Contains the information needed to activate a scene as an action.
#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct ActivateSceneActionDescriptor {
    /// Scene to activate. When `mirror_from_group` is set, this acts as a
    /// fallback that is used only if the referenced group has no unanimous
    /// currently-active scene.
    pub scene_id: SceneId,

    /// If set, resolve the scene to activate from the currently active scene
    /// of this group at dispatch time. Falls back to `scene_id` if that group
    /// has no unanimous active scene.
    #[serde(default)]
    pub mirror_from_group: Option<GroupId>,

    /// Optionally only apply scene to these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only apply scene to these groups
    pub group_keys: Option<Vec<GroupId>>,

    /// If true, extend `group_keys` with every group that contains the
    /// triggering device at rule-evaluation time. No-op for actions that are
    /// not triggered by a device event (e.g. `ForceTriggerRoutine`).
    #[serde(default)]
    pub include_source_groups: bool,

    /// Whether scene-derived transitions should be preserved during activation.
    #[serde(default)]
    pub use_scene_transition: bool,

    /// Optionally override the transition applied when activating this scene.
    #[ts(type = "number | null")]
    pub transition: Option<OrderedFloat<f32>>,

    /// Optional rollout style for the activation.
    pub rollout: Option<RolloutStyle>,

    /// Origin device key used by rollout styles that need a source location.
    pub rollout_source_device_key: Option<DeviceKey>,

    /// Total rollout duration in milliseconds.
    #[ts(type = "number | null")]
    pub rollout_duration_ms: Option<u64>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct CycleScenesDescriptor {
    pub scenes: Vec<ActivateSceneDescriptor>,
    pub nowrap: Option<bool>,

    /// Optionally only detect current scene from these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only detect current scene from these groups
    pub group_keys: Option<Vec<GroupId>>,

    /// If true, extend `group_keys` (both for detection and for each scene
    /// activation) with every group that contains the triggering device at
    /// rule-evaluation time.
    #[serde(default)]
    pub include_source_groups: bool,

    /// Optional rollout style for the activation.
    pub rollout: Option<RolloutStyle>,

    /// Origin device key used by rollout styles that need a source location.
    pub rollout_source_device_key: Option<DeviceKey>,

    /// Total rollout duration in milliseconds.
    #[ts(type = "number | null")]
    pub rollout_duration_ms: Option<u64>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct SceneDeviceState {
    pub power: Option<bool>,
    pub color: Option<DeviceColor>,
    pub brightness: Option<OrderedFloat<f32>>,
    pub transition: Option<OrderedFloat<f32>>,
}

impl From<ControllableState> for SceneDeviceState {
    fn from(state: ControllableState) -> Self {
        SceneDeviceState {
            power: Some(state.power),
            color: state.color,
            brightness: state.brightness,
            transition: state.transition,
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

    /// Optional JavaScript that returns per-device overrides.
    pub script: Option<String>,
}

pub type ScenesConfig = BTreeMap<SceneId, SceneConfig>;
pub type SceneOverridesConfig = BTreeMap<SceneId, SceneDevicesConfig>;

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Hash)]
#[ts(export)]
pub struct SceneDeviceStates(pub BTreeMap<DeviceKey, ControllableState>);

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq, Eq, Hash)]
#[ts(export)]
pub struct FlattenedSceneConfig {
    pub name: String,
    pub devices: SceneDeviceStates,
    pub active_overrides: Vec<DeviceKey>,
    pub hidden: Option<bool>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Default, Hash)]
#[ts(export)]
pub struct FlattenedScenesConfig(pub BTreeMap<SceneId, FlattenedSceneConfig>);
