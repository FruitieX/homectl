use super::{device::DeviceKey, group::GroupId, scene::SceneId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Activate a scene immediately. Omitted scopes mean all writable scene targets;
/// explicit empty scopes never mean all devices. No rollout or replay is implied.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct SceneCommand {
    pub request_id: String,
    pub scene_id: SceneId,
    pub device_keys: Option<Vec<DeviceKey>>,
    pub group_keys: Option<Vec<GroupId>>,
    #[serde(default)]
    pub use_scene_transition: bool,
    pub transition: Option<f32>,
}

/// Confirms runtime application, not integration delivery or physical state.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct SceneCommandResult {
    pub request_id: String,
    pub applied: bool,
    pub affected_devices: Vec<DeviceKey>,
    pub error: Option<String>,
}
