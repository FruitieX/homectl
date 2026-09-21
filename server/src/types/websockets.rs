use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    automation_value::HelperRuntimeStatus,
    device::{DeviceKey, DevicesState},
    event::Event,
    group::FlattenedGroupsConfig,
    routine_status::RoutineStatuses,
    scene::FlattenedScenesConfig,
    timer_status::TimerRuntimeStatus,
};

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub enum WebSocketRequest {
    DeviceCommand(super::device_command::DeviceCommand),
    SceneCommand(super::scene_command::SceneCommand),
    EventMessage(Box<Event>),
    /// Ask the server to resend the full state after a detected revision gap.
    Resync(ResyncRequest),
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct ResyncRequest {}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct StateUpdate {
    /// Monotonic revision of this full state.
    #[ts(type = "number")]
    pub revision: u64,
    pub devices: DevicesState,
    pub scenes: FlattenedScenesConfig,
    pub groups: FlattenedGroupsConfig,
    pub routine_statuses: RoutineStatuses,
    /// Live named timer jobs (P09). `remaining_ms` is a publish-time sample;
    /// clients should count down from `due_wall_ms`.
    pub timers: Vec<TimerRuntimeStatus>,
    /// Current helper values (P12). Widgets and editors read these instead of
    /// polling the config API.
    pub helper_statuses: Vec<HelperRuntimeStatus>,
    pub ui_state: HashMap<String, serde_json::Value>,
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct DevicesPatch {
    pub upserted: DevicesState,
    pub removed: Vec<DeviceKey>,
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct StatePatch {
    /// Revision of this patch; apply only when it follows the last seen one.
    #[ts(type = "number")]
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<DevicesPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scenes: Option<FlattenedScenesConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<FlattenedGroupsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routine_statuses: Option<RoutineStatuses>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timers: Option<Vec<TimerRuntimeStatus>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper_statuses: Option<Vec<HelperRuntimeStatus>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_state: Option<HashMap<String, serde_json::Value>>,
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub enum WebSocketResponse {
    DeviceCommandResult(super::device_command::DeviceCommandResult),
    SceneCommandResult(super::scene_command::SceneCommandResult),
    State(StateUpdate),
    Patch(StatePatch),
}
