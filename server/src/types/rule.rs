use super::device::SensorDevice;
use super::{group::GroupId, scene::SceneId};

use super::{action::Actions, device::DeviceId, integration::IntegrationId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    pub struct RoutineId(String);
}

#[derive(Clone, Deserialize, Debug)]
pub struct SensorRule {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
    pub state: SensorDevice,
}

#[derive(Clone, Deserialize, Debug)]
pub struct DeviceRule {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
    pub power: Option<bool>,
    pub scene: Option<SceneId>,
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
    Sensor(SensorRule),
    Device(DeviceRule),
    Group(GroupRule),
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
