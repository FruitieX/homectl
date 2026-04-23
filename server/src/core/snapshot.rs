//! Immutable, cheaply-cloneable snapshot of runtime state published by the
//! state owner after every mutation.
//!
//! Read-mostly consumers (HTTP API handlers, widget routes, websocket
//! snapshots) should prefer loading a snapshot over acquiring the
//! `AppState` `RwLock`. Fields are wrapped in `Arc` so publishing a new
//! snapshot only clones a handful of pointers.
//!
//! This is Phase 1 of the actor-model refactor: the `RwLock<AppState>`
//! still exists and is the source of truth, but readers can bypass it by
//! calling `snapshot.load()` on the `SnapshotHandle`.

use std::collections::HashMap;
use std::sync::Arc;

use arc_swap::ArcSwap;

use crate::db::config_queries::ConfigExport;
use crate::types::device::DevicesState;
use crate::types::group::FlattenedGroupsConfig;
use crate::types::routine_status::RoutineStatuses;
use crate::types::scene::FlattenedScenesConfig;

#[derive(Clone)]
pub struct RuntimeSnapshot {
    pub runtime_config: Arc<ConfigExport>,
    pub devices: Arc<DevicesState>,
    pub flattened_groups: Arc<FlattenedGroupsConfig>,
    pub flattened_scenes: Arc<FlattenedScenesConfig>,
    pub routine_statuses: Arc<RoutineStatuses>,
    pub ui_state: Arc<HashMap<String, serde_json::Value>>,
    pub warming_up: bool,
}

/// Shared handle for publishing and loading runtime snapshots.
pub type SnapshotHandle = Arc<ArcSwap<RuntimeSnapshot>>;

pub fn new_snapshot_handle(initial: RuntimeSnapshot) -> SnapshotHandle {
    Arc::new(ArcSwap::from_pointee(initial))
}
