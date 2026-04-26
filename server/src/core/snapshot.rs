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

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SnapshotChanges {
    pub runtime_config: bool,
    pub devices: bool,
    pub flattened_groups: bool,
    pub flattened_scenes: bool,
    pub routine_statuses: bool,
    pub ui_state: bool,
    pub warming_up: bool,
}

impl SnapshotChanges {
    pub const fn none() -> Self {
        Self {
            runtime_config: false,
            devices: false,
            flattened_groups: false,
            flattened_scenes: false,
            routine_statuses: false,
            ui_state: false,
            warming_up: false,
        }
    }

    pub const fn all() -> Self {
        Self {
            runtime_config: true,
            devices: true,
            flattened_groups: true,
            flattened_scenes: true,
            routine_statuses: true,
            ui_state: true,
            warming_up: true,
        }
    }

    pub const fn devices() -> Self {
        Self {
            devices: true,
            ..Self::none()
        }
    }

    pub const fn ui_state() -> Self {
        Self {
            ui_state: true,
            ..Self::none()
        }
    }

    pub const fn startup_completed() -> Self {
        Self {
            flattened_groups: true,
            flattened_scenes: true,
            routine_statuses: true,
            warming_up: true,
            ..Self::none()
        }
    }

    pub const fn device_topology() -> Self {
        Self {
            devices: true,
            flattened_groups: true,
            flattened_scenes: true,
            routine_statuses: true,
            ..Self::none()
        }
    }

    pub const fn scenes() -> Self {
        Self {
            runtime_config: true,
            flattened_scenes: true,
            routine_statuses: true,
            ..Self::none()
        }
    }

    pub fn include(&mut self, other: Self) {
        self.runtime_config |= other.runtime_config;
        self.devices |= other.devices;
        self.flattened_groups |= other.flattened_groups;
        self.flattened_scenes |= other.flattened_scenes;
        self.routine_statuses |= other.routine_statuses;
        self.ui_state |= other.ui_state;
        self.warming_up |= other.warming_up;
    }

    pub const fn is_empty(self) -> bool {
        !self.runtime_config
            && !self.devices
            && !self.flattened_groups
            && !self.flattened_scenes
            && !self.routine_statuses
            && !self.ui_state
            && !self.warming_up
    }
}

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
