use super::device::{DeviceRef, SensorDevice};
use super::{group::GroupId, scene::SceneId};

use super::action::Actions;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
    #[ts(export)]
    pub struct RoutineId(pub String);
}

/// Determines how a rule triggers in response to state changes.
#[derive(TS, Clone, Debug, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TriggerMode {
    /// Trigger on every state update that matches, even if the value is the same.
    /// The rule only triggers if the device is the source of the current event.
    /// This is the default for sensor rules (button presses).
    #[default]
    Pulse,

    /// Trigger only when the state transitions from non-matching to matching.
    /// Unlike pulse, this won't re-trigger if the same value is sent again.
    Edge,

    /// Trigger while the state matches (current behavior).
    /// The routine fires on transition from not-triggered to triggered.
    Level,
}

#[derive(Clone, Deserialize, Debug)]
pub struct SensorRule {
    pub state: SensorDevice,

    /// How this rule should trigger. Defaults to `pulse` for sensors.
    #[serde(default)]
    pub trigger_mode: TriggerMode,

    #[serde(flatten)]
    pub device_ref: DeviceRef,
}

#[derive(Clone, Deserialize, Debug)]
pub struct DeviceRule {
    pub power: Option<bool>,
    pub scene: Option<SceneId>,

    /// How this rule should trigger. Defaults to `level` for device rules.
    #[serde(default = "default_level_trigger_mode")]
    pub trigger_mode: TriggerMode,

    #[serde(flatten)]
    pub device_ref: DeviceRef,
}

fn default_level_trigger_mode() -> TriggerMode {
    TriggerMode::Level
}

#[derive(Clone, Deserialize, Debug)]
pub struct GroupRule {
    pub group_id: GroupId,
    pub power: Option<bool>,
    pub scene: Option<SceneId>,

    /// How this rule should trigger. Defaults to `level` for group rules.
    #[serde(default = "default_level_trigger_mode")]
    pub trigger_mode: TriggerMode,
}

#[derive(Clone, Deserialize, Debug)]
pub struct AnyRule {
    pub any: Rules,
}

/// A JavaScript-based rule that evaluates a script returning boolean
#[derive(Clone, Deserialize, Debug)]
pub struct ScriptRule {
    /// JavaScript code that should return a boolean value.
    /// Has access to `devices` and `groups` global objects.
    pub script: String,
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

    /// Evaluates given expression (legacy evalexpr).
    EvalExpr(evalexpr::Node),

    /// Evaluates JavaScript script that returns boolean.
    /// The script has access to `devices` and `groups` globals.
    Script(ScriptRule),
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
