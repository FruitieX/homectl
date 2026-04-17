//! REST API endpoints for configuration management
//!
//! Provides CRUD endpoints for:
//! - Integrations: GET/POST/PUT/DELETE /api/v1/config/integrations
//! - Groups: GET/POST/PUT/DELETE /api/v1/config/groups
//! - Scenes: GET/POST/PUT/DELETE /api/v1/config/scenes
//! - Routines: GET/POST/PUT/DELETE /api/v1/config/routines
//! - Import/Export: GET/POST /api/v1/config/export, /api/v1/config/import
//! - Migration: POST /api/v1/config/migrate/preview, /api/v1/config/migrate/apply

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use crate::core::logs::recent_logs;
use crate::core::state::AppState;
use crate::db::{
    self,
    actions::{db_delete_device, db_update_device},
    config_queries::{
        self, ConfigExport, CoreConfigRow, DashboardLayoutRow, DashboardWidgetRow,
        DeviceDisplayNameRow, DevicePositionRow, DeviceSensorConfigRow, FloorplanExportRow,
        FloorplanMetadataRow, FloorplanRow, GroupDeviceRow, GroupPositionRow, GroupRow,
        IntegrationRow, RoutineRow, SceneRow,
    },
};
use crate::types::{
    action::{Action, Actions},
    device::{
        ControllableState, Device, DeviceData, DeviceKey, DeviceRef, DevicesState, SensorDevice,
    },
    integration::IntegrationId,
    rule::{AnyRule, Rule, Rules},
    scene::{
        ActivateSceneActionDescriptor, ActivateSceneDescriptor, CycleScenesDescriptor,
        SceneDeviceConfig,
    },
};
use bytes::Buf;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use warp::{http::StatusCode, Filter, Reply};

use super::with_state;

// ============================================================================
// Response Types
// ============================================================================

#[derive(Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Serialize)]
struct RuntimeStatusResponse {
    persistence_available: bool,
    memory_only_mode: bool,
}

#[derive(Serialize)]
struct GroupResponseRow {
    #[serde(flatten)]
    group: GroupRow,
    device_keys: Vec<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> warp::reply::WithStatus<warp::reply::Json> {
        warp::reply::with_status(
            warp::reply::json(&ApiResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
            StatusCode::OK,
        )
    }

    fn created(data: T) -> warp::reply::WithStatus<warp::reply::Json> {
        warp::reply::with_status(
            warp::reply::json(&ApiResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
            StatusCode::CREATED,
        )
    }
}

fn error_response(msg: &str, status: StatusCode) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(&ApiResponse::<()> {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        }),
        status,
    )
}

fn not_found(entity: &str) -> warp::reply::WithStatus<warp::reply::Json> {
    error_response(&format!("{entity} not found"), StatusCode::NOT_FOUND)
}

fn push_unique_error(errors: &mut Vec<String>, error: String) {
    if !errors.contains(&error) {
        errors.push(error);
    }
}

fn decode_path_key(raw: String) -> String {
    percent_decode_str(raw.as_str())
        .decode_utf8_lossy()
        .into_owned()
}

#[derive(Clone, Debug)]
struct DeviceConfigTarget {
    device_key: String,
    integration_id: String,
    device_id: String,
}

#[derive(Default)]
struct DeviceConfigRewriteResult {
    changed_groups: Vec<GroupRow>,
    changed_scenes: Vec<SceneRow>,
    changed_routines: Vec<RoutineRow>,
    display_override_changed: bool,
    sensor_config_changed: bool,
    position_changed: bool,
}

#[derive(Deserialize)]
struct ReplaceDeviceRequest {
    replacement_device_key: String,
}

#[derive(Serialize)]
struct DeviceConfigMutationResponse {
    deleted_device_key: String,
    replacement_device_key: Option<String>,
    updated_groups: usize,
    updated_scenes: usize,
    updated_routines: usize,
    display_override_changed: bool,
    sensor_config_changed: bool,
    position_changed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RewriteStatus {
    Unchanged,
    Changed,
    Remove,
}

impl DeviceConfigTarget {
    fn parse(device_key: &str) -> Option<Self> {
        let (integration_id, device_id) = device_key.split_once('/')?;

        Some(Self {
            device_key: device_key.to_string(),
            integration_id: integration_id.to_string(),
            device_id: device_id.to_string(),
        })
    }

    fn matches_device_ref(&self, device_ref: &DeviceRef) -> bool {
        match device_ref {
            DeviceRef::Id(id_ref) => {
                id_ref.integration_id.to_string() == self.integration_id
                    && id_ref.device_id.to_string() == self.device_id
            }
        }
    }

    fn matches_device(&self, device: &Device) -> bool {
        device.integration_id.to_string() == self.integration_id
            && device.id.to_string() == self.device_id
    }

    fn to_device_ref(&self) -> DeviceRef {
        DeviceRef::new_with_id(
            self.integration_id.clone().into(),
            self.device_id.clone().into(),
        )
    }

    fn to_device_key(&self) -> DeviceKey {
        DeviceKey::new(
            self.integration_id.clone().into(),
            self.device_id.clone().into(),
        )
    }
}

fn rewrite_device_ref(
    device_ref: &mut DeviceRef,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    if !source.matches_device_ref(device_ref) {
        return RewriteStatus::Unchanged;
    }

    let Some(replacement) = replacement else {
        return RewriteStatus::Remove;
    };

    *device_ref = replacement.to_device_ref();
    RewriteStatus::Changed
}

fn rewrite_device_key_option(
    device_key: &mut Option<DeviceKey>,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let Some(existing) = device_key.as_ref() else {
        return RewriteStatus::Unchanged;
    };

    if existing.to_string() != source.device_key {
        return RewriteStatus::Unchanged;
    }

    *device_key = replacement.map(DeviceConfigTarget::to_device_key);
    RewriteStatus::Changed
}

fn rewrite_optional_device_keys(
    device_keys: &mut Option<Vec<DeviceKey>>,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let Some(existing_keys) = device_keys.as_ref() else {
        return RewriteStatus::Unchanged;
    };

    let mut changed = false;
    let mut seen = HashSet::new();
    let mut next_keys = Vec::with_capacity(existing_keys.len());

    for device_key in existing_keys {
        if device_key.to_string() == source.device_key {
            changed = true;
            if let Some(replacement) = replacement {
                let replacement_key = replacement.to_device_key();
                if seen.insert(replacement_key.to_string()) {
                    next_keys.push(replacement_key);
                }
            }
            continue;
        }

        if seen.insert(device_key.to_string()) {
            next_keys.push(device_key.clone());
        }
    }

    if changed {
        *device_keys = Some(next_keys);
        RewriteStatus::Changed
    } else {
        RewriteStatus::Unchanged
    }
}

fn rewrite_required_device_keys(
    device_keys: &mut Vec<DeviceKey>,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let mut changed = false;
    let mut seen = HashSet::new();
    let mut next_keys = Vec::with_capacity(device_keys.len());

    for device_key in device_keys.iter() {
        if device_key.to_string() == source.device_key {
            changed = true;
            if let Some(replacement) = replacement {
                let replacement_key = replacement.to_device_key();
                if seen.insert(replacement_key.to_string()) {
                    next_keys.push(replacement_key);
                }
            }
            continue;
        }

        if seen.insert(device_key.to_string()) {
            next_keys.push(device_key.clone());
        }
    }

    if changed {
        *device_keys = next_keys;
        RewriteStatus::Changed
    } else {
        RewriteStatus::Unchanged
    }
}

fn rewrite_scene_descriptor(
    descriptor: &mut ActivateSceneDescriptor,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    rewrite_optional_device_keys(&mut descriptor.device_keys, source, replacement)
}

fn rewrite_scene_action_descriptor(
    descriptor: &mut ActivateSceneActionDescriptor,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let mut changed = matches!(
        rewrite_optional_device_keys(&mut descriptor.device_keys, source, replacement),
        RewriteStatus::Changed
    );

    changed |= matches!(
        rewrite_device_key_option(
            &mut descriptor.rollout_source_device_key,
            source,
            replacement
        ),
        RewriteStatus::Changed
    );

    if changed {
        RewriteStatus::Changed
    } else {
        RewriteStatus::Unchanged
    }
}

fn rewrite_cycle_scenes_descriptor(
    descriptor: &mut CycleScenesDescriptor,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let mut changed = false;

    for scene in &mut descriptor.scenes {
        changed |= matches!(
            rewrite_scene_descriptor(scene, source, replacement),
            RewriteStatus::Changed
        );
    }

    changed |= matches!(
        rewrite_optional_device_keys(&mut descriptor.device_keys, source, replacement),
        RewriteStatus::Changed
    );
    changed |= matches!(
        rewrite_device_key_option(
            &mut descriptor.rollout_source_device_key,
            source,
            replacement
        ),
        RewriteStatus::Changed
    );

    if changed {
        RewriteStatus::Changed
    } else {
        RewriteStatus::Unchanged
    }
}

fn rewrite_scene_device_config(
    config: &mut SceneDeviceConfig,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    match config {
        SceneDeviceConfig::DeviceLink(link) => {
            rewrite_device_ref(&mut link.device_ref, source, replacement)
        }
        SceneDeviceConfig::SceneLink(link) => rewrite_scene_descriptor(link, source, replacement),
        SceneDeviceConfig::DeviceState(_) => RewriteStatus::Unchanged,
    }
}

fn rewrite_scene_config_value(
    value: &mut serde_json::Value,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let Ok(mut config) = serde_json::from_value::<SceneDeviceConfig>(value.clone()) else {
        return RewriteStatus::Unchanged;
    };

    match rewrite_scene_device_config(&mut config, source, replacement) {
        RewriteStatus::Changed => match serde_json::to_value(&config) {
            Ok(next_value) => {
                *value = next_value;
                RewriteStatus::Changed
            }
            Err(error) => {
                warn!("Failed to serialize rewritten scene config: {error}");
                RewriteStatus::Unchanged
            }
        },
        RewriteStatus::Remove => RewriteStatus::Remove,
        RewriteStatus::Unchanged => RewriteStatus::Unchanged,
    }
}

fn rewrite_rule(
    rule: &mut Rule,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    match rule {
        Rule::Sensor(sensor_rule) => {
            rewrite_device_ref(&mut sensor_rule.device_ref, source, replacement)
        }
        Rule::Device(device_rule) => {
            rewrite_device_ref(&mut device_rule.device_ref, source, replacement)
        }
        Rule::Any(AnyRule { any }) => {
            let mut changed = false;
            let mut next_rules = Vec::with_capacity(any.len());

            for mut child_rule in std::mem::take(any) {
                match rewrite_rule(&mut child_rule, source, replacement) {
                    RewriteStatus::Remove => {
                        changed = true;
                    }
                    RewriteStatus::Changed => {
                        changed = true;
                        next_rules.push(child_rule);
                    }
                    RewriteStatus::Unchanged => next_rules.push(child_rule),
                }
            }

            *any = next_rules;

            if any.is_empty() {
                RewriteStatus::Remove
            } else if changed {
                RewriteStatus::Changed
            } else {
                RewriteStatus::Unchanged
            }
        }
        Rule::Script(script_rule) => {
            let Some(replacement) = replacement else {
                return RewriteStatus::Unchanged;
            };

            let next_script = script_rule
                .script
                .replace(&source.device_key, &replacement.device_key);
            if next_script == script_rule.script {
                RewriteStatus::Unchanged
            } else {
                script_rule.script = next_script;
                RewriteStatus::Changed
            }
        }
        Rule::Group(_) | Rule::EvalExpr(_) => RewriteStatus::Unchanged,
    }
}

fn rewrite_action(
    action: &mut Action,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
    replacement_device: Option<&Device>,
) -> RewriteStatus {
    match action {
        Action::ActivateScene(descriptor) => {
            rewrite_scene_action_descriptor(descriptor, source, replacement)
        }
        Action::CycleScenes(descriptor) => {
            rewrite_cycle_scenes_descriptor(descriptor, source, replacement)
        }
        Action::Dim(descriptor) => {
            rewrite_optional_device_keys(&mut descriptor.device_keys, source, replacement)
        }
        Action::SetDeviceState(device) => {
            if !source.matches_device(device) {
                return RewriteStatus::Unchanged;
            }

            let Some(replacement_device) = replacement_device else {
                return RewriteStatus::Remove;
            };

            device.integration_id = replacement_device.integration_id.clone();
            device.id = replacement_device.id.clone();
            device.name = replacement_device.name.clone();
            RewriteStatus::Changed
        }
        Action::ToggleDeviceOverride { device_keys, .. } => {
            rewrite_required_device_keys(device_keys, source, replacement)
        }
        Action::Custom(_)
        | Action::ForceTriggerRoutine(_)
        | Action::Ui(_)
        | Action::EvalExpr(_) => RewriteStatus::Unchanged,
    }
}

fn rewrite_group_device_refs(
    group: &mut GroupRow,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> bool {
    let mut changed = false;
    let mut seen = HashSet::new();
    let mut next_devices = Vec::with_capacity(group.devices.len());

    for device in std::mem::take(&mut group.devices) {
        if device.integration_id == source.integration_id && device.device_id == source.device_id {
            changed = true;

            if let Some(replacement) = replacement {
                let dedupe_key =
                    format!("{}/{}", replacement.integration_id, replacement.device_id);
                if seen.insert(dedupe_key) {
                    next_devices.push(GroupDeviceRow {
                        integration_id: replacement.integration_id.clone(),
                        device_id: replacement.device_id.clone(),
                    });
                }
            }

            continue;
        }

        let dedupe_key = format!("{}/{}", device.integration_id, device.device_id);
        if seen.insert(dedupe_key) {
            next_devices.push(device);
        }
    }

    group.devices = next_devices;
    changed
}

fn rewrite_scene_device_refs(
    scene: &mut SceneRow,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> bool {
    let mut changed = false;
    let mut next_device_states = HashMap::with_capacity(scene.device_states.len());

    for (device_key, mut config_value) in std::mem::take(&mut scene.device_states) {
        let next_device_key = if device_key == source.device_key {
            changed = true;
            replacement.map(|replacement| replacement.device_key.clone())
        } else {
            Some(device_key)
        };

        match rewrite_scene_config_value(&mut config_value, source, replacement) {
            RewriteStatus::Changed => changed = true,
            RewriteStatus::Remove => {
                changed = true;
                continue;
            }
            RewriteStatus::Unchanged => {}
        }

        let Some(next_device_key) = next_device_key else {
            continue;
        };

        next_device_states
            .entry(next_device_key)
            .or_insert(config_value);
    }

    scene.device_states = next_device_states;

    let mut next_group_states = HashMap::with_capacity(scene.group_states.len());
    for (group_id, mut config_value) in std::mem::take(&mut scene.group_states) {
        match rewrite_scene_config_value(&mut config_value, source, replacement) {
            RewriteStatus::Changed => changed = true,
            RewriteStatus::Remove => {
                changed = true;
                continue;
            }
            RewriteStatus::Unchanged => {}
        }

        next_group_states.insert(group_id, config_value);
    }

    scene.group_states = next_group_states;

    if let (Some(script), Some(replacement)) = (&scene.script, replacement) {
        let next_script = script.replace(&source.device_key, &replacement.device_key);
        if next_script != *script {
            scene.script = Some(next_script);
            changed = true;
        }
    }

    changed
}

fn rewrite_routine_device_refs(
    routine: &mut RoutineRow,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
    replacement_device: Option<&Device>,
) -> bool {
    let mut changed = false;

    let Ok(mut rules) = serde_json::from_value::<Rules>(routine.rules.clone()) else {
        return false;
    };

    let mut next_rules = Vec::with_capacity(rules.len());
    for mut rule in rules.drain(..) {
        match rewrite_rule(&mut rule, source, replacement) {
            RewriteStatus::Remove => changed = true,
            RewriteStatus::Changed => {
                changed = true;
                next_rules.push(rule);
            }
            RewriteStatus::Unchanged => next_rules.push(rule),
        }
    }

    if changed {
        match serde_json::to_value(&next_rules) {
            Ok(value) => routine.rules = value,
            Err(error) => warn!("Failed to serialize rewritten routine rules: {error}"),
        }
    }

    let Ok(mut actions) = serde_json::from_value::<Actions>(routine.actions.clone()) else {
        return changed;
    };

    let mut actions_changed = false;
    let mut next_actions = Vec::with_capacity(actions.len());
    for mut action in actions.drain(..) {
        match rewrite_action(&mut action, source, replacement, replacement_device) {
            RewriteStatus::Remove => actions_changed = true,
            RewriteStatus::Changed => {
                actions_changed = true;
                next_actions.push(action);
            }
            RewriteStatus::Unchanged => next_actions.push(action),
        }
    }

    if actions_changed {
        match serde_json::to_value(&next_actions) {
            Ok(value) => routine.actions = value,
            Err(error) => warn!("Failed to serialize rewritten routine actions: {error}"),
        }
    }

    changed || actions_changed
}

fn rewrite_device_config_references(
    config: &mut ConfigExport,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
    replacement_device: Option<&Device>,
) -> DeviceConfigRewriteResult {
    let mut result = DeviceConfigRewriteResult::default();

    for group in &mut config.groups {
        if rewrite_group_device_refs(group, source, replacement) {
            result.changed_groups.push(group.clone());
        }
    }

    for scene in &mut config.scenes {
        if rewrite_scene_device_refs(scene, source, replacement) {
            result.changed_scenes.push(scene.clone());
        }
    }

    for routine in &mut config.routines {
        if rewrite_routine_device_refs(routine, source, replacement, replacement_device) {
            result.changed_routines.push(routine.clone());
        }
    }

    if let Some(existing) = config
        .device_display_overrides
        .iter_mut()
        .find(|row| row.device_key == source.device_key)
    {
        result.display_override_changed = true;
        if let Some(replacement) = replacement {
            existing.device_key = replacement.device_key.clone();
        }
    }
    if replacement.is_none() {
        config
            .device_display_overrides
            .retain(|row| row.device_key != source.device_key);
    }

    if let Some(existing) = config
        .device_sensor_configs
        .iter_mut()
        .find(|row| row.device_ref == source.device_key)
    {
        result.sensor_config_changed = true;
        if let Some(replacement) = replacement {
            existing.device_ref = replacement.device_key.clone();
        }
    }
    if replacement.is_none() {
        config
            .device_sensor_configs
            .retain(|row| row.device_ref != source.device_key);
    }

    if let Some(existing) = config
        .device_positions
        .iter_mut()
        .find(|row| row.device_key == source.device_key)
    {
        result.position_changed = true;
        if let Some(replacement) = replacement {
            existing.device_key = replacement.device_key.clone();
        }
    }
    if replacement.is_none() {
        config
            .device_positions
            .retain(|row| row.device_key != source.device_key);
    }

    config
        .device_display_overrides
        .sort_by(|left, right| left.device_key.cmp(&right.device_key));
    config
        .device_sensor_configs
        .sort_by(|left, right| left.device_ref.cmp(&right.device_ref));
    config
        .device_positions
        .sort_by(|left, right| left.device_key.cmp(&right.device_key));

    result
}

async fn persist_device_config_rewrite(
    rewrite: &DeviceConfigRewriteResult,
    source: &DeviceConfigTarget,
) {
    for group in &rewrite.changed_groups {
        if let Err(error) = config_queries::db_upsert_group(group).await {
            warn!("Failed to persist updated group '{}': {error}", group.id);
        }
    }

    for scene in &rewrite.changed_scenes {
        if let Err(error) = config_queries::db_upsert_config_scene(scene).await {
            warn!("Failed to persist updated scene '{}': {error}", scene.id);
        }
    }

    for routine in &rewrite.changed_routines {
        if let Err(error) = config_queries::db_upsert_routine(routine).await {
            warn!(
                "Failed to persist updated routine '{}': {error}",
                routine.id
            );
        }
    }

    if rewrite.display_override_changed {
        if let Err(error) =
            config_queries::db_delete_device_display_override(&source.device_key).await
        {
            warn!(
                "Failed to delete source display override for '{}': {error}",
                source.device_key
            );
        }
    }

    if rewrite.sensor_config_changed {
        if let Err(error) = config_queries::db_delete_device_sensor_config(&source.device_key).await
        {
            warn!(
                "Failed to delete source sensor config for '{}': {error}",
                source.device_key
            );
        }
    }

    if rewrite.position_changed {
        if let Err(error) = config_queries::db_delete_device_position(&source.device_key).await {
            warn!(
                "Failed to delete source device position for '{}': {error}",
                source.device_key
            );
        }
    }
}

fn rewrite_force_trigger_routine_references(
    actions_value: &mut serde_json::Value,
    source_id: &str,
    replacement_id: &str,
) -> bool {
    let Ok(mut actions) = serde_json::from_value::<Actions>(actions_value.clone()) else {
        return false;
    };

    let mut changed = false;
    for action in &mut actions {
        if let Action::ForceTriggerRoutine(descriptor) = action {
            if descriptor.routine_id.to_string() == source_id {
                descriptor.routine_id = replacement_id.to_string().into();
                changed = true;
            }
        }
    }

    if !changed {
        return false;
    }

    match serde_json::to_value(&actions) {
        Ok(value) => {
            *actions_value = value;
            true
        }
        Err(error) => {
            warn!("Failed to serialize rewritten routine action references: {error}");
            false
        }
    }
}

fn group_response_row(state: &AppState, group: GroupRow) -> GroupResponseRow {
    let device_keys = state
        .groups
        .get_flattened_groups()
        .0
        .iter()
        .find_map(|(group_id, flattened_group)| {
            (group_id.0 == group.id).then(|| {
                flattened_group
                    .device_keys
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_default();

    GroupResponseRow { group, device_keys }
}

fn legacy_default_floorplan(config: &config_queries::ConfigExport) -> Option<FloorplanExportRow> {
    let floorplan = config.floorplan.as_ref();

    Some(FloorplanExportRow {
        id: "default".to_string(),
        name: "Default".to_string(),
        image_data: floorplan.and_then(|floorplan| floorplan.image_data.clone()),
        image_mime_type: floorplan.and_then(|floorplan| floorplan.image_mime_type.clone()),
        width: floorplan.and_then(|floorplan| floorplan.width),
        height: floorplan.and_then(|floorplan| floorplan.height),
        grid_data: None,
    })
}

fn list_runtime_floorplans(config: &config_queries::ConfigExport) -> Vec<FloorplanMetadataRow> {
    if !config.floorplans.is_empty() {
        return config
            .floorplans
            .iter()
            .map(|floorplan| FloorplanMetadataRow {
                id: floorplan.id.clone(),
                name: floorplan.name.clone(),
            })
            .collect();
    }

    legacy_default_floorplan(config)
        .into_iter()
        .map(|floorplan| FloorplanMetadataRow {
            id: floorplan.id,
            name: floorplan.name,
        })
        .collect()
}

fn get_runtime_floorplan(
    config: &config_queries::ConfigExport,
    floorplan_id: &str,
) -> Option<FloorplanExportRow> {
    config
        .floorplans
        .iter()
        .find(|floorplan| floorplan.id == floorplan_id)
        .cloned()
        .or_else(|| {
            if floorplan_id == "default" {
                legacy_default_floorplan(config)
            } else {
                None
            }
        })
}

// ============================================================================
// Main Config Routes
// ============================================================================

pub fn config(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("config").and(
        core_routes(app_state)
            .or(runtime_status_routes(app_state))
            .or(logs_routes(app_state))
            .or(device_display_name_routes(app_state))
            .or(device_sensor_config_routes(app_state))
            .or(device_config_routes(app_state))
            .or(integrations_routes(app_state))
            .or(groups_routes(app_state))
            .or(scenes_routes(app_state))
            .or(routines_routes(app_state))
            .or(floorplans_routes(app_state))
            .or(floorplan_routes(app_state))
            .or(dashboard_routes(app_state))
            .or(export_import_routes(app_state))
            .or(migrate_routes(app_state)),
    )
}

// ============================================================================
// Core Config
// ============================================================================

fn logs_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("logs")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_logs)
}

async fn list_logs(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(recent_logs()))
}

fn core_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path("core")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_core_config);

    let update = warp::path("core")
        .and(warp::path::end())
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_core_config);

    get.or(update)
}

async fn get_core_config(app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().core.clone(),
    ))
}

async fn update_core_config(
    config: config_queries::CoreConfigRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    {
        let mut state = app_state.write().await;
        state.update_core_config(config.clone());
    }

    if let Err(e) = config_queries::db_update_core_config(&config).await {
        warn!("Failed to persist core config: {e}");
    }

    Ok(ApiResponse::success(config))
}

fn runtime_status_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("runtime-status")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_runtime_status)
}

async fn get_runtime_status(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let persistence_available = db::get_db_connection().is_ok();
    Ok(ApiResponse::success(RuntimeStatusResponse {
        persistence_available,
        memory_only_mode: !persistence_available,
    }))
}

fn device_display_name_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-display-names")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_device_display_names);

    let upsert = warp::path!("device-display-names" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_display_name);

    let delete = warp::path!("device-display-names" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_display_name);

    list.or(upsert).or(delete)
}

async fn list_device_display_names(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().device_display_overrides.clone(),
    ))
}

async fn upsert_device_display_name(
    device_key: String,
    mut row: DeviceDisplayNameRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    row.device_key = decode_path_key(device_key);

    {
        let mut state = app_state.write().await;
        state.upsert_device_display_override(row.clone());
    }

    if let Err(e) = config_queries::db_upsert_device_display_override(&row).await {
        warn!("Failed to persist device display name override: {e}");
    }

    Ok(ApiResponse::success(row))
}

async fn delete_device_display_name(
    device_key: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let device_key = decode_path_key(device_key);
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_device_display_override(&device_key)
    };

    if !deleted {
        return Ok(not_found("Device display name"));
    }

    if let Err(e) = config_queries::db_delete_device_display_override(&device_key).await {
        warn!("Failed to persist device display name deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

fn device_sensor_config_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-sensor-configs")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_device_sensor_configs);

    let upsert = warp::path!("device-sensor-configs" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_sensor_config);

    let delete = warp::path!("device-sensor-configs" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_sensor_config);

    list.or(upsert).or(delete)
}

fn device_config_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let replace = warp::path!("devices" / String / "replace")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(replace_device_config);

    let delete = warp::path!("devices" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_config_device);

    replace.or(delete)
}

async fn replace_device_config(
    device_key: String,
    request: ReplaceDeviceRequest,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let source_key = decode_path_key(device_key);
    let replacement_key = request.replacement_device_key.trim().to_string();

    if source_key == replacement_key {
        return Ok(error_response(
            "Replacement device must differ from the source device.",
            StatusCode::BAD_REQUEST,
        ));
    }

    let Some(source) = DeviceConfigTarget::parse(&source_key) else {
        return Ok(error_response(
            "Invalid source device key.",
            StatusCode::BAD_REQUEST,
        ));
    };
    let Some(replacement) = DeviceConfigTarget::parse(&replacement_key) else {
        return Ok(error_response(
            "Invalid replacement device key.",
            StatusCode::BAD_REQUEST,
        ));
    };

    let (rewrite, response) = {
        let mut state = app_state.write().await;
        let Some(replacement_device) = state
            .devices
            .get_state()
            .0
            .values()
            .find(|device| replacement.matches_device(device))
            .cloned()
        else {
            return Ok(error_response(
                "Replacement device not found in runtime state.",
                StatusCode::BAD_REQUEST,
            ));
        };

        if state
            .devices
            .get_state()
            .0
            .values()
            .all(|device| !source.matches_device(device))
        {
            return Ok(not_found("Device"));
        }

        let mut runtime_config = state.get_runtime_config().clone();
        let rewrite = rewrite_device_config_references(
            &mut runtime_config,
            &source,
            Some(&replacement),
            Some(&replacement_device),
        );

        state.runtime_config = runtime_config;
        state.devices.remove_device(&source.to_device_key());
        state.apply_runtime_groups();
        state.apply_runtime_scenes();
        state.apply_runtime_routines();

        let response = DeviceConfigMutationResponse {
            deleted_device_key: source.device_key.clone(),
            replacement_device_key: Some(replacement.device_key.clone()),
            updated_groups: rewrite.changed_groups.len(),
            updated_scenes: rewrite.changed_scenes.len(),
            updated_routines: rewrite.changed_routines.len(),
            display_override_changed: rewrite.display_override_changed,
            sensor_config_changed: rewrite.sensor_config_changed,
            position_changed: rewrite.position_changed,
        };

        (rewrite, response)
    };

    persist_device_config_rewrite(&rewrite, &source).await;
    if let Err(error) = db_delete_device(&source.to_device_key()).await {
        warn!(
            "Failed to delete source device '{}' from database: {error}",
            source.device_key
        );
    }

    Ok(ApiResponse::success(response))
}

async fn delete_config_device(
    device_key: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let source_key = decode_path_key(device_key);
    let Some(source) = DeviceConfigTarget::parse(&source_key) else {
        return Ok(error_response(
            "Invalid device key.",
            StatusCode::BAD_REQUEST,
        ));
    };

    let (rewrite, response) = {
        let mut state = app_state.write().await;

        if state
            .devices
            .get_state()
            .0
            .values()
            .all(|device| !source.matches_device(device))
        {
            return Ok(not_found("Device"));
        }

        let mut runtime_config = state.get_runtime_config().clone();
        let rewrite = rewrite_device_config_references(&mut runtime_config, &source, None, None);

        state.runtime_config = runtime_config;
        state.devices.remove_device(&source.to_device_key());
        state.apply_runtime_groups();
        state.apply_runtime_scenes();
        state.apply_runtime_routines();

        let response = DeviceConfigMutationResponse {
            deleted_device_key: source.device_key.clone(),
            replacement_device_key: None,
            updated_groups: rewrite.changed_groups.len(),
            updated_scenes: rewrite.changed_scenes.len(),
            updated_routines: rewrite.changed_routines.len(),
            display_override_changed: rewrite.display_override_changed,
            sensor_config_changed: rewrite.sensor_config_changed,
            position_changed: rewrite.position_changed,
        };

        (rewrite, response)
    };

    persist_device_config_rewrite(&rewrite, &source).await;
    if let Err(error) = db_delete_device(&source.to_device_key()).await {
        warn!(
            "Failed to delete device '{}' from database: {error}",
            source.device_key
        );
    }

    Ok(ApiResponse::success(response))
}

async fn list_device_sensor_configs(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().device_sensor_configs.clone(),
    ))
}

async fn upsert_device_sensor_config(
    device_ref: String,
    mut row: DeviceSensorConfigRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    row.device_ref = decode_path_key(device_ref);

    {
        let mut state = app_state.write().await;
        let device_exists = state
            .devices
            .get_state()
            .0
            .keys()
            .any(|device_key| device_key.to_string() == row.device_ref);

        if !device_exists {
            return Ok(error_response(
                "Unknown device key",
                StatusCode::BAD_REQUEST,
            ));
        }

        state.upsert_device_sensor_config(row.clone());
    }

    if let Err(e) = config_queries::db_upsert_device_sensor_config(&row).await {
        warn!("Failed to persist device sensor config: {e}");
    }

    Ok(ApiResponse::success(row))
}

async fn delete_device_sensor_config(
    device_ref: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let device_ref = decode_path_key(device_ref);
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_device_sensor_config(&device_ref)
    };

    if !deleted {
        return Ok(not_found("Device sensor config"));
    }

    if let Err(e) = config_queries::db_delete_device_sensor_config(&device_ref).await {
        warn!("Failed to persist device sensor config deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Integrations
// ============================================================================

fn integrations_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_integrations);

    let get = warp::path!("integrations" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_integration);

    let create = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_integration);

    let update = warp::path!("integrations" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_integration);

    let delete = warp::path!("integrations" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_integration);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_integrations(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().integrations.clone(),
    ))
}

async fn get_integration(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    match state
        .get_runtime_config()
        .integrations
        .iter()
        .find(|integration| integration.id == id)
        .cloned()
    {
        Some(integration) => Ok(ApiResponse::success(integration)),
        None => Ok(not_found("Integration")),
    }
}

async fn create_integration(
    integration: IntegrationRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    {
        let mut state = app_state.write().await;
        state.upsert_integration(integration.clone());
        if let Err(e) = state.apply_runtime_integrations().await {
            warn!("Failed to apply runtime integrations: {e}");
        }
    }

    if let Err(e) = config_queries::db_upsert_integration(&integration).await {
        warn!("Failed to persist integration config: {e}");
    }

    Ok(ApiResponse::created(integration))
}

async fn update_integration(
    id: String,
    mut integration: IntegrationRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    integration.id = id;

    {
        let mut state = app_state.write().await;
        state.upsert_integration(integration.clone());
        if let Err(e) = state.apply_runtime_integrations().await {
            warn!("Failed to apply runtime integrations: {e}");
        }
    }

    if let Err(e) = config_queries::db_upsert_integration(&integration).await {
        warn!("Failed to persist integration config update: {e}");
    }

    Ok(ApiResponse::success(integration))
}

async fn delete_integration(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        let deleted = state.delete_integration(&id);
        if deleted {
            if let Err(e) = state.apply_runtime_integrations().await {
                warn!("Failed to apply runtime integrations: {e}");
            }
        }
        deleted
    };

    if !deleted {
        return Ok(not_found("Integration"));
    }

    if let Err(e) = config_queries::db_delete_integration(&id).await {
        warn!("Failed to persist integration deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Groups
// ============================================================================

fn groups_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("groups")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_groups);

    let get = warp::path!("groups" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_group);

    let create = warp::path("groups")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_group);

    let update = warp::path!("groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_group);

    let delete = warp::path!("groups" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_group);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_groups(app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state
            .get_runtime_config()
            .groups
            .iter()
            .cloned()
            .map(|group| group_response_row(&state, group))
            .collect::<Vec<_>>(),
    ))
}

async fn get_group(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    match state
        .get_runtime_config()
        .groups
        .iter()
        .find(|group| group.id == id)
        .cloned()
    {
        Some(group) => Ok(ApiResponse::success(group_response_row(&state, group))),
        None => Ok(not_found("Group")),
    }
}

async fn create_group(
    group: GroupRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    {
        let mut state = app_state.write().await;
        state.upsert_group(group.clone());
        state.apply_runtime_groups();
    }

    if let Err(e) = config_queries::db_upsert_group(&group).await {
        warn!("Failed to persist group config: {e}");
    }

    Ok(ApiResponse::created(group))
}

async fn update_group(
    id: String,
    mut group: GroupRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    group.id = id;

    {
        let mut state = app_state.write().await;
        state.upsert_group(group.clone());
        state.apply_runtime_groups();
    }

    if let Err(e) = config_queries::db_upsert_group(&group).await {
        warn!("Failed to persist group config update: {e}");
    }

    Ok(ApiResponse::success(group))
}

async fn delete_group(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        let deleted = state.delete_group(&id);
        if deleted {
            state.apply_runtime_groups();
        }
        deleted
    };

    if !deleted {
        return Ok(not_found("Group"));
    }

    if let Err(e) = config_queries::db_delete_group(&id).await {
        warn!("Failed to persist group deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Scenes
// ============================================================================

fn scenes_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_scenes);

    let get = warp::path!("scenes" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_scene);

    let create = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_scene);

    let update = warp::path!("scenes" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_scene);

    let delete = warp::path!("scenes" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_scene);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_scenes(app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().scenes.clone(),
    ))
}

async fn get_scene(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    match state
        .get_runtime_config()
        .scenes
        .iter()
        .find(|scene| scene.id == id)
        .cloned()
    {
        Some(scene) => Ok(ApiResponse::success(scene)),
        None => Ok(not_found("Scene")),
    }
}

async fn create_scene(
    scene: SceneRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    {
        let mut state = app_state.write().await;
        state.upsert_scene(scene.clone());
        state.apply_runtime_scenes();
    }

    if let Err(e) = config_queries::db_upsert_config_scene(&scene).await {
        warn!("Failed to persist scene config: {e}");
    }

    Ok(ApiResponse::created(scene))
}

async fn update_scene(
    id: String,
    mut scene: SceneRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    scene.id = id;

    {
        let mut state = app_state.write().await;
        state.upsert_scene(scene.clone());
        state.apply_runtime_scenes();
    }

    if let Err(e) = config_queries::db_upsert_config_scene(&scene).await {
        warn!("Failed to persist scene config update: {e}");
    }

    Ok(ApiResponse::success(scene))
}

async fn delete_scene(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        let deleted = state.delete_scene(&id);
        if deleted {
            state.apply_runtime_scenes();
        }
        deleted
    };

    if !deleted {
        return Ok(not_found("Scene"));
    }

    if let Err(e) = config_queries::db_delete_config_scene(&id).await {
        warn!("Failed to persist scene deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Routines
// ============================================================================

fn routines_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("routines")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_routines);

    let get = warp::path!("routines" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_routine);

    let create = warp::path("routines")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_routine);

    let update = warp::path!("routines" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_routine);

    let delete = warp::path!("routines" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_routine);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_routines(app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().routines.clone(),
    ))
}

async fn get_routine(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    match state
        .get_runtime_config()
        .routines
        .iter()
        .find(|routine| routine.id == id)
        .cloned()
    {
        Some(routine) => Ok(ApiResponse::success(routine)),
        None => Ok(not_found("Routine")),
    }
}

async fn create_routine(
    routine: RoutineRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    {
        let mut state = app_state.write().await;
        state.upsert_routine(routine.clone());
        state.apply_runtime_routines();
    }

    if let Err(e) = config_queries::db_upsert_routine(&routine).await {
        warn!("Failed to persist routine config: {e}");
    }

    Ok(ApiResponse::created(routine))
}

async fn update_routine(
    id: String,
    mut routine: RoutineRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let requested_id = routine.id.trim().to_string();
    let next_id = if requested_id.is_empty() {
        id.clone()
    } else {
        requested_id
    };
    let renamed = next_id != id;

    let changed_routines = {
        let mut state = app_state.write().await;
        let Some(existing_index) = state
            .runtime_config
            .routines
            .iter()
            .position(|existing| existing.id == id)
        else {
            return Ok(not_found("Routine"));
        };

        if renamed
            && state
                .runtime_config
                .routines
                .iter()
                .any(|existing| existing.id == next_id)
        {
            return Ok(error_response(
                "Routine ID already exists.",
                StatusCode::BAD_REQUEST,
            ));
        }

        routine.id = next_id.clone();
        state.runtime_config.routines[existing_index] = routine.clone();

        let mut changed_routines = vec![routine.clone()];

        if renamed {
            for existing in &mut state.runtime_config.routines {
                if existing.id == next_id {
                    continue;
                }

                if rewrite_force_trigger_routine_references(&mut existing.actions, &id, &next_id) {
                    changed_routines.push(existing.clone());
                }
            }
        }

        state
            .runtime_config
            .routines
            .sort_by(|left, right| left.id.cmp(&right.id));
        state.apply_runtime_routines();

        changed_routines
    };

    for changed_routine in &changed_routines {
        if let Err(error) = config_queries::db_upsert_routine(changed_routine).await {
            warn!(
                "Failed to persist routine config update for '{}': {error}",
                changed_routine.id
            );
        }
    }

    if renamed {
        if let Err(error) = config_queries::db_delete_routine(&id).await {
            warn!("Failed to delete old routine config '{}': {error}", id);
        }
    }

    Ok(ApiResponse::success(routine))
}

async fn delete_routine(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        let deleted = state.delete_routine(&id);
        if deleted {
            state.apply_runtime_routines();
        }
        deleted
    };

    if !deleted {
        return Ok(not_found("Routine"));
    }

    if let Err(e) = config_queries::db_delete_routine(&id).await {
        warn!("Failed to persist routine deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Floorplan
// ============================================================================

fn floorplans_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("floorplans")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_floorplans);

    let create = warp::path("floorplans")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_floorplan);

    let update = warp::path!("floorplans" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_floorplan);

    let delete = warp::path!("floorplans" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_floorplan);

    list.or(create).or(update).or(delete)
}

async fn list_floorplans(app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(list_runtime_floorplans(
        state.get_runtime_config(),
    )))
}

async fn create_floorplan(
    floorplan: FloorplanMetadataRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let created = {
        let mut state = app_state.write().await;
        state.create_floorplan_metadata(floorplan.clone())
    };

    if !created {
        return Ok(error_response(
            "Floorplan already exists",
            StatusCode::CONFLICT,
        ));
    }

    if let Err(e) = config_queries::db_create_floorplan(&floorplan).await {
        warn!("Failed to persist floorplan creation: {e}");
    }

    Ok(ApiResponse::created(floorplan))
}

async fn update_floorplan(
    id: String,
    mut floorplan: FloorplanMetadataRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    floorplan.id = id;

    {
        let mut state = app_state.write().await;
        state.update_floorplan_metadata(floorplan.clone());
    }

    if let Err(e) = config_queries::db_update_floorplan_metadata(&floorplan).await {
        warn!("Failed to persist floorplan metadata update: {e}");
    }

    Ok(ApiResponse::success(floorplan))
}

async fn delete_floorplan(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_floorplan(&id)
    };

    if !deleted {
        return Ok(not_found("Floorplan"));
    }

    if let Err(e) = config_queries::db_delete_floorplan(&id).await {
        warn!("Failed to persist floorplan deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

fn floorplan_id_query() -> impl Filter<Extract = (String,), Error = std::convert::Infallible> + Clone
{
    warp::query::raw()
        .or(warp::any().map(String::new))
        .unify()
        .map(|raw: String| {
            raw.split('&')
                .find_map(|entry| {
                    entry
                        .split_once('=')
                        .filter(|(key, _)| *key == "id")
                        .map(|(_, value)| {
                            percent_decode_str(value).decode_utf8_lossy().into_owned()
                        })
                })
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| "default".to_string())
        })
}

fn floorplan_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(get_floorplan);

    let upload_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::bytes())
        .and(warp::header::optional::<String>("content-type"))
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(upload_floorplan);

    // Grid endpoints (JSON data for the floor grid)
    let get_grid = warp::path!("floorplan" / "grid")
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(get_floorplan_grid);

    let save_grid = warp::path!("floorplan" / "grid")
        .and(warp::post())
        .and(warp::body::json())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(save_floorplan_grid);

    // Separate image endpoints
    let get_image = warp::path!("floorplan" / "image")
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(get_floorplan_image);

    let head_image = warp::path!("floorplan" / "image")
        .and(warp::head())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(head_floorplan_image);

    let upload_image = warp::path!("floorplan" / "image")
        .and(warp::post())
        .and(warp::multipart::form().max_length(10 * 1024 * 1024))
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(upload_floorplan_image);

    let delete_image = warp::path!("floorplan" / "image")
        .and(warp::delete())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(delete_floorplan_image);

    let get_positions = warp::path!("floorplan" / "devices")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_device_positions);

    let upsert_position = warp::path!("floorplan" / "devices" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_position);

    let delete_position = warp::path!("floorplan" / "devices" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_position);

    let get_group_positions = warp::path!("floorplan" / "groups")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_group_positions);

    let upsert_group_position = warp::path!("floorplan" / "groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_group_position);

    let delete_group_position = warp::path!("floorplan" / "groups" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_group_position);

    get_floorplan
        .or(upload_floorplan)
        .or(get_grid)
        .or(save_grid)
        .or(get_image)
        .or(head_image)
        .or(upload_image)
        .or(delete_image)
        .or(get_positions)
        .or(upsert_position)
        .or(delete_position)
        .or(get_group_positions)
        .or(upsert_group_position)
        .or(delete_group_position)
}

async fn get_floorplan(
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    match get_runtime_floorplan(state.get_runtime_config(), &floorplan_id) {
        Some(floorplan) => Ok(ApiResponse::success(FloorplanRow {
            image_data: floorplan.image_data,
            image_mime_type: floorplan.image_mime_type,
            width: floorplan.width,
            height: floorplan.height,
        })),
        None => Ok(not_found("Floorplan")),
    }
}

async fn upload_floorplan(
    body: bytes::Bytes,
    content_type: Option<String>,
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    // TODO: Get width/height from image metadata
    let floorplan = FloorplanRow {
        image_data: Some(body.to_vec()),
        image_mime_type: content_type,
        width: None,
        height: None,
    };

    {
        let mut state = app_state.write().await;
        state.upsert_floorplan_content(&floorplan_id, floorplan.clone());
    }

    if let Err(e) = config_queries::db_upsert_floorplan_by_id(&floorplan_id, &floorplan).await {
        warn!("Failed to persist floorplan upload: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_device_positions(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().device_positions.clone(),
    ))
}

async fn upsert_device_position(
    device_key: String,
    mut pos: DevicePositionRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    pos.device_key = decode_path_key(device_key);

    {
        let mut state = app_state.write().await;
        state.upsert_device_position(pos.clone());
    }

    if let Err(e) = config_queries::db_upsert_device_position(&pos).await {
        warn!("Failed to persist device position: {e}");
    }

    Ok(ApiResponse::success(pos))
}

async fn delete_device_position(
    device_key: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let device_key = decode_path_key(device_key);
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_device_position(&device_key)
    };

    if !deleted {
        return Ok(not_found("Device position"));
    }

    if let Err(e) = config_queries::db_delete_device_position(&device_key).await {
        warn!("Failed to persist device position deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_group_positions(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().group_positions.clone(),
    ))
}

async fn upsert_group_position(
    group_id: String,
    mut pos: GroupPositionRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    pos.group_id = group_id;

    {
        let mut state = app_state.write().await;
        state.upsert_group_position(pos.clone());
    }

    if let Err(e) = config_queries::db_upsert_group_position(&pos).await {
        warn!("Failed to persist group position: {e}");
    }

    Ok(ApiResponse::success(pos))
}

async fn delete_group_position(
    group_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_group_position(&group_id)
    };

    if !deleted {
        return Ok(not_found("Group position"));
    }

    if let Err(e) = config_queries::db_delete_group_position(&group_id).await {
        warn!("Failed to persist group position deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_floorplan_grid(
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    match get_runtime_floorplan(state.get_runtime_config(), &floorplan_id) {
        Some(floorplan) => Ok(ApiResponse::success(floorplan.grid_data)),
        None => Ok(ApiResponse::success(Option::<String>::None)),
    }
}

#[derive(Deserialize)]
struct SaveGridRequest {
    grid: String,
}

async fn save_floorplan_grid(
    request: SaveGridRequest,
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    {
        let mut state = app_state.write().await;
        state.set_floorplan_grid(&floorplan_id, request.grid.clone());
    }

    if let Err(e) =
        config_queries::db_upsert_floorplan_grid_by_id(&floorplan_id, &request.grid).await
    {
        warn!("Failed to persist floorplan grid: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_floorplan_image(
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    let state = app_state.read().await;
    match get_runtime_floorplan(state.get_runtime_config(), &floorplan_id) {
        Some(floorplan) => {
            if let Some(image_data) = floorplan.image_data {
                let mime_type = floorplan
                    .image_mime_type
                    .unwrap_or_else(|| "image/png".to_string());
                Ok(Box::new(warp::reply::with_header(
                    image_data,
                    "Content-Type",
                    mime_type,
                )))
            } else {
                Ok(Box::new(not_found("Floorplan image")))
            }
        }
        None => Ok(Box::new(not_found("Floorplan image"))),
    }
}

async fn upload_floorplan_image(
    mut form: warp::multipart::FormData,
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    use futures::TryStreamExt;

    let mut image_data: Option<Vec<u8>> = None;
    let mut mime_type: Option<String> = None;

    while let Ok(Some(part)) = form.try_next().await {
        if part.name() == "image" {
            mime_type = part.content_type().map(|s| s.to_string());

            let mut data = Vec::new();
            let mut stream = part.stream();
            while let Ok(Some(chunk)) = stream.try_next().await {
                data.extend_from_slice(chunk.chunk());
            }

            image_data = Some(data);
        }
    }

    if let Some(data) = image_data {
        let floorplan = FloorplanRow {
            image_data: Some(data),
            image_mime_type: mime_type,
            width: None,
            height: None,
        };

        {
            let mut state = app_state.write().await;
            state.upsert_floorplan_content(&floorplan_id, floorplan.clone());
        }

        if let Err(e) = config_queries::db_upsert_floorplan_by_id(&floorplan_id, &floorplan).await {
            warn!("Failed to persist floorplan image upload: {e}");
        }

        Ok(ApiResponse::success(()))
    } else {
        Ok(error_response(
            "No image data found",
            StatusCode::BAD_REQUEST,
        ))
    }
}

async fn head_floorplan_image(
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    let state = app_state.read().await;
    match get_runtime_floorplan(state.get_runtime_config(), &floorplan_id) {
        Some(floorplan) => {
            if floorplan.image_data.is_some() {
                let mime_type = floorplan
                    .image_mime_type
                    .unwrap_or_else(|| "image/png".to_string());
                Ok(Box::new(warp::reply::with_header(
                    warp::reply(),
                    "Content-Type",
                    mime_type,
                )))
            } else {
                Ok(Box::new(not_found("Floorplan image")))
            }
        }
        None => Ok(Box::new(not_found("Floorplan image"))),
    }
}

async fn delete_floorplan_image(
    floorplan_id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        state.clear_floorplan_image(&floorplan_id)
    };

    if !deleted {
        return Ok(not_found("Floorplan image"));
    }

    if let Err(e) = config_queries::db_clear_floorplan_image(&floorplan_id).await {
        warn!("Failed to persist floorplan image deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Dashboard
// ============================================================================

fn dashboard_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_layouts = warp::path!("dashboard" / "layouts")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_dashboard_layouts);

    let upsert_layout = warp::path!("dashboard" / "layouts")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_dashboard_layout);

    let delete_layout = warp::path!("dashboard" / "layouts" / i32)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_dashboard_layout);

    let get_widgets = warp::path!("dashboard" / "layouts" / i32 / "widgets")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_dashboard_widgets);

    let upsert_widget = warp::path!("dashboard" / "widgets")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_dashboard_widget);

    let delete_widget = warp::path!("dashboard" / "widgets" / i32)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_dashboard_widget);

    get_layouts
        .or(upsert_layout)
        .or(delete_layout)
        .or(get_widgets)
        .or(upsert_widget)
        .or(delete_widget)
}

async fn get_dashboard_layouts(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state.get_runtime_config().dashboard_layouts.clone(),
    ))
}

async fn upsert_dashboard_layout(
    layout: DashboardLayoutRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let local_layout = {
        let mut state = app_state.write().await;
        state.upsert_dashboard_layout(layout.clone())
    };

    match config_queries::db_upsert_dashboard_layout(&layout).await {
        Ok(id) => Ok(ApiResponse::success(DashboardLayoutRow {
            id,
            name: local_layout.name,
            is_default: local_layout.is_default,
        })),
        Err(e) => {
            warn!("Failed to persist dashboard layout: {e}");
            Ok(ApiResponse::success(local_layout))
        }
    }
}

async fn delete_dashboard_layout(
    id: i32,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_dashboard_layout(id)
    };

    if !deleted {
        return Ok(not_found("Dashboard layout"));
    }

    if let Err(e) = config_queries::db_delete_dashboard_layout(id).await {
        warn!("Failed to persist dashboard layout deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_dashboard_widgets(
    layout_id: i32,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(
        state
            .get_runtime_config()
            .dashboard_widgets
            .iter()
            .filter(|widget| widget.layout_id == layout_id)
            .cloned()
            .collect::<Vec<_>>(),
    ))
}

async fn upsert_dashboard_widget(
    widget: DashboardWidgetRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let local_widget = {
        let mut state = app_state.write().await;
        state.upsert_dashboard_widget(widget.clone())
    };

    match config_queries::db_upsert_dashboard_widget(&widget).await {
        Ok(id) => Ok(ApiResponse::success(DashboardWidgetRow {
            id,
            ..local_widget
        })),
        Err(e) => {
            warn!("Failed to persist dashboard widget: {e}");
            Ok(ApiResponse::success(local_widget))
        }
    }
}

async fn delete_dashboard_widget(
    id: i32,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = {
        let mut state = app_state.write().await;
        state.delete_dashboard_widget(id)
    };

    if !deleted {
        return Ok(not_found("Dashboard widget"));
    }

    if let Err(e) = config_queries::db_delete_dashboard_widget(id).await {
        warn!("Failed to persist dashboard widget deletion: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// Export / Import
// ============================================================================

#[derive(Deserialize)]
struct ImportQuery {
    #[serde(default)]
    save_version: bool,
}

fn export_import_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let export = warp::path("export")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(export_config);

    let import = warp::path("import")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::query::<ImportQuery>())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(import_config);

    export.or(import)
}

async fn export_config(app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    let state = app_state.read().await;
    Ok(ApiResponse::success(state.get_runtime_config().clone()))
}

async fn import_config(
    query: ImportQuery,
    config: ConfigExport,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    // Optionally save version before import
    if query.save_version {
        if let Err(e) = config_queries::db_save_config_version(&config, Some("Before import")).await
        {
            warn!("Failed to save config version before import: {e}");
        }
    }

    {
        let mut state = app_state.write().await;
        state.runtime_config = config.clone();
        if let Err(e) = state.apply_runtime_config().await {
            warn!("Failed to apply imported config to runtime state: {e}");
        }
    }

    if let Err(e) = config_queries::db_import_config(&config).await {
        warn!("Failed to persist imported config: {e}");
    }

    Ok(ApiResponse::success(()))
}

// ============================================================================
// TOML Migration
// ============================================================================

/// Intermediate types for TOML parsing that mirror the Config structure

#[derive(Deserialize)]
struct TomlConfig {
    core: Option<TomlCoreConfig>,
    integrations: Option<HashMap<String, toml::Value>>,
    groups: Option<HashMap<String, TomlGroupConfig>>,
    scenes: Option<HashMap<String, TomlSceneConfig>>,
    routines: Option<HashMap<String, TomlRoutineConfig>>,
}

#[derive(Deserialize)]
struct TomlCoreConfig {
    warmup_time_seconds: Option<u64>,
}

#[derive(Deserialize)]
struct TomlGroupConfig {
    name: String,
    #[serde(default)]
    hidden: Option<bool>,
    devices: Option<Vec<TomlGroupDevice>>,
    groups: Option<Vec<TomlGroupLink>>,
}

#[derive(Deserialize)]
struct TomlGroupDevice {
    integration_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
}

#[derive(Deserialize)]
struct TomlGroupLink {
    group_id: String,
}

#[derive(Deserialize)]
struct TomlSceneConfig {
    name: String,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default)]
    devices: Option<HashMap<String, HashMap<String, serde_json::Value>>>,
    #[serde(default)]
    groups: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    expr: Option<String>,
}

#[derive(Deserialize)]
struct TomlRoutineConfig {
    name: String,
    #[serde(default)]
    rules: Option<serde_json::Value>,
    #[serde(default)]
    actions: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct MigratePreviewResult {
    integrations: Vec<IntegrationRow>,
    groups: Vec<GroupRow>,
    scenes: Vec<SceneRow>,
    routines: Vec<RoutineRow>,
    core: CoreConfigRow,
}

impl MigratePreviewResult {
    pub fn to_config_export(&self) -> ConfigExport {
        ConfigExport {
            version: 1,
            core: self.core.clone(),
            integrations: self.integrations.clone(),
            groups: self.groups.clone(),
            scenes: self.scenes.clone(),
            routines: self.routines.clone(),
            floorplan: None,
            floorplans: Vec::new(),
            device_positions: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_sensor_configs: Vec::new(),
            dashboard_layouts: Vec::new(),
            dashboard_widgets: Vec::new(),
        }
    }
}

#[derive(Serialize)]
struct MigratePreviewData {
    preview: MigratePreviewResult,
    validation_errors: Vec<String>,
}

struct CanonicalizedMigrationPreview {
    preview: MigratePreviewResult,
    validation_errors: Vec<String>,
}

pub enum ParsedConfigBackup {
    JsonExport(ConfigExport),
}

impl ParsedConfigBackup {
    pub fn format_name(&self) -> &'static str {
        "json"
    }

    pub fn to_config_export(&self) -> ConfigExport {
        match self {
            Self::JsonExport(config) => config.clone(),
        }
    }
}

#[derive(Serialize)]
struct MigrateApplyResult {
    core: bool,
    integrations: usize,
    groups: usize,
    scenes: usize,
    routines: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
struct MigrationSelection {
    core: bool,
    integrations: bool,
    groups: bool,
    scenes: bool,
    routines: bool,
}

impl Default for MigrationSelection {
    fn default() -> Self {
        Self {
            core: true,
            integrations: true,
            groups: true,
            scenes: true,
            routines: true,
        }
    }
}

impl MigrationSelection {
    fn has_any(&self) -> bool {
        self.core || self.integrations || self.groups || self.scenes || self.routines
    }
}

#[derive(Deserialize)]
struct MigrateApplyRequestBody {
    preview: MigratePreviewResult,
    #[serde(default)]
    selection: MigrationSelection,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MigrateApplyRequest {
    Legacy(MigratePreviewResult),
    Selected(MigrateApplyRequestBody),
}

impl MigrateApplyRequest {
    fn into_parts(self) -> (MigratePreviewResult, MigrationSelection) {
        match self {
            Self::Legacy(preview) => (preview, MigrationSelection::default()),
            Self::Selected(body) => (body.preview, body.selection),
        }
    }
}

fn migrate_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let preview = warp::path!("migrate" / "preview")
        .and(warp::post())
        .and(warp::query::<MigrationSelection>())
        .and(warp::body::bytes())
        .and(with_state(app_state))
        .and_then(migrate_preview);

    let apply = warp::path!("migrate" / "apply")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(migrate_apply);

    preview.or(apply)
}

fn select_migration_preview(
    mut preview: MigratePreviewResult,
    selection: &MigrationSelection,
) -> MigratePreviewResult {
    if !selection.integrations {
        preview.integrations.clear();
    }
    if !selection.groups {
        preview.groups.clear();
    }
    if !selection.scenes {
        preview.scenes.clear();
    }
    if !selection.routines {
        preview.routines.clear();
    }

    preview
}

fn merge_config_rows<T>(existing: &mut Vec<T>, incoming: &[T], key: impl Fn(&T) -> &str)
where
    T: Clone,
{
    let mut merged = BTreeMap::new();

    for row in existing.iter().cloned() {
        merged.insert(key(&row).to_string(), row);
    }

    for row in incoming {
        merged.insert(key(row).to_string(), row.clone());
    }

    *existing = merged.into_values().collect();
}

fn merge_selected_migration_config(
    mut config: ConfigExport,
    preview: &MigratePreviewResult,
    selection: &MigrationSelection,
) -> ConfigExport {
    if selection.core {
        config.core = preview.core.clone();
    }
    if selection.integrations {
        merge_config_rows(&mut config.integrations, &preview.integrations, |row| {
            &row.id
        });
    }
    if selection.groups {
        merge_config_rows(&mut config.groups, &preview.groups, |row| &row.id);
    }
    if selection.scenes {
        merge_config_rows(&mut config.scenes, &preview.scenes, |row| &row.id);
    }
    if selection.routines {
        merge_config_rows(&mut config.routines, &preview.routines, |row| &row.id);
    }

    config
}

pub fn parse_toml_config(toml_str: &str) -> Result<MigratePreviewResult, String> {
    let config: TomlConfig =
        toml::from_str(toml_str).map_err(|e| format!("Failed to parse TOML: {e}"))?;

    // Convert core config
    let core = CoreConfigRow {
        warmup_time_seconds: config.core.and_then(|c| c.warmup_time_seconds).unwrap_or(1) as i32,
    };

    // Convert integrations
    let integrations: Vec<IntegrationRow> = config
        .integrations
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(id, value)| {
            let plugin = value.get("plugin")?.as_str()?.to_string();
            // Convert the remaining config (exclude "plugin") to JSON
            let mut config_map = value.as_table().cloned().unwrap_or_default();
            config_map.remove("plugin");
            let config_json = serde_json::to_value(&config_map)
                .unwrap_or(serde_json::Value::Object(Default::default()));
            Some(IntegrationRow {
                id,
                plugin,
                config: config_json,
                enabled: true,
            })
        })
        .collect();

    // Convert groups
    let groups: Vec<GroupRow> = config
        .groups
        .unwrap_or_default()
        .into_iter()
        .map(|(id, group)| {
            let devices: Vec<GroupDeviceRow> = group
                .devices
                .unwrap_or_default()
                .into_iter()
                .map(|d| GroupDeviceRow {
                    integration_id: d.integration_id,
                    device_id: d.device_id.or(d.name).unwrap_or_default(),
                })
                .collect();

            let linked_groups: Vec<String> = group
                .groups
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.group_id)
                .collect();

            GroupRow {
                id,
                name: group.name,
                hidden: group.hidden.unwrap_or(false),
                devices,
                linked_groups,
            }
        })
        .collect();

    // Convert scenes
    let scenes: Vec<SceneRow> = config
        .scenes
        .unwrap_or_default()
        .into_iter()
        .map(|(id, scene)| {
            // Convert device states: { integration_id: { device_name: config } }
            // → HashMap<"integration_id/device_name", config_json>
            let device_states: HashMap<String, serde_json::Value> = scene
                .devices
                .unwrap_or_default()
                .into_iter()
                .flat_map(|(integration_id, devices)| {
                    devices.into_iter().map(move |(device_name, config)| {
                        let key = format!("{integration_id}/{device_name}");
                        (key, config)
                    })
                })
                .collect();

            // Convert group states: { group_id: config }
            let group_states: HashMap<String, serde_json::Value> = scene.groups.unwrap_or_default();
            let example_device_key = device_states
                .keys()
                .next()
                .cloned()
                .unwrap_or_else(|| "integration/device".to_string());
            let example_device_key_json = serde_json::to_string(&example_device_key)
                .unwrap_or_else(|_| "\"integration/device\"".to_string());

            SceneRow {
                id,
                name: scene.name,
                hidden: scene.hidden.unwrap_or(false),
                script: scene.script.or_else(|| {
                    scene.expr.map(|expr| {
                        let expr = expr.replace('\n', "\n// ");
                        format!(
                            "// Legacy evalexpr scene expression copied from TOML and disabled.\n// Rewrite this as a JavaScript expression that evaluates to a scene override object.\n// Access live device bindings like devices[\"integration/device\"].data.Controllable.state.power.\n// Original expr:\n// {expr}\n\ndefineSceneScript(() => {{\n  const currentBrightness =\n    devices[{example_device_key_json}]?.data?.Controllable?.state?.brightness ?? 0.4;\n\n  /** @type {{SceneScriptResult}} */\n  const overrides = {{\n    {example_device_key_json}: deviceState({{\n      power: true,\n      brightness: Math.min(1, Math.max(0.1, currentBrightness)),\n    }}),\n  }};\n\n  return overrides;\n}})",
                        )
                    })
                }),
                device_states,
                group_states,
            }
        })
        .collect();

    // Convert routines
    let routines: Vec<RoutineRow> = config
        .routines
        .unwrap_or_default()
        .into_iter()
        .map(|(id, routine)| RoutineRow {
            id,
            name: routine.name,
            enabled: true,
            rules: routine.rules.unwrap_or(serde_json::Value::Array(vec![])),
            actions: routine.actions.unwrap_or(serde_json::Value::Array(vec![])),
        })
        .collect();

    Ok(MigratePreviewResult {
        integrations,
        groups,
        scenes,
        routines,
        core,
    })
}

pub fn parse_config_backup(config_str: &str) -> Result<ParsedConfigBackup, String> {
    serde_json::from_str::<ConfigExport>(config_str)
        .map(ParsedConfigBackup::JsonExport)
        .map_err(|json_error| format!("Failed to parse backup config as JSON export: {json_error}"))
}

struct CanonicalDeviceLookup {
    device_keys: HashSet<String>,
    device_ids_by_name: HashMap<(String, String), Vec<String>>,
}

impl CanonicalDeviceLookup {
    fn from_devices(devices: &DevicesState) -> Self {
        let mut device_keys = HashSet::new();
        let mut device_ids_by_name: HashMap<(String, String), Vec<String>> = HashMap::new();

        for device in devices.0.values() {
            let device_key = device.get_device_key().to_string();
            device_keys.insert(device_key);

            device_ids_by_name
                .entry((device.integration_id.to_string(), device.name.clone()))
                .or_default()
                .push(device.id.to_string());
        }

        for device_ids in device_ids_by_name.values_mut() {
            device_ids.sort();
            device_ids.dedup();
        }

        Self {
            device_keys,
            device_ids_by_name,
        }
    }

    fn resolve_device_key_component(
        &self,
        integration_id: &str,
        device_name_or_id: &str,
    ) -> Result<String, String> {
        let direct_key = format!("{integration_id}/{device_name_or_id}");
        if self.device_keys.contains(&direct_key) {
            return Ok(device_name_or_id.to_string());
        }

        self.resolve_device_name(integration_id, device_name_or_id)
    }

    fn resolve_device_name(
        &self,
        integration_id: &str,
        device_name: &str,
    ) -> Result<String, String> {
        let Some(matches) = self
            .device_ids_by_name
            .get(&(integration_id.to_string(), device_name.to_string()))
        else {
            return Err(format!(
                "could not resolve device name {integration_id}/{device_name} to a discovered device id"
            ));
        };

        if matches.len() != 1 {
            return Err(format!(
                "device name {integration_id}/{device_name} is ambiguous across ids: {}",
                matches.join(", "),
            ));
        }

        Ok(matches[0].clone())
    }
}

fn canonicalize_named_device_refs(
    value: &mut serde_json::Value,
    devices: &CanonicalDeviceLookup,
    path: &str,
    errors: &mut Vec<String>,
) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            let integration_id = map
                .get("integration_id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            let device_name = map
                .get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            let has_device_id = map.contains_key("device_id");

            if let (Some(integration_id), Some(device_name)) = (integration_id, device_name) {
                if !has_device_id {
                    match devices.resolve_device_name(&integration_id, &device_name) {
                        Ok(device_id) => {
                            map.remove("name");
                            map.insert(
                                "device_id".to_string(),
                                serde_json::Value::String(device_id),
                            );
                        }
                        Err(error) => {
                            push_unique_error(errors, format!("{path}: {error}"));
                            return false;
                        }
                    }
                }
            }

            let mut keys_to_remove = Vec::new();
            for (key, nested_value) in map.iter_mut() {
                if !canonicalize_named_device_refs(
                    nested_value,
                    devices,
                    &format!("{path}.{key}"),
                    errors,
                ) {
                    keys_to_remove.push(key.clone());
                }
            }

            for key in keys_to_remove {
                map.remove(&key);
            }

            true
        }
        serde_json::Value::Array(values) => {
            let mut retained_values = Vec::with_capacity(values.len());

            for (index, mut nested_value) in std::mem::take(values).into_iter().enumerate() {
                if canonicalize_named_device_refs(
                    &mut nested_value,
                    devices,
                    &format!("{path}[{index}]"),
                    errors,
                ) {
                    retained_values.push(nested_value);
                }
            }

            *values = retained_values;
            true
        }
        _ => true,
    }
}

fn canonicalize_migration_preview(
    mut preview: MigratePreviewResult,
    devices: &DevicesState,
) -> CanonicalizedMigrationPreview {
    let lookup = CanonicalDeviceLookup::from_devices(devices);
    let mut errors = Vec::new();

    for group in &mut preview.groups {
        let mut canonical_devices = Vec::with_capacity(group.devices.len());

        for mut device in std::mem::take(&mut group.devices) {
            if device.device_id.is_empty() {
                push_unique_error(
                    &mut errors,
                    format!(
                        "group '{}' contains a device reference without a device id",
                        group.id,
                    ),
                );
                continue;
            }

            match lookup.resolve_device_key_component(&device.integration_id, &device.device_id) {
                Ok(device_id) => {
                    device.device_id = device_id;
                    canonical_devices.push(device);
                }
                Err(error) => {
                    push_unique_error(
                        &mut errors,
                        format!(
                            "group '{}' device '{}': {error}",
                            group.id, device.device_id
                        ),
                    );
                }
            }
        }

        group.devices = canonical_devices;
    }

    for scene in &mut preview.scenes {
        let mut canonical_device_states = HashMap::new();

        for (device_key, mut config_value) in std::mem::take(&mut scene.device_states) {
            if !canonicalize_named_device_refs(
                &mut config_value,
                &lookup,
                &format!("scene '{}' device '{}'", scene.id, device_key),
                &mut errors,
            ) {
                continue;
            }

            let Some((integration_id, device_name_or_id)) = device_key.split_once('/') else {
                push_unique_error(
                    &mut errors,
                    format!(
                        "scene '{}' contains an invalid device key '{}'",
                        scene.id, device_key,
                    ),
                );
                continue;
            };

            let Some(device_id) = lookup
                .resolve_device_key_component(integration_id, device_name_or_id)
                .map_err(|error| {
                    push_unique_error(
                        &mut errors,
                        format!("scene '{}' device '{}': {error}", scene.id, device_key),
                    );
                    error
                })
                .ok()
            else {
                continue;
            };

            let canonical_key = format!("{integration_id}/{device_id}");
            if canonical_device_states
                .insert(canonical_key.clone(), config_value)
                .is_some()
            {
                push_unique_error(
                    &mut errors,
                    format!(
                        "scene '{}' resolves multiple device entries to '{}'",
                        scene.id, canonical_key,
                    ),
                );
            }
        }

        scene.device_states = canonical_device_states;

        let mut canonical_group_states = HashMap::new();

        for (group_id, mut config_value) in std::mem::take(&mut scene.group_states) {
            if canonicalize_named_device_refs(
                &mut config_value,
                &lookup,
                &format!("scene '{}' group '{}'", scene.id, group_id),
                &mut errors,
            ) {
                canonical_group_states.insert(group_id, config_value);
            }
        }

        scene.group_states = canonical_group_states;
    }

    for routine in &mut preview.routines {
        if !canonicalize_named_device_refs(
            &mut routine.rules,
            &lookup,
            &format!("routine '{}' rules", routine.id),
            &mut errors,
        ) {
            routine.rules = serde_json::Value::Array(vec![]);
        }

        if !canonicalize_named_device_refs(
            &mut routine.actions,
            &lookup,
            &format!("routine '{}' actions", routine.id),
            &mut errors,
        ) {
            routine.actions = serde_json::Value::Array(vec![]);
        }
    }

    CanonicalizedMigrationPreview {
        preview,
        validation_errors: errors,
    }
}

/// Apply a merged TOML migration config to the database.
pub async fn apply_migration(config: &ConfigExport) -> color_eyre::Result<()> {
    config_queries::db_import_config(config).await?;

    for device in derive_migrated_mqtt_sensor_devices(config) {
        db_update_device(&device).await?;
    }

    Ok(())
}

fn derive_migrated_mqtt_sensor_devices(config: &ConfigExport) -> Vec<Device> {
    let mqtt_integration_ids = config
        .integrations
        .iter()
        .filter(|integration| integration.plugin == "mqtt")
        .map(|integration| IntegrationId::from(integration.id.clone()))
        .collect::<HashSet<_>>();

    if mqtt_integration_ids.is_empty() {
        return Vec::new();
    }

    let mut discovered_devices = BTreeMap::new();

    for routine in &config.routines {
        let Ok(rules) = serde_json::from_value::<Rules>(routine.rules.clone()) else {
            warn!(
                "Failed to deserialize routine '{}' rules while deriving migrated MQTT sensors",
                routine.name,
            );
            continue;
        };

        collect_migrated_sensor_devices(&rules, &mqtt_integration_ids, &mut discovered_devices);
    }

    discovered_devices.into_values().collect()
}

fn collect_migrated_sensor_devices(
    rules: &Rules,
    mqtt_integration_ids: &HashSet<IntegrationId>,
    discovered_devices: &mut BTreeMap<String, Device>,
) {
    for rule in rules {
        match rule {
            crate::types::rule::Rule::Sensor(sensor_rule) => {
                let (integration_id, device_id, device_name) = match &sensor_rule.device_ref {
                    DeviceRef::Id(id_ref)
                        if mqtt_integration_ids.contains(&id_ref.integration_id) =>
                    {
                        (
                            id_ref.integration_id.clone(),
                            id_ref.device_id.clone(),
                            id_ref.device_id.to_string(),
                        )
                    }
                    _ => continue,
                };

                let device = Device {
                    id: device_id,
                    name: device_name,
                    integration_id,
                    data: DeviceData::Sensor(non_matching_sensor_state(&sensor_rule.state)),
                    raw: None,
                };

                discovered_devices
                    .entry(device.get_device_key().to_string())
                    .or_insert(device);
            }
            crate::types::rule::Rule::Any(any_rule) => {
                collect_migrated_sensor_devices(
                    &any_rule.any,
                    mqtt_integration_ids,
                    discovered_devices,
                );
            }
            _ => {}
        }
    }
}

fn non_matching_sensor_state(expected: &SensorDevice) -> SensorDevice {
    match expected {
        SensorDevice::Boolean { value } => SensorDevice::Boolean { value: !value },
        SensorDevice::Text { value } => SensorDevice::Text {
            value: if value.is_empty() {
                "__unknown__".to_string()
            } else {
                String::new()
            },
        },
        SensorDevice::Number { value } => SensorDevice::Number {
            value: if *value == 0.0 { 1.0 } else { 0.0 },
        },
        SensorDevice::Color(state) => SensorDevice::Color(ControllableState {
            power: !state.power,
            brightness: None,
            color: None,
            transition: None,
        }),
    }
}

async fn migrate_preview(
    selection: MigrationSelection,
    body: bytes::Bytes,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    if !selection.has_any() {
        return Ok(error_response(
            "Select at least one section to import.",
            StatusCode::BAD_REQUEST,
        ));
    }

    let toml_str = String::from_utf8_lossy(&body);

    match parse_toml_config(&toml_str) {
        Ok(result) => {
            let result = select_migration_preview(result, &selection);
            let state = app_state.read().await;
            let preview = canonicalize_migration_preview(result, state.devices.get_state());

            Ok(ApiResponse::success(MigratePreviewData {
                preview: preview.preview,
                validation_errors: preview.validation_errors,
            }))
        }
        Err(e) => Ok(error_response(&e, StatusCode::BAD_REQUEST)),
    }
}

async fn migrate_apply(
    request: MigrateApplyRequest,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let (preview, selection) = request.into_parts();
    if !selection.has_any() {
        return Ok(error_response(
            "Select at least one section to import.",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (preview, merged_config) = {
        let state = app_state.read().await;
        let preview = select_migration_preview(preview, &selection);

        let preview = canonicalize_migration_preview(preview, state.devices.get_state()).preview;

        (
            preview.clone(),
            merge_selected_migration_config(
                state.get_runtime_config().clone(),
                &preview,
                &selection,
            ),
        )
    };

    let counts = MigrateApplyResult {
        core: selection.core,
        integrations: preview.integrations.len(),
        groups: preview.groups.len(),
        scenes: preview.scenes.len(),
        routines: preview.routines.len(),
    };

    {
        let mut state = app_state.write().await;
        state.runtime_config = merged_config.clone();
        if let Err(e) = state.apply_runtime_config().await {
            warn!("Failed to apply migrated config to runtime state: {e}");
        }
    }

    if let Err(e) = apply_migration(&merged_config).await {
        warn!("Failed to persist migrated config: {e}");
    }

    Ok(ApiResponse::success(counts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::device::DeviceId;
    use ordered_float::OrderedFloat;

    #[test]
    fn parse_config_backup_accepts_json_export() {
        let json = serde_json::json!({
            "version": 1,
            "core": { "warmup_time_seconds": 42 },
            "integrations": [
                {
                    "id": "dummy",
                    "plugin": "dummy",
                    "config": { "devices": {} },
                    "enabled": true
                }
            ],
            "groups": [],
            "scenes": [],
            "routines": [],
            "floorplan": null,
            "floorplans": [],
            "device_positions": [],
            "device_display_overrides": [],
            "device_sensor_configs": [],
            "dashboard_layouts": [],
            "dashboard_widgets": []
        })
        .to_string();

        let parsed = parse_config_backup(&json).expect("json export should parse");

        assert!(matches!(parsed, ParsedConfigBackup::JsonExport(_)));

        let config = parsed.to_config_export();
        assert_eq!(config.core.warmup_time_seconds, 42);
        assert_eq!(config.integrations.len(), 1);
        assert_eq!(config.integrations[0].id, "dummy");
    }

    #[test]
    fn parse_config_backup_rejects_legacy_toml() {
        let toml = r#"
[core]
warmup_time_seconds = 7

[integrations.zigbee2mqtt]
plugin = "mqtt"
host = "mqtt.example.org"

[groups.kitchen]
name = "Kitchen"
devices = [
  { integration_id = "zigbee2mqtt", name = "Kitchen light" }
]
"#;

        let error = parse_config_backup(toml)
            .err()
            .expect("legacy toml should be rejected");

        assert!(error.contains("JSON export"));
    }

    fn migration_test_device(integration_id: &str, device_id: &str, name: &str) -> Device {
        Device {
            id: DeviceId::new(device_id),
            name: name.to_string(),
            integration_id: IntegrationId::from(integration_id.to_string()),
            data: DeviceData::Sensor(SensorDevice::Boolean { value: false }),
            raw: None,
        }
    }

    fn migration_test_devices(devices: Vec<Device>) -> DevicesState {
        let mut state = DevicesState(Default::default());

        for device in devices {
            state.0.insert(device.get_device_key(), device);
        }

        state
    }

    #[test]
    fn canonicalize_migration_preview_resolves_legacy_name_refs() {
        let preview = MigratePreviewResult {
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({}),
                enabled: true,
            }],
            groups: vec![GroupRow {
                id: "kitchen".to_string(),
                name: "Kitchen".to_string(),
                hidden: false,
                devices: vec![GroupDeviceRow {
                    integration_id: "zigbee2mqtt".to_string(),
                    device_id: "Kitchen light".to_string(),
                }],
                linked_groups: Vec::new(),
            }],
            scenes: vec![SceneRow {
                id: "evening".to_string(),
                name: "Evening".to_string(),
                hidden: false,
                script: None,
                device_states: HashMap::from([(
                    "zigbee2mqtt/Kitchen light".to_string(),
                    serde_json::json!({
                        "integration_id": "zigbee2mqtt",
                        "name": "Hall switch",
                        "brightness": 0.5
                    }),
                )]),
                group_states: HashMap::new(),
            }],
            routines: vec![RoutineRow {
                id: "motion".to_string(),
                name: "Motion".to_string(),
                enabled: true,
                rules: serde_json::json!([
                    {
                        "state": { "value": true },
                        "trigger_mode": "pulse",
                        "integration_id": "zigbee2mqtt",
                        "name": "Hall switch"
                    }
                ]),
                actions: serde_json::json!([]),
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
            },
        };

        let devices = migration_test_devices(vec![
            migration_test_device("zigbee2mqtt", "kitchen-light", "Kitchen light"),
            migration_test_device("zigbee2mqtt", "hall-switch", "Hall switch"),
        ]);

        let preview = canonicalize_migration_preview(preview, &devices);

        assert!(preview.validation_errors.is_empty());
        let preview = preview.preview;

        assert_eq!(preview.groups[0].devices[0].device_id, "kitchen-light");
        assert!(preview.scenes[0]
            .device_states
            .contains_key("zigbee2mqtt/kitchen-light"));
        assert_eq!(
            preview.scenes[0].device_states["zigbee2mqtt/kitchen-light"]["device_id"],
            serde_json::Value::String("hall-switch".to_string())
        );
        assert!(preview.scenes[0].device_states["zigbee2mqtt/kitchen-light"]
            .get("name")
            .is_none());
        assert_eq!(
            preview.routines[0].rules[0]["device_id"],
            serde_json::Value::String("hall-switch".to_string())
        );
        assert!(preview.routines[0].rules[0].get("name").is_none());
    }

    #[test]
    fn canonicalize_migration_preview_reports_all_name_resolution_errors() {
        let preview = MigratePreviewResult {
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({}),
                enabled: true,
            }],
            groups: vec![GroupRow {
                id: "kitchen".to_string(),
                name: "Kitchen".to_string(),
                hidden: false,
                devices: vec![GroupDeviceRow {
                    integration_id: "zigbee2mqtt".to_string(),
                    device_id: "Missing group light".to_string(),
                }],
                linked_groups: Vec::new(),
            }],
            scenes: vec![SceneRow {
                id: "evening".to_string(),
                name: "Evening".to_string(),
                hidden: false,
                script: None,
                device_states: HashMap::from([(
                    "zigbee2mqtt/Missing scene light".to_string(),
                    serde_json::json!({
                        "integration_id": "zigbee2mqtt",
                        "name": "Missing linked light",
                        "brightness": 0.5
                    }),
                )]),
                group_states: HashMap::new(),
            }],
            routines: vec![RoutineRow {
                id: "motion".to_string(),
                name: "Motion".to_string(),
                enabled: true,
                rules: serde_json::json!([
                    {
                        "state": { "value": true },
                        "trigger_mode": "pulse",
                        "integration_id": "zigbee2mqtt",
                        "name": "Missing routine sensor"
                    }
                ]),
                actions: serde_json::json!([]),
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
            },
        };

        let preview = canonicalize_migration_preview(preview, &migration_test_devices(Vec::new()));

        assert_eq!(preview.validation_errors.len(), 3);
        assert!(preview
            .validation_errors
            .iter()
            .any(|error| error.contains("group 'kitchen' device 'Missing group light'")));
        assert!(preview.validation_errors.iter().any(|error| error.contains("scene 'evening' device 'zigbee2mqtt/Missing scene light': could not resolve device name zigbee2mqtt/Missing linked light")));
        assert!(preview.validation_errors.iter().any(|error| error.contains("routine 'motion' rules[0]: could not resolve device name zigbee2mqtt/Missing routine sensor")));

        let preview = preview.preview;
        assert!(preview.groups[0].devices.is_empty());
        assert!(preview.scenes[0].device_states.is_empty());
        assert_eq!(preview.routines[0].rules, serde_json::Value::Array(vec![]));
    }

    #[test]
    fn integrations_only_preview_skips_unresolved_later_sections() {
        let preview = MigratePreviewResult {
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({}),
                enabled: true,
            }],
            groups: vec![GroupRow {
                id: "kitchen".to_string(),
                name: "Kitchen".to_string(),
                hidden: false,
                devices: vec![GroupDeviceRow {
                    integration_id: "zigbee2mqtt".to_string(),
                    device_id: "Missing group light".to_string(),
                }],
                linked_groups: Vec::new(),
            }],
            scenes: vec![SceneRow {
                id: "evening".to_string(),
                name: "Evening".to_string(),
                hidden: false,
                script: None,
                device_states: HashMap::from([(
                    "zigbee2mqtt/Missing scene light".to_string(),
                    serde_json::json!({
                        "integration_id": "zigbee2mqtt",
                        "name": "Missing linked light",
                        "brightness": 0.5
                    }),
                )]),
                group_states: HashMap::new(),
            }],
            routines: vec![RoutineRow {
                id: "motion".to_string(),
                name: "Motion".to_string(),
                enabled: true,
                rules: serde_json::json!([
                    {
                        "state": { "value": true },
                        "trigger_mode": "pulse",
                        "integration_id": "zigbee2mqtt",
                        "name": "Missing routine sensor"
                    }
                ]),
                actions: serde_json::json!([]),
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
            },
        };

        let selection = MigrationSelection {
            core: false,
            integrations: true,
            groups: false,
            scenes: false,
            routines: false,
        };

        let preview = canonicalize_migration_preview(
            select_migration_preview(preview, &selection),
            &migration_test_devices(Vec::new()),
        );

        assert!(preview.validation_errors.is_empty());
        let preview = preview.preview;

        assert_eq!(preview.integrations.len(), 1);
        assert!(preview.groups.is_empty());
        assert!(preview.scenes.is_empty());
        assert!(preview.routines.is_empty());
    }

    #[test]
    fn merge_selected_migration_config_preserves_unselected_sections() {
        let existing = ConfigExport {
            version: 1,
            core: CoreConfigRow {
                warmup_time_seconds: 5,
            },
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({ "host": "broker" }),
                enabled: true,
            }],
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            device_positions: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_sensor_configs: Vec::new(),
            dashboard_layouts: Vec::new(),
            dashboard_widgets: Vec::new(),
        };

        let preview = MigratePreviewResult {
            integrations: Vec::new(),
            groups: vec![GroupRow {
                id: "kitchen".to_string(),
                name: "Kitchen".to_string(),
                hidden: false,
                devices: vec![GroupDeviceRow {
                    integration_id: "zigbee2mqtt".to_string(),
                    device_id: "kitchen-light".to_string(),
                }],
                linked_groups: Vec::new(),
            }],
            scenes: Vec::new(),
            routines: Vec::new(),
            core: CoreConfigRow {
                warmup_time_seconds: 9,
            },
        };

        let merged = merge_selected_migration_config(
            existing,
            &preview,
            &MigrationSelection {
                core: false,
                integrations: false,
                groups: true,
                scenes: false,
                routines: false,
            },
        );

        assert_eq!(merged.core.warmup_time_seconds, 5);
        assert_eq!(merged.integrations.len(), 1);
        assert_eq!(merged.integrations[0].id, "zigbee2mqtt");
        assert_eq!(merged.groups.len(), 1);
        assert_eq!(merged.groups[0].id, "kitchen");
    }

    #[test]
    fn derive_migrated_mqtt_sensor_devices_skips_non_canonical_sensor_rules() {
        let preview = MigratePreviewResult {
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({}),
                enabled: true,
            }],
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: vec![RoutineRow {
                id: "entryway_motion".to_string(),
                name: "Entryway motion".to_string(),
                enabled: true,
                rules: serde_json::json!([
                    {
                        "state": { "value": true },
                        "trigger_mode": "pulse",
                        "integration_id": "zigbee2mqtt",
                        "name": "Entryway motion sensor"
                    }
                ]),
                actions: serde_json::json!([]),
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
            },
        };

        let devices = derive_migrated_mqtt_sensor_devices(&preview.to_config_export());

        assert!(devices.is_empty());
    }

    #[test]
    fn derive_migrated_mqtt_sensor_devices_seeds_id_based_sensor_rules() {
        let preview = MigratePreviewResult {
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({}),
                enabled: true,
            }],
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: vec![RoutineRow {
                id: "entryway_motion".to_string(),
                name: "Entryway motion".to_string(),
                enabled: true,
                rules: serde_json::json!([
                    {
                        "state": { "value": true },
                        "trigger_mode": "pulse",
                        "integration_id": "zigbee2mqtt",
                        "device_id": "0x0017880109159dc5"
                    }
                ]),
                actions: serde_json::json!([]),
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
            },
        };

        let devices = derive_migrated_mqtt_sensor_devices(&preview.to_config_export());

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, DeviceId::new("0x0017880109159dc5"));
        assert_eq!(devices[0].name, "0x0017880109159dc5");
        assert_eq!(
            devices[0].data,
            DeviceData::Sensor(SensorDevice::Boolean { value: false })
        );
    }

    #[test]
    fn non_matching_sensor_state_avoids_matching_number_text_and_color_rules() {
        assert_eq!(
            non_matching_sensor_state(&SensorDevice::Text {
                value: "on_press".to_string(),
            }),
            SensorDevice::Text {
                value: String::new(),
            }
        );

        assert_eq!(
            non_matching_sensor_state(&SensorDevice::Number { value: 0.0 }),
            SensorDevice::Number { value: 1.0 }
        );

        assert_eq!(
            non_matching_sensor_state(&SensorDevice::Color(ControllableState {
                power: true,
                brightness: Some(OrderedFloat(0.5)),
                color: None,
                transition: None,
            })),
            SensorDevice::Color(ControllableState {
                power: false,
                brightness: None,
                color: None,
                transition: None,
            })
        );
    }
}
