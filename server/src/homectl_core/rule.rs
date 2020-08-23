use super::{device::DeviceId, integration::IntegrationId, scene::{CycleScenesDescriptor, SceneDescriptor}};
use serde::Deserialize;
use std::collections::HashMap;

pub type RoutineId = String;

#[derive(Clone, Deserialize, Debug)]
#[serde(tag = "action")]
pub enum Action {
    ActivateScene(SceneDescriptor),
    CycleScenes(CycleScenesDescriptor),
}

/// button sensors, motion sensors
#[derive(Clone, Deserialize, Debug)]
#[serde(untagged)]
pub enum SensorRuleState {
    OnOffSensor {
        value: bool,
    },
    DimmerSwitch {
        on: Option<bool>,
        up: Option<bool>,
        down: Option<bool>,
        off: Option<bool>,
    },
    Unknown,
}

#[derive(Clone, Deserialize, Debug)]
pub struct Rule {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
    pub state: SensorRuleState,
}

pub type Rules = Vec<Rule>;
pub type Actions = Vec<Action>;

#[derive(Clone, Deserialize, Debug)]
pub struct Routine {
    pub name: String,
    pub rules: Rules,
    pub actions: Actions,
}

pub type RoutinesConfig = HashMap<RoutineId, Routine>;
