use super::{device::DeviceId, integration::IntegrationId, rules_engine::Action};
use serde::Deserialize;
use std::collections::HashMap;

pub type RoutineId = String;

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
    integration_id: IntegrationId,
    device_id: DeviceId,
    state: SensorRuleState,
}

pub type RulesConfig = Vec<Rule>;
pub type ActionsConfig = Vec<Action>;

#[derive(Clone, Deserialize, Debug)]
pub struct RoutineConfig {
    pub name: String,
    pub rules: RulesConfig,
    pub actions: ActionsConfig,
}

pub type RoutinesConfig = HashMap<RoutineId, RoutineConfig>;
