use super::{action::Actions, device::DeviceId, integration::IntegrationId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    pub struct RoutineId(String);
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

#[derive(Clone, Deserialize, Debug)]
pub struct Routine {
    pub name: String,
    pub rules: Rules,
    pub actions: Actions,
}

pub type RoutinesConfig = HashMap<RoutineId, Routine>;
