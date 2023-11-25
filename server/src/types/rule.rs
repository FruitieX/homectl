use super::device::{DeviceRef, SensorDevice};
use super::{group::GroupId, scene::SceneId};

use super::action::Actions;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    #[ts(export)]
    pub struct RoutineId(pub String);
}

#[derive(Clone, Deserialize, Debug)]
pub struct SensorRule {
    pub state: SensorDevice,

    #[serde(flatten)]
    pub device_ref: DeviceRef,
}

#[derive(Clone, Deserialize, Debug)]
pub struct DeviceRule {
    pub power: Option<bool>,
    pub scene: Option<SceneId>,

    #[serde(flatten)]
    pub device_ref: DeviceRef,
}

#[derive(Clone, Deserialize, Debug)]
pub struct GroupRule {
    pub group_id: GroupId,
    pub power: Option<bool>,
    pub scene: Option<SceneId>,
}

#[derive(Clone, Deserialize, Debug)]
pub struct AnyRule {
    pub any: Rules,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(untagged)]
pub enum Rule {
    /// Match fields on individual sensors.
    Sensor(SensorRule),

    /// Match fields on individual devices.
    Device(DeviceRule),

    /// Match fields on entire device groups.
    Group(GroupRule),

    /// Normally, all rules must match for a routine to be triggered. This
    /// special rule allows you to group multiple rules together, such that only
    /// one of the contained rules need to match.
    Any(AnyRule),
}

pub type Rules = Vec<Rule>;

#[derive(Clone, Deserialize, Debug)]
pub struct Routine {
    pub name: String,
    pub rules: Rules,
    pub actions: Actions,
}

pub type RoutinesConfig = HashMap<RoutineId, Routine>;

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct ForceTriggerRoutineDescriptor {
    pub routine_id: RoutineId,
}
