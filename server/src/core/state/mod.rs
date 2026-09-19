use crate::db::config_queries::{
    self, ConfigExport, CoreConfigRow, DashboardLayoutRow, DashboardWidgetRow,
    DeviceDisplayNameRow, DevicePositionRow, DeviceSensorConfigRow, FloorplanExportRow,
    FloorplanMetadataRow, FloorplanRow, GroupPositionRow, GroupRow, IntegrationRow, RoutineRow,
    SceneRow, WidgetSettingRow,
};
use crate::types::{
    device::{DeviceKey, DevicesState},
    event::TxEventChannel,
    group::FlattenedGroupsConfig,
    integration::IntegrationId,
    routine_status::RoutineStatuses,
    scene::FlattenedScenesConfig,
};

pub mod actor;
pub mod command;
pub mod metrics;

pub use actor::{spawn_state_actor, StateHandle};
pub use command::StateCommand;

use super::{
    automation::ConfigCatalog,
    devices::Devices,
    groups::Groups,
    integrations::Integrations,
    routines::Routines,
    scenes::Scenes,
    snapshot::{RuntimeSnapshot, SnapshotChanges, SnapshotHandle},
    ui::Ui,
    websockets::WebSockets,
};
use crate::types::device::{Device, DeviceData};

use color_eyre::Result;
use ordered_float::OrderedFloat;
use serde::Serialize;
use std::time::Duration;
use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
};
use tokio::sync::Mutex;

#[derive(Clone, Default)]
pub struct PendingWsUpdate {
    send_full_state: bool,
    changes: SnapshotChanges,
    device_upserts: BTreeSet<DeviceKey>,
    device_removals: BTreeSet<DeviceKey>,
}

impl PendingWsUpdate {
    pub fn full_state() -> Self {
        Self {
            send_full_state: true,
            changes: SnapshotChanges::all(),
            ..Self::default()
        }
    }

    pub fn device_upsert(device_key: DeviceKey, mut changes: SnapshotChanges) -> Self {
        changes.devices = true;
        Self {
            changes,
            device_upserts: BTreeSet::from([device_key]),
            ..Self::default()
        }
    }

    pub fn device_removals(device_keys: Vec<DeviceKey>, mut changes: SnapshotChanges) -> Self {
        changes.devices = true;
        Self {
            changes,
            device_removals: device_keys.into_iter().collect(),
            ..Self::default()
        }
    }

    fn include(&mut self, other: Self) {
        self.send_full_state |= other.send_full_state;
        self.changes.include(other.changes);
        self.device_upserts.extend(other.device_upserts);
        self.device_removals.extend(other.device_removals);
    }

    fn has_websocket_changes(&self) -> bool {
        self.send_full_state
            || self.changes.devices
            || self.changes.flattened_groups
            || self.changes.flattened_scenes
            || self.changes.routine_statuses
            || self.changes.ui_state
    }
}

impl From<SnapshotChanges> for PendingWsUpdate {
    fn from(changes: SnapshotChanges) -> Self {
        Self {
            changes,
            ..Self::default()
        }
    }
}

pub struct AppState {
    pub calibration_sessions: HashMap<String, super::calibration_session::CalibrationSession>,
    pub warming_up: bool,
    pub runtime_config: ConfigExport,
    pub integrations: Integrations,
    pub groups: Groups,
    pub scenes: Scenes,
    pub devices: Devices,
    pub rules: Routines,
    /// Typed helper definitions and current values (P05).
    pub helpers: crate::core::helpers::Helpers,
    /// Manual-intent revisions used to reject stale v2 plans (A03).
    pub intents: crate::core::automation::IntentTracker,
    /// Owner bookkeeping, lazy worker pool, and invocation contexts for v2
    /// script programs (P07).
    pub scripts: crate::core::automation::ScriptExecution,
    /// Actor-authoritative named timer jobs (P09).
    pub timers: crate::core::automation::TimerStore,
    /// Validated timer fires waiting for the next coherent frame (P09).
    pub pending_timer_fires: Vec<crate::core::automation::TimerFire>,
    /// Validated sustained-predicate maturities waiting for the next frame.
    pub pending_predicate_fires: Vec<crate::core::automation::PredicateDeadlineFire>,
    /// Validated schedule occurrences waiting for the next frame (K).
    pub pending_schedule_fires: Vec<crate::core::automation::ScheduleOccurrenceFire>,
    /// Injected wall/monotonic clock used by scheduling (P09).
    pub clock: Arc<dyn crate::core::clock::Clock>,
    pub event_tx: TxEventChannel,
    pub ws: WebSockets,
    pub ui: Ui,
    pub ws_broadcast_pending: Arc<AtomicBool>,
    pub pending_ws_update: Arc<StdMutex<PendingWsUpdate>>,
    pub runtime_apply_lock: Arc<Mutex<()>>,
    pub snapshot: SnapshotHandle,
    /// Bounded record of recent actor-command frames for diagnostics (P02).
    pub frame_log: crate::types::automation_event::FrameLog,
}

impl AppState {
    pub fn get_runtime_config(&self) -> &ConfigExport {
        &self.runtime_config
    }

    /// Republish changed runtime snapshot fields while reusing unchanged
    /// `Arc` payloads from the currently published snapshot.
    pub fn publish_snapshot(&self, changes: SnapshotChanges) {
        if changes.is_empty() {
            return;
        }

        let previous = self.snapshot.load();
        let snapshot = RuntimeSnapshot {
            runtime_config: if changes.runtime_config {
                Arc::new(self.runtime_config.clone())
            } else {
                Arc::clone(&previous.runtime_config)
            },
            devices: if changes.devices || changes.runtime_config {
                let mut devices = self.devices.get_state().clone();
                for device in devices.0.values_mut() {
                    if let crate::types::device::DeviceData::Controllable(data) = &mut device.data {
                        data.disabled = Some(
                            self.runtime_config
                                .integrations
                                .iter()
                                .find(|row| row.id == device.integration_id.to_string())
                                .is_some_and(|row| {
                                    crate::types::integration::device_is_disabled(
                                        &row.config,
                                        &device.id.to_string(),
                                    )
                                }),
                        );
                    }
                }
                Arc::new(devices)
            } else {
                Arc::clone(&previous.devices)
            },
            flattened_groups: if changes.flattened_groups {
                Arc::new(self.groups.get_flattened_groups().clone())
            } else {
                Arc::clone(&previous.flattened_groups)
            },
            flattened_scenes: if changes.flattened_scenes {
                Arc::new(self.scenes.get_flattened_scenes().clone())
            } else {
                Arc::clone(&previous.flattened_scenes)
            },
            routine_statuses: if changes.routine_statuses {
                self.rules.get_runtime_statuses()
            } else {
                Arc::clone(&previous.routine_statuses)
            },
            helper_statuses: if changes.helper_statuses {
                Arc::new(self.helpers.statuses())
            } else {
                Arc::clone(&previous.helper_statuses)
            },
            timers: if changes.timers {
                Arc::new(self.timer_statuses())
            } else {
                Arc::clone(&previous.timers)
            },
            ui_state: if changes.ui_state {
                Arc::new(self.ui.get_state().clone())
            } else {
                Arc::clone(&previous.ui_state)
            },
            warming_up: self.warming_up,
        };
        self.snapshot.store(Arc::new(snapshot));
    }

    pub fn update_core_config(&mut self, config: CoreConfigRow) {
        self.runtime_config.core = config;
    }

    /// Apply the configured system-wide fallback only to the outbound copy of
    /// a command. Explicit device, scene, and action transitions remain
    /// untouched, and the fallback is not written into device or scene state.
    pub fn apply_default_transition(&self, mut device: Device) -> Device {
        let Some(default_transition_ms) = self.runtime_config.core.default_transition_ms else {
            return device;
        };

        if let DeviceData::Controllable(data) = &mut device.data {
            if data.state.transition.is_none() {
                data.state.transition = Some(OrderedFloat(default_transition_ms as f32 / 1000.0));
            }
        }

        device
    }

    pub fn upsert_device_display_override(&mut self, row: DeviceDisplayNameRow) {
        if let Some(existing) = self
            .runtime_config
            .device_display_overrides
            .iter_mut()
            .find(|existing| existing.device_key == row.device_key)
        {
            *existing = row;
        } else {
            self.runtime_config.device_display_overrides.push(row);
            self.runtime_config
                .device_display_overrides
                .sort_by(|left, right| left.device_key.cmp(&right.device_key));
        }
    }

    pub fn delete_device_display_override(&mut self, device_key: &str) -> bool {
        let len_before = self.runtime_config.device_display_overrides.len();
        self.runtime_config
            .device_display_overrides
            .retain(|row| row.device_key != device_key);
        self.runtime_config.device_display_overrides.len() != len_before
    }

    pub fn upsert_device_color_calibration(
        &mut self,
        row: crate::core::color_calibration::DeviceColorCalibration,
    ) {
        self.runtime_config
            .color_calibration_assignments
            .retain(|assignment| assignment.device_key != row.device_key);
        if let Some(existing) = self
            .runtime_config
            .device_color_calibrations
            .iter_mut()
            .find(|existing| existing.device_key == row.device_key)
        {
            *existing = row;
        } else {
            self.runtime_config.device_color_calibrations.push(row);
            self.runtime_config
                .device_color_calibrations
                .sort_by(|left, right| left.device_key.cmp(&right.device_key));
        }
    }

    pub fn delete_device_color_calibration(&mut self, device_key: &str) -> bool {
        let len_before = self.runtime_config.device_color_calibrations.len()
            + self.runtime_config.color_calibration_assignments.len();
        self.runtime_config
            .color_calibration_assignments
            .retain(|assignment| assignment.device_key != device_key);
        self.runtime_config
            .device_color_calibrations
            .retain(|row| row.device_key != device_key);
        self.runtime_config.device_color_calibrations.len()
            + self.runtime_config.color_calibration_assignments.len()
            != len_before
    }

    pub fn upsert_device_sensor_config(&mut self, row: DeviceSensorConfigRow) {
        if let Some(existing) = self
            .runtime_config
            .device_sensor_configs
            .iter_mut()
            .find(|existing| existing.device_ref == row.device_ref)
        {
            *existing = row;
        } else {
            self.runtime_config.device_sensor_configs.push(row);
            self.runtime_config
                .device_sensor_configs
                .sort_by(|left, right| left.device_ref.cmp(&right.device_ref));
        }
    }

    pub fn delete_device_sensor_config(&mut self, device_ref: &str) -> bool {
        let len_before = self.runtime_config.device_sensor_configs.len();
        self.runtime_config
            .device_sensor_configs
            .retain(|row| row.device_ref != device_ref);
        self.runtime_config.device_sensor_configs.len() != len_before
    }

    fn promote_legacy_default_floorplan(&mut self) {
        if !self.runtime_config.floorplans.is_empty() {
            return;
        }

        if let Some(floorplan) = self.runtime_config.floorplan.take() {
            self.runtime_config.floorplans.push(FloorplanExportRow {
                id: "default".to_string(),
                name: "Default".to_string(),
                image_data: floorplan.image_data,
                image_mime_type: floorplan.image_mime_type,
                width: floorplan.width,
                height: floorplan.height,
                grid_data: None,
            });
        }
    }

    fn ensure_floorplan_index(&mut self, floorplan_id: &str) -> usize {
        self.promote_legacy_default_floorplan();

        if let Some(index) = self
            .runtime_config
            .floorplans
            .iter()
            .position(|floorplan| floorplan.id == floorplan_id)
        {
            return index;
        }

        self.runtime_config.floorplans.push(FloorplanExportRow {
            id: floorplan_id.to_string(),
            name: if floorplan_id == "default" {
                "Default".to_string()
            } else {
                floorplan_id.to_string()
            },
            image_data: None,
            image_mime_type: None,
            width: None,
            height: None,
            grid_data: None,
        });
        self.runtime_config.floorplans.len() - 1
    }

    pub fn create_floorplan_metadata(&mut self, floorplan: FloorplanMetadataRow) -> bool {
        self.promote_legacy_default_floorplan();
        if self
            .runtime_config
            .floorplans
            .iter()
            .any(|existing| existing.id == floorplan.id)
        {
            return false;
        }

        self.runtime_config.floorplans.push(FloorplanExportRow {
            id: floorplan.id,
            name: floorplan.name,
            image_data: None,
            image_mime_type: None,
            width: None,
            height: None,
            grid_data: None,
        });
        true
    }

    pub fn update_floorplan_metadata(&mut self, floorplan: FloorplanMetadataRow) -> bool {
        self.promote_legacy_default_floorplan();
        if let Some(existing) = self
            .runtime_config
            .floorplans
            .iter_mut()
            .find(|existing| existing.id == floorplan.id)
        {
            existing.name = floorplan.name;
            true
        } else {
            false
        }
    }

    pub fn delete_floorplan(&mut self, floorplan_id: &str) -> bool {
        self.promote_legacy_default_floorplan();
        let len_before = self.runtime_config.floorplans.len();
        self.runtime_config
            .floorplans
            .retain(|floorplan| floorplan.id != floorplan_id);
        self.runtime_config.floorplans.len() != len_before
    }

    pub fn upsert_floorplan_content(&mut self, floorplan_id: &str, floorplan: FloorplanRow) {
        let index = self.ensure_floorplan_index(floorplan_id);
        let existing = &mut self.runtime_config.floorplans[index];
        existing.image_data = floorplan.image_data;
        existing.image_mime_type = floorplan.image_mime_type;
        existing.width = floorplan.width;
        existing.height = floorplan.height;
    }

    pub fn set_floorplan_grid(&mut self, floorplan_id: &str, grid: String) {
        let index = self.ensure_floorplan_index(floorplan_id);
        self.runtime_config.floorplans[index].grid_data = Some(grid);
    }

    pub fn clear_floorplan_image(&mut self, floorplan_id: &str) -> bool {
        self.promote_legacy_default_floorplan();
        if let Some(existing) = self
            .runtime_config
            .floorplans
            .iter_mut()
            .find(|existing| existing.id == floorplan_id)
        {
            existing.image_data = None;
            existing.image_mime_type = None;
            existing.width = None;
            existing.height = None;
            true
        } else {
            false
        }
    }

    /// Returns all device positions reconstructed from persisted floorplan
    /// grid data for spatial rollout dispatch.
    pub fn effective_device_positions(&self) -> Vec<DevicePositionRow> {
        config_queries::extract_floorplan_device_positions(&self.runtime_config.floorplans)
    }

    pub fn upsert_group_position(&mut self, position: GroupPositionRow) {
        if let Some(existing) = self
            .runtime_config
            .group_positions
            .iter_mut()
            .find(|existing| existing.group_id == position.group_id)
        {
            *existing = position;
        } else {
            self.runtime_config.group_positions.push(position);
            self.runtime_config
                .group_positions
                .sort_by(|left, right| left.group_id.cmp(&right.group_id));
        }
    }

    pub fn delete_group_position(&mut self, group_id: &str) -> bool {
        let len_before = self.runtime_config.group_positions.len();
        self.runtime_config
            .group_positions
            .retain(|position| position.group_id != group_id);
        self.runtime_config.group_positions.len() != len_before
    }

    pub fn upsert_dashboard_layout(
        &mut self,
        mut layout: DashboardLayoutRow,
    ) -> DashboardLayoutRow {
        if layout.id <= 0 {
            layout.id = self
                .runtime_config
                .dashboard_layouts
                .iter()
                .map(|existing| existing.id)
                .max()
                .unwrap_or(0)
                + 1;
        }

        if layout.is_default {
            for existing in &mut self.runtime_config.dashboard_layouts {
                existing.is_default = false;
            }
        }

        if let Some(existing) = self
            .runtime_config
            .dashboard_layouts
            .iter_mut()
            .find(|existing| existing.id == layout.id)
        {
            *existing = layout.clone();
        } else {
            self.runtime_config.dashboard_layouts.push(layout.clone());
        }

        self.runtime_config
            .dashboard_layouts
            .sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));

        layout
    }

    pub fn delete_dashboard_layout(&mut self, layout_id: i32) -> bool {
        let len_before = self.runtime_config.dashboard_layouts.len();
        self.runtime_config
            .dashboard_layouts
            .retain(|layout| layout.id != layout_id);
        let deleted = self.runtime_config.dashboard_layouts.len() != len_before;
        if deleted {
            self.runtime_config
                .dashboard_widgets
                .retain(|widget| widget.layout_id != layout_id);
        }
        deleted
    }

    pub fn upsert_dashboard_widget(
        &mut self,
        mut widget: DashboardWidgetRow,
    ) -> DashboardWidgetRow {
        if widget.id <= 0 {
            widget.id = self
                .runtime_config
                .dashboard_widgets
                .iter()
                .map(|existing| existing.id)
                .max()
                .unwrap_or(0)
                + 1;
        }

        if let Some(existing) = self
            .runtime_config
            .dashboard_widgets
            .iter_mut()
            .find(|existing| existing.id == widget.id)
        {
            *existing = widget.clone();
        } else {
            self.runtime_config.dashboard_widgets.push(widget.clone());
        }

        self.runtime_config
            .dashboard_widgets
            .sort_by(|left, right| {
                left.layout_id
                    .cmp(&right.layout_id)
                    .then(left.sort_order.cmp(&right.sort_order))
                    .then(left.id.cmp(&right.id))
            });

        widget
    }

    pub fn delete_dashboard_widget(&mut self, widget_id: i32) -> bool {
        let len_before = self.runtime_config.dashboard_widgets.len();
        self.runtime_config
            .dashboard_widgets
            .retain(|widget| widget.id != widget_id);
        self.runtime_config.dashboard_widgets.len() != len_before
    }

    pub fn upsert_widget_setting(&mut self, setting: WidgetSettingRow) {
        if let Some(existing) = self
            .runtime_config
            .widget_settings
            .iter_mut()
            .find(|existing| existing.key == setting.key)
        {
            *existing = setting;
        } else {
            self.runtime_config.widget_settings.push(setting);
        }

        self.runtime_config
            .widget_settings
            .sort_by(|left, right| left.key.cmp(&right.key));
    }

    pub fn upsert_group(&mut self, group: GroupRow) {
        if let Some(existing) = self
            .runtime_config
            .groups
            .iter_mut()
            .find(|existing| existing.id == group.id)
        {
            *existing = group;
        } else {
            self.runtime_config.groups.push(group);
            self.runtime_config
                .groups
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_group(&mut self, group_id: &str) -> bool {
        let len_before = self.runtime_config.groups.len();
        self.runtime_config
            .groups
            .retain(|group| group.id != group_id);
        self.runtime_config.groups.len() != len_before
    }

    pub fn apply_runtime_groups(&mut self) {
        self.groups.load_config_rows(&self.runtime_config.groups);
        self.groups.force_invalidate(&self.devices);
        self.scenes.force_invalidate(&self.devices, &self.groups);
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            flattened_groups: true,
            flattened_scenes: true,
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
    }

    pub fn upsert_integration(&mut self, integration: IntegrationRow) {
        if let Some(existing) = self
            .runtime_config
            .integrations
            .iter_mut()
            .find(|existing| existing.id == integration.id)
        {
            *existing = integration;
        } else {
            self.runtime_config.integrations.push(integration);
            self.runtime_config
                .integrations
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_integration(&mut self, integration_id: &str) -> bool {
        let len_before = self.runtime_config.integrations.len();
        self.runtime_config
            .integrations
            .retain(|integration| integration.id != integration_id);
        self.runtime_config.integrations.len() != len_before
    }

    fn remove_devices_for_integrations(&mut self, removed_ids: &[IntegrationId]) -> Vec<DeviceKey> {
        let mut removed_device_keys = Vec::new();
        for id in removed_ids {
            removed_device_keys.extend(self.devices.remove_devices_by_integration(id));
        }
        removed_device_keys
    }

    pub fn commit_runtime_integrations_update(
        &mut self,
        runtime_config: ConfigExport,
        integrations: Integrations,
        removed_ids: Vec<IntegrationId>,
    ) {
        // Only replace the integration domain: unrelated actor writes may have
        // happened while lifecycle work ran outside this task.
        self.runtime_config.integrations = runtime_config.integrations;
        self.integrations = integrations;
        let removed_device_keys = self.remove_devices_for_integrations(&removed_ids);
        // Device policy projections (e.g. disabled) must reach already-open UIs.
        self.schedule_ws_broadcast(PendingWsUpdate::full_state());

        if !removed_ids.is_empty() {
            self.refresh_routine_statuses();
            self.schedule_ws_broadcast(PendingWsUpdate::device_removals(
                removed_device_keys,
                SnapshotChanges {
                    devices: true,
                    routine_statuses: true,
                    ..SnapshotChanges::none()
                },
            ));
        }
    }

    pub fn commit_runtime_config_update(
        &mut self,
        runtime_config: ConfigExport,
        integrations: Integrations,
        removed_ids: Vec<IntegrationId>,
    ) {
        self.runtime_config = runtime_config;
        self.integrations = integrations;
        let removed_device_keys = self.remove_devices_for_integrations(&removed_ids);
        self.apply_runtime_helpers();
        self.apply_runtime_groups();
        self.apply_runtime_scenes();
        self.apply_runtime_routines();
        if !removed_device_keys.is_empty() {
            self.schedule_ws_broadcast(PendingWsUpdate::device_removals(
                removed_device_keys,
                SnapshotChanges::devices(),
            ));
        }
    }

    pub async fn apply_runtime_integrations(&mut self) -> Result<()> {
        let removed_ids = self
            .integrations
            .reload_config_rows(&self.runtime_config.integrations)
            .await?;

        let mut removed_device_keys = Vec::new();
        for id in &removed_ids {
            removed_device_keys.extend(self.devices.remove_devices_by_integration(id));
        }

        if !removed_ids.is_empty() {
            self.refresh_routine_statuses();
            self.schedule_ws_broadcast(PendingWsUpdate::device_removals(
                removed_device_keys,
                SnapshotChanges {
                    devices: true,
                    routine_statuses: true,
                    ..SnapshotChanges::none()
                },
            ));
        }

        Ok(())
    }

    pub async fn apply_runtime_config(&mut self) -> Result<()> {
        self.apply_runtime_integrations().await?;
        self.apply_runtime_helpers();
        self.apply_runtime_groups();
        self.apply_runtime_scenes();
        self.apply_runtime_routines();
        Ok(())
    }

    pub fn upsert_scene(&mut self, scene: SceneRow) {
        if let Some(existing) = self
            .runtime_config
            .scenes
            .iter_mut()
            .find(|existing| existing.id == scene.id)
        {
            *existing = scene;
        } else {
            self.runtime_config.scenes.push(scene);
            self.runtime_config
                .scenes
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_scene(&mut self, scene_id: &str) -> bool {
        let len_before = self.runtime_config.scenes.len();
        self.runtime_config
            .scenes
            .retain(|scene| scene.id != scene_id);
        self.runtime_config.scenes.len() != len_before
    }

    pub fn apply_runtime_scenes(&mut self) {
        let overrides = self.scenes.get_scene_overrides();
        self.scenes
            .load_config_rows(&self.runtime_config.scenes, overrides);
        self.sync_script_owners();
        self.scenes.force_invalidate(&self.devices, &self.groups);
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            flattened_scenes: true,
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
    }

    pub fn upsert_routine(&mut self, routine: RoutineRow) {
        if let Some(existing) = self
            .runtime_config
            .routines
            .iter_mut()
            .find(|existing| existing.id == routine.id)
        {
            *existing = routine;
        } else {
            self.runtime_config.routines.push(routine);
            self.runtime_config
                .routines
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub fn delete_routine(&mut self, routine_id: &str) -> bool {
        let len_before = self.runtime_config.routines.len();
        self.runtime_config
            .routines
            .retain(|routine| routine.id != routine_id);
        self.runtime_config.routines.len() != len_before
    }

    pub fn apply_runtime_routines(&mut self) {
        let catalog = ConfigCatalog::new(
            self.devices.get_state().0.keys().cloned(),
            &self.runtime_config,
        );
        self.rules
            .load_config_rows(&self.runtime_config.routines, &catalog);
        self.sync_script_owners();
        self.timers.retain_current(&self.v2_definition_revisions());
        self.arm_schedules();
        // E06: reloaded definitions seed transition memory from current state
        // instead of treating already-true predicates as fresh edges.
        self.rules
            .seed_transitions(&self.devices, &self.groups, Some(&self.helpers));
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
    }

    /// Current definition revisions of compiled v2 routines.
    pub fn v2_definition_revisions(
        &self,
    ) -> std::collections::BTreeMap<crate::types::rule::RoutineId, i64> {
        self.rules
            .compiled_v2_routines()
            .iter()
            .map(|(routine_id, definition)| (routine_id.clone(), definition.revision))
            .collect()
    }

    /// Arm the next occurrence of every live schedule trigger (K).
    /// Idempotent: a live occurrence for the current revision is kept.
    pub fn arm_schedules(&mut self) {
        let now_monotonic_ms = self.clock.monotonic_ms();
        let now_wall_ms = self.clock.wall_ms();
        let mut armed = false;
        for (routine_id, definition) in self.rules.compiled_v2_routines() {
            for trigger in &definition.compiled.normalized.triggers {
                let crate::types::automation_definition::TriggerSpec::Schedule { id, schedule } =
                    trigger
                else {
                    continue;
                };
                if self
                    .timers
                    .pending_schedule_generation(routine_id, id)
                    .is_some()
                {
                    continue;
                }
                match schedule_due(schedule, now_monotonic_ms, now_wall_ms) {
                    Ok(Some((due_monotonic_ms, due_wall_ms))) => {
                        match self.timers.ensure_schedule(
                            routine_id,
                            definition.revision,
                            id,
                            due_monotonic_ms,
                            due_wall_ms,
                        ) {
                            Ok(_) => armed = true,
                            Err(error) => warn!(
                                "Schedule arming for routine {routine_id} failed: {}",
                                error.message()
                            ),
                        }
                    }
                    Ok(None) => {
                        warn!(
                            "Schedule trigger {id} of routine {routine_id} has no next occurrence"
                        )
                    }
                    Err(error) => {
                        warn!(
                            "Schedule trigger {id} of routine {routine_id} cannot resolve: {error}"
                        )
                    }
                }
            }
        }
        if armed {
            self.schedule_ws_broadcast(SnapshotChanges {
                timers: true,
                ..SnapshotChanges::none()
            });
        }
    }

    /// Compiled schedule spec for a live trigger, used to apply backlog policy
    /// when an occurrence wakeup is consumed (K).
    pub fn schedule_spec(
        &self,
        routine_id: &crate::types::rule::RoutineId,
        definition_revision: i64,
        trigger: &crate::types::automation_definition::NodeId,
    ) -> Option<crate::types::automation_definition::ScheduleSpec> {
        use crate::types::automation_definition::TriggerSpec;

        let definition = self.rules.compiled_v2_routines().get(routine_id)?;
        if definition.revision != definition_revision {
            return None;
        }
        definition
            .compiled
            .normalized
            .triggers
            .iter()
            .find_map(|candidate| match candidate {
                TriggerSpec::Schedule { id, schedule } if id == trigger => Some(schedule.clone()),
                _ => None,
            })
    }

    /// Whether a consumed occurrence is still within its backlog policy. A
    /// skipped occurrence always runs (lateness is not backlog); a coalesced
    /// catch-up runs only inside its bounded lateness.
    pub fn schedule_within_lateness(
        &self,
        schedule: &crate::types::automation_definition::ScheduleSpec,
        due_wall_ms: i64,
    ) -> bool {
        schedule_within_lateness_at(schedule, due_wall_ms, self.clock.wall_ms())
    }

    /// Pending named-timer wakeups for the scheduler driver (P09).
    pub fn timer_wakeups(&self) -> Vec<crate::core::automation::TimerWakeup> {
        self.timers.wakeups()
    }

    /// Read-only projection of live timer jobs for the published snapshot.
    pub fn timer_statuses(&self) -> Vec<crate::types::timer_status::TimerRuntimeStatus> {
        self.timers.runtime_statuses(self.clock.monotonic_ms())
    }

    /// Actor-routed administrative timer cancellation with generation
    /// checking. Ordinary timer actions remain owner-scoped; this exists for
    /// explicitly addressed inspection/control (P09).
    pub fn cancel_timer(
        &mut self,
        routine_id: &crate::types::rule::RoutineId,
        timer: &crate::types::automation_definition::TimerId,
        expected_generation: Option<u64>,
    ) -> crate::core::automation::TimerCancellation {
        self.timers
            .cancel_checked(routine_id, timer, expected_generation)
    }

    /// Reconcile script owner generations with the compiled v2 definitions and
    /// legacy script-bearing routines so an edit/disable/reload rejects pending
    /// worker results (S16, Section 6.4).
    pub fn sync_script_owners(&mut self) {
        let legacy_owners = self.rules.legacy_script_owners();
        let scene_owners = self.scenes.script_revisions();
        self.scripts.sync_owners(
            self.rules.compiled_v2_routines(),
            &legacy_owners,
            &scene_owners,
        );
    }

    pub async fn refresh_runtime_config_from_db(&mut self) -> Result<()> {
        self.runtime_config = config_queries::db_export_config().await?;
        Ok(())
    }

    pub fn refresh_routine_statuses(&mut self) {
        // Live arms annotate the v2 statuses before the published projection
        // is rebuilt, so `armed`/`due_wall_ms` are never stale in the Arc.
        self.annotate_trigger_arms();
        self.rules
            .refresh_runtime_statuses(&self.devices, &self.groups, Some(&self.helpers));
    }

    /// Project live predicate/schedule wakeup arms into trigger statuses
    /// (J06/K) so the snapshot exposes armed/deadline per trigger.
    pub fn annotate_trigger_arms(&mut self) {
        use crate::types::event::TimerWakeupJob;

        let arms = self
            .timers
            .wakeups()
            .into_iter()
            .filter_map(|wakeup| {
                let trigger = match &wakeup.job {
                    TimerWakeupJob::PredicateDeadline { trigger }
                    | TimerWakeupJob::ScheduleOccurrence { trigger } => trigger.clone(),
                    TimerWakeupJob::NamedTimer { .. } => return None,
                };
                Some(((wakeup.routine_id, trigger), wakeup.due_wall_ms))
            })
            .collect();
        self.rules.annotate_trigger_arms(&arms);
    }

    /// Reload typed helper definitions and durable values from the runtime
    /// config, then republish statuses. Helper definitions are validated at
    /// save/import; invalid rows are surfaced through plan suppression at use.
    pub fn apply_runtime_helpers(&mut self) {
        let definitions = self.runtime_config.helpers.clone();
        let durable = self
            .runtime_config
            .helper_values
            .iter()
            .map(|row| {
                (
                    crate::types::automation_definition::HelperId(row.id.clone()),
                    row.value.clone(),
                    row.revision,
                )
            })
            .collect();
        self.helpers.load_rows(definitions, durable);
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            helper_statuses: true,
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
    }

    /// Schedule a debounced WebSocket broadcast.
    ///
    /// Batches multiple state updates within 100ms into a single targeted
    /// patch, preserving full-state sends for initial websocket syncs.
    pub fn schedule_ws_broadcast(&self, update: impl Into<PendingWsUpdate>) {
        {
            let mut pending_update = self
                .pending_ws_update
                .lock()
                .expect("pending_ws_update lock poisoned");
            pending_update.include(update.into());
        }

        // If broadcast already scheduled, skip
        if self.ws_broadcast_pending.swap(true, Ordering::SeqCst) {
            return;
        }

        let snapshot = self.snapshot.clone();
        let ws = self.ws.clone();
        let pending = self.ws_broadcast_pending.clone();
        let pending_update = self.pending_ws_update.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            pending.store(false, Ordering::SeqCst);
            let update = {
                let mut pending_update = pending_update
                    .lock()
                    .expect("pending_ws_update lock poisoned");
                std::mem::take(&mut *pending_update)
            };

            send_state_ws_patch_from_snapshot(&snapshot, &ws, None, update).await;
        });
    }

    /// Sends current state over WebSockets. If user_id is omitted, the message
    /// is broadcast to all connected peers.
    pub async fn send_state_ws(&self, user_id: Option<usize>) {
        send_state_ws_from_snapshot(&self.snapshot, &self.ws, user_id).await;
    }

    /// Hot-reload integrations from the database with full lifecycle support.
    /// Adds new integrations, removes deleted ones (cleaning up their devices),
    /// and restarts modified ones.
    pub async fn reload_integrations(&mut self) -> Result<()> {
        info!("Hot-reloading integrations from database...");
        match self.integrations.reload_integrations().await {
            Ok(removed_ids) => {
                if let Err(e) = self.refresh_runtime_config_from_db().await {
                    warn!("Failed to refresh runtime config snapshot: {e}");
                }
                // Clean up devices belonging to removed integrations
                let mut removed_device_keys = Vec::new();
                for id in &removed_ids {
                    removed_device_keys.extend(self.devices.remove_devices_by_integration(id));
                }
                if !removed_ids.is_empty() {
                    self.refresh_routine_statuses();
                    self.schedule_ws_broadcast(PendingWsUpdate::device_removals(
                        removed_device_keys,
                        SnapshotChanges {
                            devices: true,
                            routine_statuses: true,
                            ..SnapshotChanges::none()
                        },
                    ));
                }
            }
            Err(e) => {
                warn!("Failed to reload integrations: {e}");
            }
        }
        Ok(())
    }

    /// Hot-reload groups from the database
    pub async fn reload_groups(&mut self) -> Result<()> {
        info!("Hot-reloading groups from database...");
        self.groups.reload_from_db().await?;
        if let Err(e) = self.refresh_runtime_config_from_db().await {
            warn!("Failed to refresh runtime config snapshot: {e}");
        }

        self.groups.force_invalidate(&self.devices);
        self.scenes.force_invalidate(&self.devices, &self.groups);

        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            flattened_groups: true,
            flattened_scenes: true,
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
        Ok(())
    }

    /// Hot-reload scenes from the database
    pub async fn reload_scenes(&mut self) -> Result<()> {
        info!("Hot-reloading scenes from database...");
        self.scenes.refresh_db_scenes().await;
        if let Err(e) = self.refresh_runtime_config_from_db().await {
            warn!("Failed to refresh runtime config snapshot: {e}");
        }

        self.scenes.force_invalidate(&self.devices, &self.groups);

        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            flattened_scenes: true,
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
        Ok(())
    }

    /// Hot-reload routines from the database
    pub async fn reload_routines(&mut self) -> Result<()> {
        info!("Hot-reloading routines from database...");
        let catalog = ConfigCatalog::new(
            self.devices.get_state().0.keys().cloned(),
            &self.runtime_config,
        );
        self.rules.reload_from_db(&catalog).await?;
        if let Err(e) = self.refresh_runtime_config_from_db().await {
            warn!("Failed to refresh runtime config snapshot: {e}");
        }
        self.sync_script_owners();
        self.rules
            .seed_transitions(&self.devices, &self.groups, Some(&self.helpers));
        self.refresh_routine_statuses();
        self.schedule_ws_broadcast(SnapshotChanges {
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
        Ok(())
    }
}

#[derive(Serialize)]
struct StateUpdateRef<'a> {
    devices: DevicesState,
    scenes: &'a FlattenedScenesConfig,
    groups: &'a FlattenedGroupsConfig,
    routine_statuses: &'a RoutineStatuses,
    ui_state: &'a HashMap<String, serde_json::Value>,
}

#[derive(Serialize)]
enum WebSocketResponseRef<'a> {
    State(StateUpdateRef<'a>),
}

#[derive(Serialize)]
struct DevicesPatchRef<'a> {
    upserted: DevicesState,
    removed: &'a [DeviceKey],
}

#[derive(Serialize)]
struct StatePatchRef<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    devices: Option<DevicesPatchRef<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scenes: Option<&'a FlattenedScenesConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    groups: Option<&'a FlattenedGroupsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    routine_statuses: Option<&'a RoutineStatuses>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ui_state: Option<&'a HashMap<String, serde_json::Value>>,
}

#[derive(Serialize)]
enum WebSocketPatchResponseRef<'a> {
    Patch(StatePatchRef<'a>),
}

/// Build a `StateUpdate` from the currently published runtime snapshot and
/// broadcast it to the given WebSocket peers. If `user_id` is omitted, the
/// message is broadcast to all connected peers.
// Preserve native color modes; display conversion belongs in the client.
pub async fn send_state_ws_from_snapshot(
    snapshot: &SnapshotHandle,
    ws: &WebSockets,
    user_id: Option<usize>,
) {
    // Make sure there are any users connected before broadcasting
    if user_id.is_none() && ws.num_users().await == 0 {
        return;
    }

    let snap = snapshot.load();
    let devices_converted = snap
        .devices
        .0
        .values()
        .map(|device| (device.get_device_key(), device.clone()))
        .collect();

    let message = WebSocketResponseRef::State(StateUpdateRef {
        devices: DevicesState(devices_converted),
        scenes: snap.flattened_scenes.as_ref(),
        groups: snap.flattened_groups.as_ref(),
        routine_statuses: snap.routine_statuses.as_ref(),
        ui_state: snap.ui_state.as_ref(),
    });

    ws.send(user_id, &message).await;
}

/// Whether an occurrence is still within its backlog policy (K). A skipped
/// occurrence always runs (lateness is not backlog); a coalesced catch-up runs
/// only inside its bounded lateness.
fn schedule_within_lateness_at(
    schedule: &crate::types::automation_definition::ScheduleSpec,
    due_wall_ms: i64,
    now_wall_ms: i64,
) -> bool {
    use crate::types::automation_definition::BacklogPolicy;

    match schedule.backlog {
        BacklogPolicy::Skip => true,
        BacklogPolicy::CatchUpOnce => match schedule.catch_up_lateness_ms {
            Some(lateness) => now_wall_ms.saturating_sub(due_wall_ms) <= lateness as i64,
            None => true,
        },
    }
}

/// Next due time for a schedule trigger: intervals are monotonic-relative,
/// calendar occurrences resolve in the stored zone (K). Returns wall and
/// monotonic due times in milliseconds.
fn schedule_due(
    schedule: &crate::types::automation_definition::ScheduleSpec,
    now_monotonic_ms: u64,
    now_wall_ms: i64,
) -> Result<Option<(u64, i64)>, String> {
    use crate::core::automation::calendar::{next_cron_occurrence, parse_schedule_zone};

    if let Some(every_ms) = schedule.every_ms {
        return Ok(Some((
            now_monotonic_ms.saturating_add(every_ms),
            now_wall_ms.saturating_add(every_ms as i64),
        )));
    }
    let Some(cron) = schedule.cron.as_deref() else {
        return Ok(None);
    };
    let zone_name = schedule.timezone.as_deref().unwrap_or("UTC");
    let zone =
        parse_schedule_zone(zone_name).ok_or_else(|| format!("unknown timezone {zone_name:?}"))?;
    let now = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_wall_ms)
        .ok_or_else(|| "wall clock out of range".to_string())?;
    let Some(occurrence) = next_cron_occurrence(cron, zone, now)? else {
        return Ok(None);
    };
    let due_wall_ms = occurrence.instant.timestamp_millis();
    let delay_ms = (due_wall_ms - now_wall_ms).max(1) as u64;
    Ok(Some((
        now_monotonic_ms.saturating_add(delay_ms),
        due_wall_ms,
    )))
}

#[cfg(test)]
mod native_color_tests {
    use super::*;
    use crate::core::snapshot::new_snapshot_handle;
    use crate::types::device::Device;

    #[tokio::test]
    async fn full_and_partial_updates_preserve_xy() {
        let (state, _events) = crate::core::event::tests::test_state();
        let device: Device = serde_json::from_value(serde_json::json!({
            "id": "lamp", "name": "Lamp", "integration_id": "dummy", "raw": null,
            "data": {"Controllable": {
                "scene_id": null, "state_source": null,
                "state": {"power": true, "brightness": 0.5, "color": {"x": 0.3, "y": 0.4}, "transition": null},
                "capabilities": {"brightness": true, "xy": true, "hs": true, "rgb": false, "ct": null},
                "managed": "Full"
            }}
        })).unwrap();
        let key = device.get_device_key();
        let mut snapshot = state.snapshot.load().as_ref().clone();
        snapshot.devices = Arc::new(DevicesState([(key.clone(), device)].into()));
        let handle = new_snapshot_handle(snapshot);
        let ws = WebSockets::default();
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        ws.user_connected(1, tx).await;
        send_state_ws_from_snapshot(&handle, &ws, Some(1)).await;
        send_state_ws_patch_from_snapshot(
            &handle,
            &ws,
            Some(1),
            PendingWsUpdate::device_upsert(key, SnapshotChanges::devices()),
        )
        .await;
        send_state_ws_patch_from_snapshot(&handle, &ws, Some(1), SnapshotChanges::devices().into())
            .await;
        for path in [
            "/State/devices/dummy~1lamp/data/Controllable/state/color",
            "/Patch/devices/upserted/dummy~1lamp/data/Controllable/state/color",
            "/Patch/devices/upserted/dummy~1lamp/data/Controllable/state/color",
        ] {
            let message = rx.recv().await.unwrap();
            let value: serde_json::Value = serde_json::from_str(message.to_str().unwrap()).unwrap();
            let color = value.pointer(path).expect("native color in device update");
            assert!(color.get("x").is_some() && color.get("y").is_some());
            assert!(color.get("h").is_none());
        }
    }

    // K: intervals rearm monotonic-relative; calendar occurrences resolve in
    // the stored zone against the wall clock.
    #[test]
    fn schedule_due_resolves_intervals_and_calendar() {
        use crate::types::automation_definition::{BacklogPolicy, ScheduleSpec};

        let interval = ScheduleSpec {
            cron: None,
            every_ms: Some(1_500),
            timezone: None,
            backlog: BacklogPolicy::Skip,
            catch_up_lateness_ms: None,
        };
        assert_eq!(
            schedule_due(&interval, 100, 1_000).unwrap(),
            Some((1_600, 2_500))
        );

        let calendar = ScheduleSpec {
            cron: Some("0 0 8 * * *".to_string()),
            every_ms: None,
            timezone: Some("UTC".to_string()),
            backlog: BacklogPolicy::Skip,
            catch_up_lateness_ms: None,
        };
        // 1_000_000 ms = 1970-01-01T00:16:40Z; the next 08:00 UTC is
        // 28_800_000 ms, 27_800_000 ms after the reference.
        assert_eq!(
            schedule_due(&calendar, 0, 1_000_000).unwrap(),
            Some((27_800_000, 28_800_000))
        );

        let unknown_zone = ScheduleSpec {
            timezone: Some("Mars/Olympus".to_string()),
            ..calendar
        };
        assert!(schedule_due(&unknown_zone, 0, 1_000_000).is_err());
    }

    // K: skip always runs an emitted occurrence; catch-up drops one outside
    // its bounded lateness (lateness is not backlog).
    #[test]
    fn schedule_lateness_policy_is_bounded_only_for_catch_up() {
        use crate::types::automation_definition::{BacklogPolicy, ScheduleSpec};

        let mut spec = ScheduleSpec {
            cron: Some("0 0 8 * * *".to_string()),
            every_ms: None,
            timezone: Some("UTC".to_string()),
            backlog: BacklogPolicy::Skip,
            catch_up_lateness_ms: None,
        };
        assert!(schedule_within_lateness_at(&spec, 0, 999_999));

        spec.backlog = BacklogPolicy::CatchUpOnce;
        spec.catch_up_lateness_ms = Some(30_000);
        assert!(schedule_within_lateness_at(&spec, 1_000_000, 1_030_000));
        assert!(!schedule_within_lateness_at(&spec, 1_000_000, 1_030_001));
    }
}

/// Build a targeted `StatePatch` from the currently published runtime snapshot
/// and broadcast it to the given WebSocket peers.
pub async fn send_state_ws_patch_from_snapshot(
    snapshot: &SnapshotHandle,
    ws: &WebSockets,
    user_id: Option<usize>,
    update: PendingWsUpdate,
) {
    if !update.has_websocket_changes() {
        return;
    }

    if update.send_full_state {
        send_state_ws_from_snapshot(snapshot, ws, user_id).await;
        return;
    }

    // Make sure there are any users connected before broadcasting.
    if user_id.is_none() && ws.num_users().await == 0 {
        return;
    }

    let snap = snapshot.load();
    let removed_devices = update.device_removals.into_iter().collect::<Vec<_>>();
    let devices = if update.changes.devices {
        let device_upserts = if update.device_upserts.is_empty() && removed_devices.is_empty() {
            snap.devices
                .0
                .values()
                .map(|device| (device.get_device_key(), device.clone()))
                .collect()
        } else {
            update
                .device_upserts
                .into_iter()
                .filter_map(|device_key| {
                    snap.devices
                        .0
                        .get(&device_key)
                        .map(|device| (device_key, device.clone()))
                })
                .collect()
        };

        Some(DevicesPatchRef {
            upserted: DevicesState(device_upserts),
            removed: &removed_devices,
        })
    } else {
        None
    };

    let message = WebSocketPatchResponseRef::Patch(StatePatchRef {
        devices,
        scenes: update
            .changes
            .flattened_scenes
            .then_some(snap.flattened_scenes.as_ref()),
        groups: update
            .changes
            .flattened_groups
            .then_some(snap.flattened_groups.as_ref()),
        routine_statuses: update
            .changes
            .routine_statuses
            .then_some(snap.routine_statuses.as_ref()),
        ui_state: update.changes.ui_state.then_some(snap.ui_state.as_ref()),
    });

    ws.send(user_id, &message).await;
}
