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

use crate::core::automation::{self, ConfigCatalog};
use crate::core::snapshot::SnapshotChanges;
use crate::core::state::{PendingWsUpdate, StateHandle};
use crate::core::{
    integrations::integration_config_schemas, logs::recent_logs,
    routine_history::recent_routine_history,
};
use crate::db::{
    self,
    actions::db_update_device,
    config_queries::{
        self, ConfigExport, CoreConfigRow, DashboardLayoutRow, DashboardWidgetRow,
        DeviceConfigRewritePersistence, DeviceDisplayNameRow, DeviceSensorConfigRow,
        FloorplanExportRow, FloorplanMetadataRow, FloorplanRow, GroupDeviceRow, GroupPositionRow,
        GroupRow, IntegrationRow, RoutineRow, SceneRow,
    },
};
use crate::types::{
    action::{Action, Actions},
    automation_definition::{HelperId, RoutineSemantics},
    automation_value::HelperDefinition,
    device::{
        ControllableState, Device, DeviceData, DeviceKey, DeviceRef, DevicesState, SensorDevice,
    },
    integration::IntegrationId,
    rule::{AnyRule, Rule, Rules},
    scene::{
        ActivateSceneActionDescriptor, ActivateSceneDescriptor, CycleScenesDescriptor,
        RolloutStyle, SceneDeviceConfig, SceneDevicesConfig, SceneOverridesConfig,
    },
};
use bytes::Buf;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use warp::{http::StatusCode, Filter, Reply};

use crate::core::snapshot::SnapshotHandle;

use super::{
    widgets::{
        widget_setting_string_or_env, API_URL_FIELD, CALENDAR_SETTING_KEY, ICS_URL_FIELD,
        INFLUXDB_SETTING_KEY, SENSOR_CATALOG_SETTING_KEY, TOKEN_FIELD, TRAIN_SCHEDULE_SETTING_KEY,
        URL_FIELD, WEATHER_SETTING_KEY,
    },
    with_handle, with_snapshot,
};

// ============================================================================
// Response Types
// ============================================================================

#[derive(Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    write: Option<crate::types::config_write::ConfigWriteStatus>,
}

#[derive(Serialize)]
struct RuntimeStatusResponse {
    persistence_available: bool,
    memory_only_mode: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct CoreConfigPayload {
    warmup_time_seconds: i32,
    #[serde(default)]
    default_transition_ms: Option<u64>,
    #[serde(default)]
    scene_transition_ms: Option<u64>,
    #[serde(default)]
    weather_api_url: String,
    #[serde(default)]
    train_api_url: String,
    #[serde(default)]
    influx_url: String,
}

/// Omitted fields preserve stored values and environment fallbacks.
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct CoreConfigPatch {
    warmup_time_seconds: Option<i32>,
    default_transition_ms: Option<Option<u64>>,
    scene_transition_ms: Option<Option<u64>>,
    weather_api_url: Option<String>,
    train_api_url: Option<String>,
    influx_url: Option<String>,
    influx_token: Option<String>,
    calendar_ics_url: Option<String>,
}

impl CoreConfigPatch {
    fn resolve(
        self,
        current: &ConfigExport,
    ) -> Result<(CoreConfigRow, Vec<config_queries::WidgetSettingRow>), String> {
        let warmup_time_seconds = self
            .warmup_time_seconds
            .unwrap_or(current.core.warmup_time_seconds);
        if warmup_time_seconds < 0 {
            return Err("Warmup time cannot be negative".into());
        }
        let default_transition_ms = self
            .default_transition_ms
            .unwrap_or(current.core.default_transition_ms);
        if default_transition_ms.is_some_and(|value| value > 65_535_000) {
            return Err("Default transition must be between 0 and 65,535,000 milliseconds".into());
        }
        let scene_transition_ms = self
            .scene_transition_ms
            .unwrap_or(current.core.scene_transition_ms);
        if scene_transition_ms.is_some_and(|value| value > 65_535_000) {
            return Err("Scene transition must be between 0 and 65,535,000 milliseconds".into());
        }
        let mut updates = BTreeMap::<String, config_queries::WidgetSettingRow>::new();
        for (key, field, value) in [
            (WEATHER_SETTING_KEY, API_URL_FIELD, self.weather_api_url),
            (
                TRAIN_SCHEDULE_SETTING_KEY,
                API_URL_FIELD,
                self.train_api_url,
            ),
            (INFLUXDB_SETTING_KEY, URL_FIELD, self.influx_url),
            (INFLUXDB_SETTING_KEY, TOKEN_FIELD, self.influx_token),
            (CALENDAR_SETTING_KEY, ICS_URL_FIELD, self.calendar_ics_url),
        ] {
            if let Some(value) = value {
                let setting = updates.entry(key.into()).or_insert_with(|| {
                    current
                        .widget_settings
                        .iter()
                        .find(|row| row.key == key)
                        .cloned()
                        .unwrap_or(config_queries::WidgetSettingRow {
                            key: key.into(),
                            config: serde_json::json!({}),
                        })
                });
                if !setting.config.is_object() {
                    return Err(format!("Stored settings for {key} must be an object"));
                }
                setting.config[field] = serde_json::Value::String(value);
            }
        }
        Ok((
            CoreConfigRow {
                warmup_time_seconds,
                default_transition_ms,
                scene_transition_ms,
            },
            updates.into_values().collect(),
        ))
    }
}

impl CoreConfigPayload {
    fn from_runtime(config: &ConfigExport) -> Self {
        let settings = &config.widget_settings;

        Self {
            warmup_time_seconds: config.core.warmup_time_seconds,
            default_transition_ms: config.core.default_transition_ms,
            scene_transition_ms: config.core.scene_transition_ms,
            weather_api_url: widget_setting_string_or_env(
                settings,
                WEATHER_SETTING_KEY,
                API_URL_FIELD,
                "WEATHER_API_URL",
            )
            .unwrap_or_default(),
            train_api_url: widget_setting_string_or_env(
                settings,
                TRAIN_SCHEDULE_SETTING_KEY,
                API_URL_FIELD,
                "TRAIN_API_URL",
            )
            .unwrap_or_default(),
            influx_url: widget_setting_string_or_env(
                settings,
                INFLUXDB_SETTING_KEY,
                URL_FIELD,
                "INFLUX_URL",
            )
            .unwrap_or_default(),
        }
    }
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
                write: None,
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
                write: None,
            }),
            StatusCode::CREATED,
        )
    }
}

/// Serialize configuration writes through persistence without blocking the state actor.
async fn config_write_lock(
    handle: &StateHandle,
) -> color_eyre::Result<tokio::sync::OwnedMutexGuard<()>> {
    let lock = handle
        .mutate(|state| Box::pin(async move { state.runtime_apply_lock.clone() }))
        .await?;
    Ok(lock.lock_owned().await)
}

fn actor_unavailable() -> warp::reply::WithStatus<warp::reply::Json> {
    error_response(
        "State actor unavailable; configuration was not applied",
        StatusCode::SERVICE_UNAVAILABLE,
    )
}

fn config_write_response<T: Serialize, P>(
    data: T,
    result: color_eyre::Result<P>,
    database_available: bool,
    status: StatusCode,
) -> warp::reply::WithStatus<warp::reply::Json> {
    use crate::types::config_write::{ConfigWriteStatus, PersistenceStatus};
    let (persistence, warning) = match result {
        Ok(_) => (PersistenceStatus::Persisted, None),
        Err(error) => {
            warn!("Configuration applied in memory but persistence failed: {error:#}");
            if database_available {
                (PersistenceStatus::Failed, Some("Applied to the running home, but saving to the database failed. Retry saving or export a backup before restarting.".to_string()))
            } else {
                (PersistenceStatus::MemoryOnly, Some("Applied in memory only. Export a backup before restarting to keep this change.".to_string()))
            }
        }
    };
    warp::reply::with_status(
        warp::reply::json(&ApiResponse {
            success: true,
            data: Some(data),
            error: None,
            write: Some(ConfigWriteStatus {
                applied: true,
                persistence,
                warning,
            }),
        }),
        status,
    )
}

async fn apply_runtime_integrations_change<F>(
    handle: &StateHandle,
    _guard: &tokio::sync::OwnedMutexGuard<()>,
    mutate_config: F,
) -> color_eyre::Result<bool>
where
    F: FnOnce(&mut ConfigExport) -> bool,
{
    // Read after acquiring the write lock. Never prepare from an old snapshot
    // while another integration change is still in flight.
    let (mut runtime_config, mut integrations) = handle
        .mutate(|state| {
            Box::pin(async move {
                (
                    state.get_runtime_config().clone(),
                    state.integrations.clone(),
                )
            })
        })
        .await?;
    if !mutate_config(&mut runtime_config) {
        return Ok(false);
    }
    let removed_ids = integrations
        .reload_config_rows(&runtime_config.integrations)
        .await?;
    handle
        .mutate(move |state| {
            Box::pin(async move {
                state.commit_runtime_integrations_update(runtime_config, integrations, removed_ids);
            })
        })
        .await?;
    Ok(true)
}

async fn apply_runtime_config_snapshot(
    handle: &StateHandle,
    runtime_config: ConfigExport,
    _guard: &tokio::sync::OwnedMutexGuard<()>,
) -> color_eyre::Result<()> {
    runtime_config
        .validate_calibration_profiles()
        .map_err(|error| eyre::eyre!(error))?;
    for row in &runtime_config.device_color_calibrations {
        row.validate().map_err(|error| eyre::eyre!(error))?;
    }
    validate_imported_routines(handle, &runtime_config).await?;
    let mut integrations = handle
        .mutate(|state| Box::pin(async move { state.integrations.clone() }))
        .await?;

    let removed_ids = integrations
        .reload_config_rows(&runtime_config.integrations)
        .await?;

    handle
        .mutate(move |state| {
            Box::pin(async move {
                state.commit_runtime_config_update(runtime_config, integrations, removed_ids);
            })
        })
        .await?;
    Ok(())
}

/// Validate imported routine rows before they are committed.
///
/// Unknown semantics versions always fail visibly. Enabled v2 rows must
/// compile; disabled invalid drafts are accepted and stay stored (V04).
/// Legacy v1 import keeps its historical behavior (quarantine at load).
async fn validate_imported_routines(
    handle: &StateHandle,
    runtime_config: &ConfigExport,
) -> color_eyre::Result<()> {
    let device_keys = handle
        .mutate(|state| {
            Box::pin(async move {
                state
                    .devices
                    .get_state()
                    .0
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>()
            })
        })
        .await?;
    let catalog = ConfigCatalog::new(device_keys, runtime_config);

    for row in &runtime_config.routines {
        match automation::row_semantics(row) {
            RoutineSemantics::V1 => {}
            RoutineSemantics::V2 => {
                if row.enabled {
                    if let Err(report) = automation::compile_row(row, &catalog) {
                        return Err(eyre::eyre!(
                            "Routine '{}' is enabled but invalid: {}",
                            row.id,
                            report.summary()
                        ));
                    }
                } else if row.definition_v2.is_none() {
                    return Err(eyre::eyre!(
                        "Routine '{}' declares semantics_version 2 without a definition_v2 body",
                        row.id
                    ));
                }
            }
            RoutineSemantics::Unknown(version) => {
                return Err(eyre::eyre!(
                    "Routine '{}' uses unsupported semantics version {}; refusing to import it as v1",
                    row.id,
                    version
                ));
            }
        }
    }

    Ok(())
}

fn error_response(msg: &str, status: StatusCode) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(&ApiResponse::<()> {
            success: false,
            data: None,
            error: Some(msg.to_string()),
            write: None,
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
    changed_integrations: Vec<IntegrationRow>,
    changed_groups: Vec<GroupRow>,
    changed_scenes: Vec<SceneRow>,
    changed_routines: Vec<RoutineRow>,
    changed_scene_overrides: Vec<(String, SceneDevicesConfig)>,
    changed_floorplans: Vec<ChangedFloorplan>,
    changed_dashboard_widgets: Vec<DashboardWidgetRow>,
    changed_calibration_profiles: Vec<crate::core::color_calibration::ColorCalibrationProfile>,
    moved_display_override: Option<DeviceDisplayNameRow>,
    moved_sensor_config: Option<DeviceSensorConfigRow>,
    moved_color_calibration: Option<crate::core::color_calibration::DeviceColorCalibration>,
    moved_calibration_assignment:
        Option<crate::core::color_calibration::ColorCalibrationAssignment>,
    display_override_changed: bool,
    color_calibration_changed: bool,
    sensor_config_changed: bool,
    position_changed: bool,
}

#[derive(Clone, Debug)]
struct ChangedFloorplan {
    sort_order: i32,
    floorplan: FloorplanExportRow,
}

#[derive(Deserialize)]
struct ReplaceDeviceRequest {
    replacement_device_key: String,
}

#[derive(Deserialize)]
struct ReplaceDeviceByKeyRequest {
    source_device_key: String,
    replacement_device_key: String,
}

#[derive(Serialize)]
struct DeviceConfigMutationResponse {
    deleted_device_key: String,
    replacement_device_key: Option<String>,
    updated_integrations: usize,
    updated_groups: usize,
    updated_scenes: usize,
    updated_routines: usize,
    updated_scene_overrides: usize,
    updated_dashboard_widgets: usize,
    updated_calibration_profiles: usize,
    display_override_changed: bool,
    color_calibration_changed: bool,
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

fn validate_spatial_rollout(
    action_name: &str,
    rollout: &Option<RolloutStyle>,
    rollout_source_device_key: &Option<DeviceKey>,
    rollout_duration_ms: &Option<u64>,
) -> Result<(), String> {
    if !matches!(rollout, Some(RolloutStyle::Spatial)) {
        return Ok(());
    }

    let missing_source_device = rollout_source_device_key.is_none();
    let invalid_duration = rollout_duration_ms.unwrap_or_default() == 0;

    match (missing_source_device, invalid_duration) {
        (false, false) => Ok(()),
        (true, true) => Err(format!(
            "Spatial rollout on {action_name} requires rollout_source_device_key and rollout_duration_ms > 0.",
        )),
        (true, false) => Err(format!(
            "Spatial rollout on {action_name} requires rollout_source_device_key.",
        )),
        (false, true) => Err(format!(
            "Spatial rollout on {action_name} requires rollout_duration_ms > 0.",
        )),
    }
}

pub(crate) fn validate_action_rollout(action: &Action) -> Result<(), String> {
    match action {
        Action::ActivateScene(ActivateSceneActionDescriptor {
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
            ..
        }) => validate_spatial_rollout(
            "ActivateScene",
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        ),
        Action::CycleScenes(CycleScenesDescriptor {
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
            ..
        }) => validate_spatial_rollout(
            "CycleScenes",
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        ),
        _ => Ok(()),
    }
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

/// Rewrite exact device-key values in otherwise schemaless configuration.
///
/// Dashboard widget configuration is intentionally extensible, so it cannot
/// be decoded into a Rust type here. Exact string values are safe to migrate;
/// free-form text is left untouched and remains the responsibility of the
/// widget or integration that owns it.
fn rewrite_json_device_references(
    value: &mut serde_json::Value,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> bool {
    match value {
        serde_json::Value::String(existing) if existing == &source.device_key => {
            if let Some(replacement) = replacement {
                *existing = replacement.device_key.clone();
            } else {
                *value = serde_json::Value::Null;
            }
            true
        }
        serde_json::Value::Array(values) => {
            let mut changed = false;
            let mut next_values = Vec::with_capacity(values.len());
            let mut seen_device_keys = HashSet::new();

            for mut nested_value in std::mem::take(values) {
                if let serde_json::Value::String(existing) = &nested_value {
                    if existing == &source.device_key {
                        changed = true;
                        if let Some(replacement) = replacement {
                            if seen_device_keys.insert(replacement.device_key.clone()) {
                                next_values.push(serde_json::Value::String(
                                    replacement.device_key.clone(),
                                ));
                            }
                        }
                        continue;
                    }

                    if replacement.is_some_and(|replacement| existing == &replacement.device_key)
                        && !seen_device_keys.insert(existing.clone())
                    {
                        changed = true;
                        continue;
                    }
                    if replacement.is_some_and(|replacement| existing == &replacement.device_key) {
                        seen_device_keys.insert(existing.clone());
                    }

                    next_values.push(nested_value);
                    continue;
                }

                if rewrite_json_device_references(&mut nested_value, source, replacement) {
                    changed = true;
                }
                next_values.push(nested_value);
            }

            *values = next_values;
            changed
        }
        serde_json::Value::Object(map) => {
            let mut changed = false;
            let mut next_map = serde_json::Map::with_capacity(map.len());

            for (key, mut nested_value) in std::mem::take(map) {
                let next_key = if key == source.device_key {
                    changed = true;
                    replacement.map(|replacement| replacement.device_key.clone())
                } else {
                    Some(key)
                };

                if rewrite_json_device_references(&mut nested_value, source, replacement) {
                    changed = true;
                }

                let Some(next_key) = next_key else {
                    continue;
                };

                if next_map.contains_key(&next_key) {
                    changed = true;
                    continue;
                }

                next_map.insert(next_key, nested_value);
            }

            *map = next_map;
            changed
        }
        _ => false,
    }
}

fn rewrite_embedded_device_state_source(
    device: &mut Device,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> RewriteStatus {
    let DeviceData::Controllable(data) = &mut device.data else {
        return RewriteStatus::Unchanged;
    };

    let Some(state_source) = data.state_source.as_mut() else {
        return RewriteStatus::Unchanged;
    };

    rewrite_device_key_option(&mut state_source.linked_device_key, source, replacement)
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
        Rule::Raw(raw_rule) => rewrite_device_ref(&mut raw_rule.device_ref, source, replacement),
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
            let _ = rewrite_embedded_device_state_source(device, source, replacement);
            RewriteStatus::Changed
        }
        Action::ToggleDeviceOverride { device_keys, .. } => {
            rewrite_required_device_keys(device_keys, source, replacement)
        }
        Action::RandomizeColor(descriptor) => {
            rewrite_required_device_keys(&mut descriptor.device_keys, source, replacement)
        }
        Action::Custom(descriptor) => {
            let payload = descriptor.payload.to_string();
            let Some(replacement) = replacement else {
                return if payload.contains(&source.device_key) {
                    RewriteStatus::Remove
                } else {
                    RewriteStatus::Unchanged
                };
            };

            let next_payload = payload.replace(&source.device_key, &replacement.device_key);
            if next_payload == payload {
                RewriteStatus::Unchanged
            } else {
                descriptor.payload = next_payload.into();
                RewriteStatus::Changed
            }
        }
        Action::ForceTriggerRoutine(_) | Action::Ui(_) | Action::EvalExpr(_) => {
            RewriteStatus::Unchanged
        }
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

fn rewrite_scene_override_refs(
    overrides: &mut SceneOverridesConfig,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> Vec<(String, SceneDevicesConfig)> {
    let mut changed_overrides = Vec::new();

    for (scene_id, scene_overrides) in overrides.iter_mut() {
        let mut changed = false;
        let mut next_overrides = HashMap::with_capacity(scene_overrides.len());

        for (device_key, mut config_value) in std::mem::take(scene_overrides) {
            let next_device_key = if device_key.to_string() == source.device_key {
                changed = true;
                replacement.map(DeviceConfigTarget::to_device_key)
            } else {
                Some(device_key)
            };

            match rewrite_scene_device_config(&mut config_value, source, replacement) {
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

            next_overrides
                .entry(next_device_key)
                .or_insert(config_value);
        }

        *scene_overrides = next_overrides;
        if changed {
            changed_overrides.push((scene_id.to_string(), scene_overrides.clone()));
        }
    }

    changed_overrides
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
    source_name: Option<&str>,
) -> DeviceConfigRewriteResult {
    let mut result = DeviceConfigRewriteResult::default();

    // Retire the source at its integration boundary as well as removing it
    // from the runtime device map. Otherwise a discovery event from a still
    // enabled integration could immediately recreate the deleted device.
    if let Some(integration) = config
        .integrations
        .iter_mut()
        .find(|integration| integration.id == source.integration_id)
    {
        if let Some(config_object) = integration.config.as_object_mut() {
            let disabled_device_ids = config_object
                .entry("disabled_device_ids")
                .or_insert_with(|| serde_json::Value::Array(Vec::new()));
            let already_disabled = disabled_device_ids
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(&source.device_id)));
            if !already_disabled {
                if let Some(disabled_device_ids) = disabled_device_ids.as_array_mut() {
                    disabled_device_ids.push(serde_json::Value::String(source.device_id.clone()));
                } else {
                    *disabled_device_ids =
                        serde_json::Value::Array(vec![serde_json::Value::String(
                            source.device_id.clone(),
                        )]);
                }
                result.changed_integrations.push(integration.clone());
            }
        }
    }

    // A profile's reference device is a logical device reference, unlike the
    // calibration points themselves. Keep the profile and update its source.
    for profile in &mut config.color_calibration_profiles {
        let Some(reference_device_key) = profile.reference_device_key.as_mut() else {
            continue;
        };
        if reference_device_key != &source.device_key {
            continue;
        }

        *reference_device_key = replacement
            .map(|replacement| replacement.device_key.clone())
            .unwrap_or_default();
        if replacement.is_none() {
            profile.reference_device_key = None;
        }
        result.changed_calibration_profiles.push(profile.clone());
    }

    // Per-device calibration belongs to the logical device being migrated.
    // Move the source calibration when replacing, with an existing source
    // assignment taking precedence over legacy point data. The destination's
    // calibration is replaced to make the result deterministic.
    let source_assignment = config
        .color_calibration_assignments
        .iter()
        .find(|row| row.device_key == source.device_key)
        .cloned();
    let source_calibration = if source_assignment.is_none() {
        config
            .device_color_calibrations
            .iter()
            .find(|row| row.device_key == source.device_key)
            .cloned()
    } else {
        None
    };
    result.color_calibration_changed = source_assignment.is_some()
        || config
            .device_color_calibrations
            .iter()
            .any(|row| row.device_key == source.device_key);

    if result.color_calibration_changed {
        config.color_calibration_assignments.retain(|row| {
            row.device_key != source.device_key
                && replacement.is_none_or(|replacement| row.device_key != replacement.device_key)
        });
        config.device_color_calibrations.retain(|row| {
            row.device_key != source.device_key
                && replacement.is_none_or(|replacement| row.device_key != replacement.device_key)
        });

        if let Some(replacement) = replacement {
            if let Some(mut assignment) = source_assignment {
                assignment.device_key = replacement.device_key.clone();
                result.moved_calibration_assignment = Some(assignment.clone());
                config.color_calibration_assignments.push(assignment);
            } else if let Some(mut calibration) = source_calibration {
                calibration.device_key = replacement.device_key.clone();
                result.moved_color_calibration = Some(calibration.clone());
                config.device_color_calibrations.push(calibration);
            }
        }
    }

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

    for (sort_order, floorplan) in config.floorplans.iter_mut().enumerate() {
        if config_queries::rewrite_floorplan_device_references_in_grid(
            floorplan,
            &source.device_key,
            replacement.map(|replacement| replacement.device_key.as_str()),
            replacement_device.map(|device| device.name.as_str()),
        ) {
            result.position_changed = true;
            result.changed_floorplans.push(ChangedFloorplan {
                sort_order: sort_order as i32,
                floorplan: floorplan.clone(),
            });
        }
    }

    for widget in &mut config.dashboard_widgets {
        if rewrite_json_device_references(&mut widget.config, source, replacement) {
            result.changed_dashboard_widgets.push(widget.clone());
        }
    }

    let existing_display_override = config
        .device_display_overrides
        .iter()
        .find(|row| row.device_key == source.device_key)
        .cloned();
    let preserved_display_name =
        preserved_display_name(&source.device_key, existing_display_override, source_name);
    if let Some(existing) = preserved_display_name {
        result.display_override_changed = true;
        config.device_display_overrides.retain(|row| {
            row.device_key != source.device_key
                && replacement.is_none_or(|replacement| row.device_key != replacement.device_key)
        });
        if let Some(replacement) = replacement {
            let mut moved = existing;
            moved.device_key = replacement.device_key.clone();
            result.moved_display_override = Some(moved.clone());
            config.device_display_overrides.push(moved);
        }
    }

    if let Some(existing) = config
        .device_sensor_configs
        .iter()
        .find(|row| row.device_ref == source.device_key)
        .cloned()
    {
        result.sensor_config_changed = true;
        config.device_sensor_configs.retain(|row| {
            row.device_ref != source.device_key
                && replacement.is_none_or(|replacement| row.device_ref != replacement.device_key)
        });
        if let Some(replacement) = replacement {
            let mut moved = existing;
            moved.device_ref = replacement.device_key.clone();
            result.moved_sensor_config = Some(moved.clone());
            config.device_sensor_configs.push(moved);
        }
    }

    config
        .device_display_overrides
        .sort_by(|left, right| left.device_key.cmp(&right.device_key));
    config
        .device_sensor_configs
        .sort_by(|left, right| left.device_ref.cmp(&right.device_ref));

    result
}

fn preserved_display_name(
    source_key: &str,
    existing_override: Option<DeviceDisplayNameRow>,
    source_name: Option<&str>,
) -> Option<DeviceDisplayNameRow> {
    existing_override.or_else(|| {
        source_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| DeviceDisplayNameRow {
                device_key: source_key.to_string(),
                display_name: name.to_string(),
            })
    })
}

async fn persist_device_config_rewrite(
    rewrite: &DeviceConfigRewriteResult,
    source: &DeviceConfigTarget,
    replacement: Option<&DeviceConfigTarget>,
) -> color_eyre::Result<()> {
    let changed_floorplans = rewrite
        .changed_floorplans
        .iter()
        .map(|changed| (changed.sort_order, changed.floorplan.clone()))
        .collect::<Vec<_>>();

    config_queries::db_persist_device_config_rewrite(DeviceConfigRewritePersistence {
        source_integration_id: &source.integration_id,
        source_device_id: &source.device_id,
        replacement_device_key: replacement.map(|replacement| replacement.device_key.as_str()),
        changed_groups: &rewrite.changed_groups,
        changed_scenes: &rewrite.changed_scenes,
        changed_routines: &rewrite.changed_routines,
        changed_scene_overrides: &rewrite.changed_scene_overrides,
        changed_floorplans: &changed_floorplans,
        changed_dashboard_widgets: &rewrite.changed_dashboard_widgets,
        changed_calibration_profiles: &rewrite.changed_calibration_profiles,
        changed_integrations: &rewrite.changed_integrations,
        display_override_changed: rewrite.display_override_changed,
        moved_display_override: rewrite.moved_display_override.as_ref(),
        color_calibration_changed: rewrite.color_calibration_changed,
        moved_color_calibration: rewrite.moved_color_calibration.as_ref(),
        moved_calibration_assignment: rewrite.moved_calibration_assignment.as_ref(),
        sensor_config_changed: rewrite.sensor_config_changed,
        moved_sensor_config: rewrite.moved_sensor_config.as_ref(),
    })
    .await
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

fn group_response_row(
    flattened_groups: &crate::types::group::FlattenedGroupsConfig,
    group: GroupRow,
) -> GroupResponseRow {
    let device_keys = flattened_groups
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
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("config").and(
        core_routes(snapshot, handle)
            .or(runtime_status_routes())
            .or(diagnostics_routes(snapshot))
            .or(logs_routes())
            .or(routine_history_routes())
            .or(device_display_name_routes(snapshot, handle))
            .or(device_color_calibration_routes(snapshot, handle))
            .or(device_sensor_config_routes(snapshot, handle))
            .or(sensor_catalog_routes(snapshot, handle))
            .or(device_config_routes(handle))
            .or(integration_schema_routes())
            .or(integrations_routes(snapshot, handle))
            .or(groups_routes(snapshot, handle))
            .or(scenes_routes(snapshot, handle))
            .or(routines_routes(snapshot, handle))
            .or(helpers_routes(snapshot, handle))
            .or(sources_routes(snapshot, handle))
            .or(assistant_routes(snapshot, handle))
            .or(floorplans_routes(snapshot, handle))
            .or(floorplan_routes(snapshot, handle))
            .or(dashboard_routes(snapshot, handle))
            .or(export_import_routes(snapshot, handle))
            .or(migrate_routes(snapshot, handle)),
    )
}

// ============================================================================
// Core Config
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorCatalogItem {
    pub id: String,
    pub name: String,
    #[serde(default = "default_sensor_source")]
    pub source: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SensorCatalogGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub sensor_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SensorCatalog {
    pub sensors: Vec<SensorCatalogItem>,
    pub groups: Vec<SensorCatalogGroup>,
}

fn default_true() -> bool {
    true
}

fn default_sensor_source() -> String {
    "influxdb".to_string()
}

fn default_sensor_catalog() -> SensorCatalog {
    SensorCatalog::default()
}

fn read_sensor_catalog(settings: &[config_queries::WidgetSettingRow]) -> SensorCatalog {
    settings
        .iter()
        .find(|setting| setting.key == SENSOR_CATALOG_SETTING_KEY)
        .and_then(|setting| serde_json::from_value(setting.config.clone()).ok())
        .unwrap_or_else(default_sensor_catalog)
}

fn sensor_catalog_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path!("sensors" / "catalog")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(|snapshot: SnapshotHandle| async move {
            Ok::<_, warp::Rejection>(ApiResponse::success(read_sensor_catalog(
                &snapshot.load().runtime_config.widget_settings,
            )))
        });

    let update = warp::path!("sensors" / "catalog")
        .and(warp::path::end())
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_sensor_catalog);

    get.or(update)
}

async fn update_sensor_catalog(
    mut catalog: SensorCatalog,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let mut seen = HashSet::new();
    catalog.sensors.retain(|sensor| {
        let id = sensor.id.trim();
        !id.is_empty() && !sensor.name.trim().is_empty() && seen.insert(id.to_string())
    });
    if catalog.sensors.is_empty() {
        return Ok(error_response(
            "At least one sensor is required",
            StatusCode::BAD_REQUEST,
        ));
    }
    for sensor in &mut catalog.sensors {
        sensor.id = sensor.id.trim().to_string();
        sensor.name = sensor.name.trim().to_string();
        if sensor.source.trim().is_empty() {
            sensor.source = default_sensor_source();
        }
    }
    let valid_ids = catalog
        .sensors
        .iter()
        .map(|sensor| sensor.id.as_str())
        .collect::<HashSet<_>>();
    for group in &mut catalog.groups {
        group.id = group.id.trim().to_string();
        group.name = group.name.trim().to_string();
        group
            .sensor_ids
            .retain(|id| valid_ids.contains(id.as_str()));
        group.sensor_ids.sort();
        group.sensor_ids.dedup();
    }
    catalog
        .groups
        .retain(|group| !group.id.is_empty() && !group.name.is_empty());
    catalog
        .sensors
        .sort_by_key(|sensor| sensor.name.to_lowercase());
    catalog
        .groups
        .sort_by_key(|group| group.name.to_lowercase());

    let setting = config_queries::WidgetSettingRow {
        key: SENSOR_CATALOG_SETTING_KEY.to_string(),
        config: serde_json::to_value(&catalog).unwrap_or_default(),
    };
    let persistence_setting = setting.clone();
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_widget_setting(setting.clone());
                Ok::<_, ()>(
                    state
                        .runtime_config
                        .widget_settings
                        .iter()
                        .find(|item| item.key == SENSOR_CATALOG_SETTING_KEY)
                        .and_then(|item| serde_json::from_value(item.config.clone()).ok())
                        .unwrap_or(catalog),
                )
            })
        })
        .await;
    let response = match result {
        Ok(Ok(value)) => value,
        _ => return Ok(actor_unavailable()),
    };
    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_widget_setting(&persistence_setting).await;
    Ok(config_write_response(
        response,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

fn logs_routes() -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("logs")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(list_logs)
}

async fn list_logs() -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(recent_logs()))
}

fn routine_history_routes(
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("routine-history")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(list_routine_history)
}

async fn list_routine_history() -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(recent_routine_history()))
}

fn core_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path("core")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_core_config);

    let update = warp::path("core")
        .and(warp::path::end())
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_core_config);

    get.or(update)
}

async fn get_core_config(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(CoreConfigPayload::from_runtime(
        &snap.runtime_config,
    )))
}

async fn update_core_config(
    patch: CoreConfigPatch,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let (core, widgets) = patch.resolve(&state.runtime_config)?;
                state.update_core_config(core.clone());
                for setting in &widgets {
                    state.upsert_widget_setting(setting.clone());
                }
                Ok::<_, String>((
                    core,
                    state.runtime_config.widget_settings.clone(),
                    CoreConfigPayload::from_runtime(&state.runtime_config),
                ))
            })
        })
        .await;
    let (core, widgets, response) = match result {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        Err(_) => return Ok(actor_unavailable()),
    };
    let database_available = db::is_db_connected();
    let persistence = config_queries::db_update_core_settings(&core, &widgets).await;
    Ok(config_write_response(
        response,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

fn helpers_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("helpers")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_helpers);

    let upsert = warp::path!("helpers" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_helper);

    let delete = warp::path!("helpers" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_helper);

    let set_value = warp::path!("helpers" / String / "value")
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(set_helper_value);

    list.or(upsert).or(delete).or(set_value)
}

async fn list_helpers(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(snap.helper_statuses.as_ref().clone()))
}

async fn upsert_helper(
    id: String,
    definition: HelperDefinition,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    if definition.id.0 != id {
        return Ok(error_response(
            "Helper id in the path does not match the body.",
            StatusCode::BAD_REQUEST,
        ));
    }
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                definition.validate()?;
                let id = definition.id.clone();
                state.helpers.upsert_definition(definition.clone())?;
                if let Some(existing) = state
                    .runtime_config
                    .helpers
                    .iter_mut()
                    .find(|existing| existing.id == id)
                {
                    *existing = definition.clone();
                } else {
                    state.runtime_config.helpers.push(definition.clone());
                    state
                        .runtime_config
                        .helpers
                        .sort_by(|left, right| left.id.0.cmp(&right.id.0));
                }
                state.refresh_routine_statuses();
                state.schedule_ws_broadcast(SnapshotChanges {
                    helper_statuses: true,
                    routine_statuses: true,
                    ..SnapshotChanges::none()
                });
                Ok::<_, String>(definition)
            })
        })
        .await;
    let definition = match result {
        Ok(Ok(definition)) => definition,
        Ok(Err(error)) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        Err(_) => return Ok(actor_unavailable()),
    };
    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_helper(&definition).await;
    Ok(config_write_response(
        serde_json::json!({ "id": definition.id.0 }),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

async fn delete_helper(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let helper_id = HelperId(id.clone());
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let removed = state.helpers.remove_definition(&helper_id);
                state
                    .runtime_config
                    .helpers
                    .retain(|definition| definition.id != helper_id);
                state
                    .runtime_config
                    .helper_values
                    .retain(|row| row.id != helper_id.0);
                state.refresh_routine_statuses();
                state.schedule_ws_broadcast(SnapshotChanges {
                    helper_statuses: true,
                    routine_statuses: true,
                    ..SnapshotChanges::none()
                });
                Ok::<_, String>(removed)
            })
        })
        .await;
    let removed = match result {
        Ok(Ok(removed)) => removed,
        Ok(Err(error)) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        Err(_) => return Ok(actor_unavailable()),
    };
    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_helper(&id).await.map(|_| ());
    Ok(config_write_response(
        serde_json::json!({ "deleted": removed }),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

#[derive(Deserialize)]
struct SetHelperValueRequest {
    value: serde_json::Value,
}

async fn set_helper_value(
    id: String,
    body: SetHelperValueRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let helper_id = HelperId(id);
    let value = body.value;
    let result = handle
        .mutate({
            let helper_id = helper_id.clone();
            let value = value.clone();
            move |state| {
                Box::pin(async move {
                    let updated = state
                        .helpers
                        .set_value(&helper_id, value.clone())
                        .map_err(|error| error.to_string())?;
                    let durable = state
                        .helpers
                        .definition(&helper_id)
                        .is_some_and(|definition| {
                            definition.persistence
                                == crate::types::automation_value::HelperPersistence::Durable
                        });
                    if durable {
                        let row = config_queries::HelperValueExportRow {
                            id: helper_id.0.clone(),
                            value: value.clone(),
                            revision: updated.revision,
                        };
                        if let Some(existing) = state
                            .runtime_config
                            .helper_values
                            .iter_mut()
                            .find(|existing| existing.id == row.id)
                        {
                            *existing = row;
                        } else {
                            state.runtime_config.helper_values.push(row);
                            state
                                .runtime_config
                                .helper_values
                                .sort_by(|left, right| left.id.cmp(&right.id));
                        }
                    }
                    state.refresh_routine_statuses();
                    state.schedule_ws_broadcast(SnapshotChanges {
                        helper_statuses: true,
                        routine_statuses: true,
                        ..SnapshotChanges::none()
                    });
                    Ok::<_, String>((updated.revision, durable))
                })
            }
        })
        .await;
    let (revision, durable) = match result {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        Err(_) => return Ok(actor_unavailable()),
    };
    let database_available = db::is_db_connected();
    let persistence = if durable {
        config_queries::db_upsert_helper_state(&helper_id.0, &value, revision).await
    } else {
        Ok(())
    };
    Ok(config_write_response(
        serde_json::json!({ "id": helper_id.0, "value": value, "revision": revision }),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

fn runtime_status_routes(
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("runtime-status")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(get_runtime_status)
}

async fn get_runtime_status() -> Result<impl Reply, warp::Rejection> {
    let persistence_available = db::is_db_connected();
    Ok(ApiResponse::success(RuntimeStatusResponse {
        persistence_available,
        memory_only_mode: !persistence_available,
    }))
}

fn device_display_name_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-display-names")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_device_display_names);

    // Device keys are integration/device-id pairs and commonly contain '/'.
    // Keep a body-based form so reverse proxies cannot reinterpret an encoded
    // slash as another path segment.
    let upsert_by_key = warp::path("device-display-names")
        .and(warp::path::end())
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_device_display_name_by_key);

    let delete_by_key = warp::path("device-display-names")
        .and(warp::path::end())
        .and(warp::delete())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(delete_device_display_name_by_key);

    let upsert = warp::path!("device-display-names" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_device_display_name);

    let delete = warp::path!("device-display-names" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_device_display_name);

    list.or(upsert_by_key)
        .or(delete_by_key)
        .or(upsert)
        .or(delete)
}

async fn list_device_display_names(
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config.device_display_overrides.clone(),
    ))
}

async fn upsert_device_display_name(
    device_key: String,
    mut row: DeviceDisplayNameRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    row.device_key = decode_path_key(device_key);
    upsert_device_display_name_by_key(row, handle).await
}

async fn upsert_device_display_name_by_key(
    row: DeviceDisplayNameRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let row_for_state = row.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_device_display_override(row_for_state);
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_device_display_override(&row).await;

    Ok(config_write_response(
        row,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

async fn delete_device_display_name(
    device_key: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    delete_device_display_name_by_key(
        DeviceDisplayNameRequest {
            device_key: decode_path_key(device_key),
        },
        handle,
    )
    .await
}

#[derive(Deserialize)]
struct DeviceDisplayNameRequest {
    device_key: String,
}

async fn delete_device_display_name_by_key(
    request: DeviceDisplayNameRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let device_key = request.device_key;
    let key_for_state = device_key.clone();
    let deleted = handle
        .mutate(move |state| {
            Box::pin(async move { state.delete_device_display_override(&key_for_state) })
        })
        .await;
    let deleted = match deleted {
        Ok(deleted) => deleted,
        Err(_) => return Ok(actor_unavailable()),
    };

    let _ = deleted; // DELETE is idempotent, including persistence retries.

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_device_display_override(&device_key).await;

    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

mod calibration;

fn device_color_calibration_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-color-calibrations")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_device_color_calibrations);

    let upsert = warp::path!("device-color-calibrations" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_device_color_calibration);

    let delete = warp::path!("device-color-calibrations" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_device_color_calibration);

    list.or(upsert)
        .or(delete)
        .or(calibration::routes(snapshot, handle))
}

async fn list_device_color_calibrations(
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    let mut keys: std::collections::BTreeSet<String> = snap
        .runtime_config
        .device_color_calibrations
        .iter()
        .map(|row| row.device_key.clone())
        .collect();
    keys.extend(
        snap.runtime_config
            .color_calibration_assignments
            .iter()
            .map(|row| row.device_key.clone()),
    );
    Ok(ApiResponse::success(
        keys.into_iter()
            .filter_map(|key| snap.runtime_config.calibration_for_device(&key))
            .collect::<Vec<_>>(),
    ))
}

async fn upsert_device_color_calibration(
    device_key: String,
    mut row: crate::core::color_calibration::DeviceColorCalibration,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    row.device_key = decode_path_key(device_key);
    if let Err(error) = row.validate() {
        return Ok(error_response(&error, StatusCode::BAD_REQUEST));
    }

    let row_for_state = row.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_device_color_calibration(row_for_state);
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_device_color_calibration(&row).await;

    Ok(config_write_response(
        row,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

async fn delete_device_color_calibration(
    device_key: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let device_key = decode_path_key(device_key);
    let key_for_state = device_key.clone();
    let deleted = handle
        .mutate(move |state| {
            Box::pin(async move { state.delete_device_color_calibration(&key_for_state) })
        })
        .await;
    let deleted = match deleted {
        Ok(deleted) => deleted,
        Err(_) => return Ok(actor_unavailable()),
    };

    let _ = deleted; // DELETE is idempotent, including persistence retries.

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_device_color_calibration(&device_key).await;

    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

fn device_sensor_config_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-sensor-configs")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_device_sensor_configs);

    let upsert = warp::path!("device-sensor-configs" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_device_sensor_config);

    let delete = warp::path!("device-sensor-configs" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_device_sensor_config);

    list.or(upsert).or(delete)
}

fn device_config_routes(
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let replace_by_key = warp::path!("devices" / "replace")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(replace_device_config_by_key);

    let replace_legacy = warp::path!("devices" / String / "replace")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(replace_device_config);

    let delete = warp::path!("devices" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_config_device);

    // Device keys contain a `/`, so path-based variants only work when the client
    // percent-encodes it (`%2F`). Proxies commonly normalize that back into a path
    // separator and answer a 307 to the two-segment path, which makes the delete
    // silently fail behind a gateway (405 or 404, device never removed). Accept the
    // key in the body for callers, and keep a two-segment route for gateways that
    // already rewrote the encoded slash.
    let delete_by_key = warp::path!("devices" / "delete")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(delete_config_device_by_key);

    let delete_legacy_segments = warp::path!("devices" / String / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_config_device_legacy_segments);

    delete
        .or(delete_by_key)
        .or(delete_legacy_segments)
        .or(replace_by_key)
        .or(replace_legacy)
}

#[derive(Deserialize)]
struct DeleteDeviceByKeyRequest {
    device_key: String,
}

async fn delete_config_device_by_key(
    request: DeleteDeviceByKeyRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    delete_config_device(request.device_key, handle).await
}

/// Gateway-normalized delete: `/devices/<integration>/<device id>`.
async fn delete_config_device_legacy_segments(
    integration_id: String,
    device_id: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    delete_config_device(format!("{integration_id}/{device_id}"), handle).await
}

async fn replace_device_config_by_key(
    request: ReplaceDeviceByKeyRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    replace_device_config_keys(
        request.source_device_key,
        request.replacement_device_key,
        handle,
    )
    .await
}

async fn replace_device_config(
    device_key: String,
    request: ReplaceDeviceRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    replace_device_config_keys(
        decode_path_key(device_key),
        request.replacement_device_key,
        handle,
    )
    .await
}

async fn replace_device_config_keys(
    source_key: String,
    replacement_key: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let source_key = source_key.trim().to_string();
    let replacement_key = replacement_key.trim().to_string();

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

    enum ReplaceOutcome {
        Ok(Box<DeviceConfigRewriteResult>, DeviceConfigMutationResponse),
        ReplacementMissing,
        SourceMissing,
    }

    let source_for_state = source.clone();
    let replacement_for_state = replacement.clone();
    let outcome = handle
        .mutate(move |state| {
            Box::pin(async move {
                let Some(replacement_device) = state
                    .devices
                    .get_state()
                    .0
                    .values()
                    .find(|device| replacement_for_state.matches_device(device))
                    .cloned()
                else {
                    return ReplaceOutcome::ReplacementMissing;
                };

                let Some(source_device) = state
                    .devices
                    .get_state()
                    .0
                    .values()
                    .find(|device| source_for_state.matches_device(device))
                    .cloned()
                else {
                    return ReplaceOutcome::SourceMissing;
                };

                let mut runtime_config = state.get_runtime_config().clone();
                let mut rewrite = rewrite_device_config_references(
                    &mut runtime_config,
                    &source_for_state,
                    Some(&replacement_for_state),
                    Some(&replacement_device),
                    Some(source_device.name.as_str()),
                );
                let mut scene_overrides = state.scenes.get_scene_overrides();
                rewrite.changed_scene_overrides = rewrite_scene_override_refs(
                    &mut scene_overrides,
                    &source_for_state,
                    Some(&replacement_for_state),
                );

                state.runtime_config = runtime_config;
                state.scenes.replace_scene_overrides(scene_overrides);
                state
                    .devices
                    .remove_device(&source_for_state.to_device_key());
                state.schedule_ws_broadcast(PendingWsUpdate::device_removals(
                    vec![source_for_state.to_device_key()],
                    SnapshotChanges::devices(),
                ));
                state.apply_runtime_groups();
                state.apply_runtime_scenes();
                state.apply_runtime_routines();

                let response = DeviceConfigMutationResponse {
                    deleted_device_key: source_for_state.device_key.clone(),
                    replacement_device_key: Some(replacement_for_state.device_key.clone()),
                    updated_integrations: rewrite.changed_integrations.len(),
                    updated_groups: rewrite.changed_groups.len(),
                    updated_scenes: rewrite.changed_scenes.len(),
                    updated_routines: rewrite.changed_routines.len(),
                    updated_scene_overrides: rewrite.changed_scene_overrides.len(),
                    updated_dashboard_widgets: rewrite.changed_dashboard_widgets.len(),
                    updated_calibration_profiles: rewrite.changed_calibration_profiles.len(),
                    display_override_changed: rewrite.display_override_changed,
                    color_calibration_changed: rewrite.color_calibration_changed,
                    sensor_config_changed: rewrite.sensor_config_changed,
                    position_changed: rewrite.position_changed,
                };

                ReplaceOutcome::Ok(Box::new(rewrite), response)
            })
        })
        .await;

    let (rewrite, response) = match outcome {
        Ok(ReplaceOutcome::Ok(r, resp)) => (r, resp),
        Ok(ReplaceOutcome::ReplacementMissing) => {
            return Ok(error_response(
                "Replacement device not found in runtime state.",
                StatusCode::BAD_REQUEST,
            ));
        }
        Ok(ReplaceOutcome::SourceMissing) => return Ok(not_found("Device")),
        Err(_) => {
            return Ok(error_response(
                "State actor unavailable",
                StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    let database_available = db::is_db_connected();
    let persistence = persist_device_config_rewrite(&rewrite, &source, Some(&replacement)).await;

    Ok(config_write_response(
        response,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

/// Outcome of the shared config-device delete used by the HTTP handler and the
/// configuration assistant.
enum DeviceConfigDeleteOutcome {
    Deleted {
        rewrite: Box<DeviceConfigRewriteResult>,
        source: DeviceConfigTarget,
        response: DeviceConfigMutationResponse,
    },
    InvalidKey,
    NotFound,
    ActorUnavailable,
}

async fn delete_config_device_impl(
    device_key: String,
    handle: &StateHandle,
) -> DeviceConfigDeleteOutcome {
    let source_key = decode_path_key(device_key);
    let Some(source) = DeviceConfigTarget::parse(&source_key) else {
        return DeviceConfigDeleteOutcome::InvalidKey;
    };

    enum DeleteOutcome {
        Ok(Box<DeviceConfigRewriteResult>, DeviceConfigMutationResponse),
        NotFound,
    }

    let source_for_state = source.clone();
    let outcome = handle
        .mutate(move |state| {
            Box::pin(async move {
                if state
                    .devices
                    .get_state()
                    .0
                    .values()
                    .all(|device| !source_for_state.matches_device(device))
                {
                    return DeleteOutcome::NotFound;
                }

                let mut runtime_config = state.get_runtime_config().clone();
                let mut rewrite = rewrite_device_config_references(
                    &mut runtime_config,
                    &source_for_state,
                    None,
                    None,
                    None,
                );
                let mut scene_overrides = state.scenes.get_scene_overrides();
                rewrite.changed_scene_overrides =
                    rewrite_scene_override_refs(&mut scene_overrides, &source_for_state, None);

                state.runtime_config = runtime_config;
                state.scenes.replace_scene_overrides(scene_overrides);
                state
                    .devices
                    .remove_device(&source_for_state.to_device_key());
                state.schedule_ws_broadcast(PendingWsUpdate::device_removals(
                    vec![source_for_state.to_device_key()],
                    SnapshotChanges::devices(),
                ));
                state.apply_runtime_groups();
                state.apply_runtime_scenes();
                state.apply_runtime_routines();

                let response = DeviceConfigMutationResponse {
                    deleted_device_key: source_for_state.device_key.clone(),
                    replacement_device_key: None,
                    updated_integrations: rewrite.changed_integrations.len(),
                    updated_groups: rewrite.changed_groups.len(),
                    updated_scenes: rewrite.changed_scenes.len(),
                    updated_routines: rewrite.changed_routines.len(),
                    updated_scene_overrides: rewrite.changed_scene_overrides.len(),
                    updated_dashboard_widgets: rewrite.changed_dashboard_widgets.len(),
                    updated_calibration_profiles: rewrite.changed_calibration_profiles.len(),
                    display_override_changed: rewrite.display_override_changed,
                    color_calibration_changed: rewrite.color_calibration_changed,
                    sensor_config_changed: rewrite.sensor_config_changed,
                    position_changed: rewrite.position_changed,
                };

                DeleteOutcome::Ok(Box::new(rewrite), response)
            })
        })
        .await;

    match outcome {
        Ok(DeleteOutcome::Ok(rewrite, response)) => DeviceConfigDeleteOutcome::Deleted {
            rewrite,
            source,
            response,
        },
        Ok(DeleteOutcome::NotFound) => DeviceConfigDeleteOutcome::NotFound,
        Err(_) => DeviceConfigDeleteOutcome::ActorUnavailable,
    }
}

async fn delete_config_device(
    device_key: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    match delete_config_device_impl(device_key, &handle).await {
        DeviceConfigDeleteOutcome::Deleted {
            rewrite,
            source,
            response,
        } => {
            let database_available = db::is_db_connected();
            let persistence = persist_device_config_rewrite(&rewrite, &source, None).await;
            Ok(config_write_response(
                response,
                persistence,
                database_available,
                StatusCode::OK,
            ))
        }
        DeviceConfigDeleteOutcome::InvalidKey => Ok(error_response(
            "Invalid device key.",
            StatusCode::BAD_REQUEST,
        )),
        DeviceConfigDeleteOutcome::NotFound => Ok(not_found("Device")),
        DeviceConfigDeleteOutcome::ActorUnavailable => Ok(error_response(
            "State actor unavailable",
            StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn list_device_sensor_configs(
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config.device_sensor_configs.clone(),
    ))
}

async fn upsert_device_sensor_config(
    device_ref: String,
    mut row: DeviceSensorConfigRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    row.device_ref = decode_path_key(device_ref);

    let row_for_state = row.clone();
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let device_exists = state
                    .devices
                    .get_state()
                    .0
                    .keys()
                    .any(|device_key| device_key.to_string() == row_for_state.device_ref);

                if !device_exists {
                    return Err(());
                }

                state.upsert_device_sensor_config(row_for_state);
                Ok(())
            })
        })
        .await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err(())) => {
            return Ok(error_response(
                "Unknown device key",
                StatusCode::BAD_REQUEST,
            ));
        }
        Err(_) => {
            return Ok(error_response(
                "State actor unavailable",
                StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_device_sensor_config(&row).await;

    Ok(config_write_response(
        row,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

async fn delete_device_sensor_config(
    device_ref: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let device_ref = decode_path_key(device_ref);
    let key_for_state = device_ref.clone();
    let deleted = handle
        .mutate(move |state| {
            Box::pin(async move { state.delete_device_sensor_config(&key_for_state) })
        })
        .await;
    let deleted = match deleted {
        Ok(deleted) => deleted,
        Err(_) => return Ok(actor_unavailable()),
    };

    let _ = deleted; // DELETE is idempotent, including persistence retries.

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_device_sensor_config(&device_ref).await;

    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Integrations
// ============================================================================

mod integrations;
use integrations::{integration_schema_routes, integrations_routes};

mod groups;
use groups::groups_routes;

mod scenes;
use scenes::scenes_routes;

mod routines;
use routines::routines_routes;

mod sources;
use sources::sources_routes;

mod assistant;
use assistant::{assistant_routes, ASSISTANT_SETTING_KEY};

fn floorplans_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("floorplans")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_floorplans);

    let create = warp::path("floorplans")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_floorplan);

    let update = warp::path!("floorplans" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_floorplan);

    let delete = warp::path!("floorplans" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_floorplan);

    list.or(create).or(update).or(delete)
}

async fn list_floorplans(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(list_runtime_floorplans(
        &snap.runtime_config,
    )))
}

async fn create_floorplan(
    floorplan: FloorplanMetadataRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let fp_for_state = floorplan.clone();
    let created = handle
        .mutate(move |state| Box::pin(async move { state.create_floorplan_metadata(fp_for_state) }))
        .await
        .unwrap_or(false);

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
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    floorplan.id = id;

    let fp_for_state = floorplan.clone();
    let _ = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.update_floorplan_metadata(fp_for_state);
            })
        })
        .await;

    if let Err(e) = config_queries::db_update_floorplan_metadata(&floorplan).await {
        warn!("Failed to persist floorplan metadata update: {e}");
    }

    Ok(ApiResponse::success(floorplan))
}

async fn delete_floorplan(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let id_for_state = id.clone();
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.delete_floorplan(&id_for_state) }))
        .await
        .unwrap_or(false);

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
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_snapshot(snapshot))
        .and_then(get_floorplan);

    let upload_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::bytes())
        .and(warp::header::optional::<String>("content-type"))
        .and(floorplan_id_query())
        .and(with_handle(handle))
        .and_then(upload_floorplan);

    // Grid endpoints (JSON data for the floor grid)
    let get_grid = warp::path!("floorplan" / "grid")
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_snapshot(snapshot))
        .and_then(get_floorplan_grid);

    let save_grid = warp::path!("floorplan" / "grid")
        .and(warp::post())
        .and(warp::body::json())
        .and(floorplan_id_query())
        .and(with_handle(handle))
        .and_then(save_floorplan_grid);

    // Separate image endpoints
    let get_image = warp::path!("floorplan" / "image")
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_snapshot(snapshot))
        .and_then(get_floorplan_image);

    let head_image = warp::path!("floorplan" / "image")
        .and(warp::head())
        .and(floorplan_id_query())
        .and(with_snapshot(snapshot))
        .and_then(head_floorplan_image);

    let upload_image = warp::path!("floorplan" / "image")
        .and(warp::post())
        .and(warp::multipart::form().max_length(10 * 1024 * 1024))
        .and(floorplan_id_query())
        .and(with_handle(handle))
        .and_then(upload_floorplan_image);

    let delete_image = warp::path!("floorplan" / "image")
        .and(warp::delete())
        .and(floorplan_id_query())
        .and(with_handle(handle))
        .and_then(delete_floorplan_image);

    let get_group_positions = warp::path!("floorplan" / "groups")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_group_positions);

    let upsert_group_position = warp::path!("floorplan" / "groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_group_position);

    let delete_group_position = warp::path!("floorplan" / "groups" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_group_position);

    get_floorplan
        .or(upload_floorplan)
        .or(get_grid)
        .or(save_grid)
        .or(get_image)
        .or(head_image)
        .or(upload_image)
        .or(delete_image)
        .or(get_group_positions)
        .or(upsert_group_position)
        .or(delete_group_position)
}

async fn get_floorplan(
    floorplan_id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match get_runtime_floorplan(&snap.runtime_config, &floorplan_id) {
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
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    // TODO: Get width/height from image metadata
    let floorplan = FloorplanRow {
        image_data: Some(body.to_vec()),
        image_mime_type: content_type,
        width: None,
        height: None,
    };

    let id_for_state = floorplan_id.clone();
    let fp_for_state = floorplan.clone();
    let _ = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_floorplan_content(&id_for_state, fp_for_state);
            })
        })
        .await;

    if let Err(e) = config_queries::db_upsert_floorplan_by_id(&floorplan_id, &floorplan).await {
        warn!("Failed to persist floorplan upload: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_group_positions(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config.group_positions.clone(),
    ))
}

async fn upsert_group_position(
    group_id: String,
    mut pos: GroupPositionRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    pos.group_id = group_id;

    let pos_for_state = pos.clone();
    let _ = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_group_position(pos_for_state);
            })
        })
        .await;

    if let Err(e) = config_queries::db_upsert_group_position(&pos).await {
        warn!("Failed to persist group position: {e}");
    }

    Ok(ApiResponse::success(pos))
}

async fn delete_group_position(
    group_id: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let id_for_state = group_id.clone();
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.delete_group_position(&id_for_state) }))
        .await
        .unwrap_or(false);

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
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match get_runtime_floorplan(&snap.runtime_config, &floorplan_id) {
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
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let id_for_state = floorplan_id.clone();
    let grid_for_state = request.grid.clone();
    let _ = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.set_floorplan_grid(&id_for_state, grid_for_state);
            })
        })
        .await;

    if let Err(e) =
        config_queries::db_upsert_floorplan_grid_by_id(&floorplan_id, &request.grid).await
    {
        warn!("Failed to persist floorplan grid: {e}");
    }

    Ok(ApiResponse::success(()))
}

async fn get_floorplan_image(
    floorplan_id: String,
    snapshot: SnapshotHandle,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    let snap = snapshot.load();
    match get_runtime_floorplan(&snap.runtime_config, &floorplan_id) {
        Some(floorplan) => {
            if let Some(image_data) = floorplan.image_data {
                let mime_type = floorplan
                    .image_mime_type
                    .unwrap_or_else(|| "image/png".to_string());
                Ok(Box::new(warp::reply::with_header(
                    image_data,
                    "Content-Type",
                    mime_type,
                )) as Box<dyn Reply>)
            } else {
                Ok(Box::new(not_found("Floorplan image")) as Box<dyn Reply>)
            }
        }
        None => Ok(Box::new(not_found("Floorplan image")) as Box<dyn Reply>),
    }
}

async fn upload_floorplan_image(
    mut form: warp::multipart::FormData,
    floorplan_id: String,
    handle: StateHandle,
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

        let id_for_state = floorplan_id.clone();
        let fp_for_state = floorplan.clone();
        let _ = handle
            .mutate(move |state| {
                Box::pin(async move {
                    state.upsert_floorplan_content(&id_for_state, fp_for_state);
                })
            })
            .await;

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
    snapshot: SnapshotHandle,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    let snap = snapshot.load();
    match get_runtime_floorplan(&snap.runtime_config, &floorplan_id) {
        Some(floorplan) => {
            if floorplan.image_data.is_some() {
                let mime_type = floorplan
                    .image_mime_type
                    .unwrap_or_else(|| "image/png".to_string());
                Ok(Box::new(warp::reply::with_header(
                    warp::reply(),
                    "Content-Type",
                    mime_type,
                )) as Box<dyn Reply>)
            } else {
                Ok(Box::new(not_found("Floorplan image")) as Box<dyn Reply>)
            }
        }
        None => Ok(Box::new(not_found("Floorplan image")) as Box<dyn Reply>),
    }
}

async fn delete_floorplan_image(
    floorplan_id: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let id_for_state = floorplan_id.clone();
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.clear_floorplan_image(&id_for_state) }))
        .await
        .unwrap_or(false);

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
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_layouts = warp::path!("dashboard" / "layouts")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_dashboard_layouts);

    let upsert_layout = warp::path!("dashboard" / "layouts")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_dashboard_layout);

    let delete_layout = warp::path!("dashboard" / "layouts" / i32)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_dashboard_layout);

    let get_widgets = warp::path!("dashboard" / "layouts" / i32 / "widgets")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_dashboard_widgets);

    let upsert_widget = warp::path!("dashboard" / "widgets")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_dashboard_widget);

    let upsert_widget_legacy = warp::path!("dashboard")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_dashboard_widget);

    let delete_widget = warp::path!("dashboard" / "widgets" / i32)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_dashboard_widget);

    get_layouts
        .or(upsert_layout)
        .or(delete_layout)
        .or(get_widgets)
        .or(upsert_widget)
        .or(upsert_widget_legacy)
        .or(delete_widget)
}

async fn get_dashboard_layouts(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config.dashboard_layouts.clone(),
    ))
}

async fn upsert_dashboard_layout(
    layout: DashboardLayoutRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let layout_for_state = layout.clone();
    let local_layout = handle
        .mutate(move |state| {
            Box::pin(async move { state.upsert_dashboard_layout(layout_for_state) })
        })
        .await
        .unwrap_or_else(|_| layout.clone());

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
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.delete_dashboard_layout(id) }))
        .await
        .unwrap_or(false);

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
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config
            .dashboard_widgets
            .iter()
            .filter(|widget| widget.layout_id == layout_id)
            .cloned()
            .collect::<Vec<_>>(),
    ))
}

async fn upsert_dashboard_widget(
    widget: DashboardWidgetRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let widget_for_state = widget.clone();
    let local_widget = handle
        .mutate(move |state| {
            Box::pin(async move { state.upsert_dashboard_widget(widget_for_state) })
        })
        .await
        .unwrap_or_else(|_| widget.clone());

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
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.delete_dashboard_widget(id) }))
        .await
        .unwrap_or(false);

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

#[derive(Deserialize)]
struct ExportQuery {
    #[serde(default)]
    include_secrets: bool,
}

/// Secret `widget_settings` fields, keyed by widget setting and config field.
///
/// These never leave the server in browser config responses or default
/// exports; `?include_secrets=true` asks for a secret-inclusive backup.
fn secret_widget_field(setting_key: &str) -> Option<&'static str> {
    match setting_key {
        INFLUXDB_SETTING_KEY => Some(TOKEN_FIELD),
        CALENDAR_SETTING_KEY => Some(ICS_URL_FIELD),
        ASSISTANT_SETTING_KEY => Some("api_key"),
        _ => None,
    }
}

/// Drop secret widget fields from an export (unless requested explicitly).
fn redact_widget_secrets(config: &mut ConfigExport) {
    for setting in &mut config.widget_settings {
        let Some(field) = secret_widget_field(&setting.key) else {
            continue;
        };
        if let Some(object) = setting.config.as_object_mut() {
            object.remove(field);
        }
    }
}

/// Restore stored secrets for widget fields absent from an import.
///
/// A redacted export excludes secret fields, so importing one must not wipe
/// the stored tokens. An explicit value (including an empty string) is kept
/// as given; `?include_secrets=true` exports carry the real values.
fn preserve_omitted_widget_secrets(config: &mut ConfigExport, current: &ConfigExport) {
    for setting in &mut config.widget_settings {
        let Some(field) = secret_widget_field(&setting.key) else {
            continue;
        };
        let Some(object) = setting.config.as_object_mut() else {
            continue;
        };
        if object.contains_key(field) {
            continue;
        }
        let stored = current
            .widget_settings
            .iter()
            .find(|row| row.key == setting.key)
            .and_then(|row| row.config.get(field))
            .filter(|value| !value.is_null())
            .cloned();
        if let Some(value) = stored {
            object.insert(field.to_string(), value);
        }
    }
}

fn export_import_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let export = warp::path("export")
        .and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<ExportQuery>())
        .and(with_snapshot(snapshot))
        .and_then(export_config);

    let import = warp::path("import")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::query::<ImportQuery>())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(import_config);

    export.or(import)
}

async fn export_config(
    query: ExportQuery,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    let mut config = (*snap.runtime_config).clone();
    if !query.include_secrets {
        redact_widget_secrets(&mut config);
    }
    Ok(ApiResponse::success(config))
}

async fn import_config(
    query: ImportQuery,
    mut config: ConfigExport,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    // Read after acquiring the write lock, like the integration reload path:
    // secrets missing from the import (redacted export) keep their stored
    // values instead of being wiped.
    let current = match handle
        .mutate(|state| Box::pin(async move { state.get_runtime_config().clone() }))
        .await
    {
        Ok(config) => config,
        Err(_) => return Ok(actor_unavailable()),
    };
    preserve_omitted_widget_secrets(&mut config, &current);
    // Optionally save version before import
    if query.save_version {
        if let Err(e) = config_queries::db_save_config_version(&config, Some("Before import")).await
        {
            warn!("Failed to save config version before import: {e}");
        }
    }

    if let Err(e) = apply_runtime_config_snapshot(&handle, config.clone(), &write_guard).await {
        return Ok(error_response(
            &format!("Import was not applied: {e}"),
            StatusCode::BAD_REQUEST,
        ));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_import_config(&config).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
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
            helpers: Vec::new(),
            helper_values: Vec::new(),
            sources: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_color_calibrations: Vec::new(),
            color_calibration_profiles: Vec::new(),
            color_calibration_assignments: Vec::new(),
            device_sensor_configs: Vec::new(),
            widget_settings: Vec::new(),
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
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let preview = warp::path!("migrate" / "preview")
        .and(warp::post())
        .and(warp::query::<MigrationSelection>())
        .and(warp::body::bytes())
        .and(with_snapshot(snapshot))
        .and_then(migrate_preview);

    let apply = warp::path!("migrate" / "apply")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
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
        default_transition_ms: None,
        scene_transition_ms: None,
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
                group_state_order: Vec::new(),
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
            ..Default::default()
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
    snapshot: SnapshotHandle,
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
            let snap = snapshot.load();
            let preview = canonicalize_migration_preview(result, &snap.devices);

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
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let (preview, selection) = request.into_parts();
    if !selection.has_any() {
        return Ok(error_response(
            "Select at least one section to import.",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (preview, merged_config) = {
        let snap = snapshot.load();
        let preview = select_migration_preview(preview, &selection);

        let preview = canonicalize_migration_preview(preview, &snap.devices).preview;

        (
            preview.clone(),
            merge_selected_migration_config((*snap.runtime_config).clone(), &preview, &selection),
        )
    };

    let counts = MigrateApplyResult {
        core: selection.core,
        integrations: preview.integrations.len(),
        groups: preview.groups.len(),
        scenes: preview.scenes.len(),
        routines: preview.routines.len(),
    };

    if let Err(e) =
        apply_runtime_config_snapshot(&handle, merged_config.clone(), &write_guard).await
    {
        return Ok(error_response(
            &format!("Migration was not applied: {e}"),
            StatusCode::BAD_REQUEST,
        ));
    }

    let database_available = db::is_db_connected();
    let persistence = apply_migration(&merged_config).await;
    Ok(config_write_response(
        counts,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

fn diagnostics_routes(
    snapshot: &SnapshotHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    warp::path!("diagnostics")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            ApiResponse::success(crate::core::config_diagnostics::inspect_config(
                &snapshot.load(),
            ))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::device::DeviceId;
    use ordered_float::OrderedFloat;

    #[test]
    fn replacement_display_name_prefers_override_then_source_name() {
        let inherited = preserved_display_name(
            "esphome-gx53/lower-bathroom-downlight-1",
            None,
            Some(" Lower bathroom downlight 1 "),
        )
        .unwrap();
        assert_eq!(
            inherited.device_key,
            "esphome-gx53/lower-bathroom-downlight-1"
        );
        assert_eq!(inherited.display_name, "Lower bathroom downlight 1");

        let override_name = preserved_display_name(
            "esphome-gx53/lower-bathroom-downlight-1",
            Some(DeviceDisplayNameRow {
                device_key: "old/device".to_string(),
                display_name: "Custom name".to_string(),
            }),
            Some("Integration name"),
        )
        .unwrap();
        assert_eq!(override_name.display_name, "Custom name");
        assert!(preserved_display_name("old/device", None, Some("  ")).is_none());
    }

    fn config_with_secret_widgets() -> ConfigExport {
        let (state, _rx) = crate::core::event::tests::test_state();
        let mut config = state.runtime_config;
        config.widget_settings = vec![
            config_queries::WidgetSettingRow {
                key: INFLUXDB_SETTING_KEY.into(),
                config: serde_json::json!({
                    URL_FIELD: "http://influx.local:8086",
                    TOKEN_FIELD: "s3cret",
                    "bucket": "home",
                }),
            },
            config_queries::WidgetSettingRow {
                key: CALENDAR_SETTING_KEY.into(),
                config: serde_json::json!({ ICS_URL_FIELD: "https://calendar.example/private.ics" }),
            },
            config_queries::WidgetSettingRow {
                key: WEATHER_SETTING_KEY.into(),
                config: serde_json::json!({ API_URL_FIELD: "https://weather.example" }),
            },
        ];
        config
    }

    #[test]
    fn redacted_exports_drop_only_secret_widget_fields() {
        let mut config = config_with_secret_widgets();
        redact_widget_secrets(&mut config);

        let influx = &config.widget_settings[0].config;
        assert_eq!(influx[URL_FIELD], "http://influx.local:8086");
        assert_eq!(influx["bucket"], "home");
        assert!(influx.get(TOKEN_FIELD).is_none());

        let calendar = &config.widget_settings[1].config;
        assert!(calendar.get(ICS_URL_FIELD).is_none());

        let weather = &config.widget_settings[2].config;
        assert_eq!(weather[API_URL_FIELD], "https://weather.example");
    }

    #[test]
    fn redacted_export_round_trips_through_import_with_stored_secrets() {
        let original = config_with_secret_widgets();
        let mut exported = original.clone();
        redact_widget_secrets(&mut exported);

        preserve_omitted_widget_secrets(&mut exported, &original);

        assert_eq!(
            exported.widget_settings[0].config[TOKEN_FIELD],
            original.widget_settings[0].config[TOKEN_FIELD]
        );
        assert_eq!(
            exported.widget_settings[1].config[ICS_URL_FIELD],
            original.widget_settings[1].config[ICS_URL_FIELD]
        );
    }

    #[test]
    fn explicit_import_values_win_over_stored_secrets() {
        let current = config_with_secret_widgets();

        let mut cleared = current.clone();
        cleared.widget_settings[0].config[TOKEN_FIELD] = serde_json::json!("");
        preserve_omitted_widget_secrets(&mut cleared, &current);
        assert_eq!(cleared.widget_settings[0].config[TOKEN_FIELD], "");

        let mut replaced = current.clone();
        replaced.widget_settings[0].config[TOKEN_FIELD] = serde_json::json!("new-token");
        preserve_omitted_widget_secrets(&mut replaced, &current);
        assert_eq!(replaced.widget_settings[0].config[TOKEN_FIELD], "new-token");
    }

    #[test]
    fn import_only_preserves_secrets_for_present_rows() {
        let original = config_with_secret_widgets();
        let mut exported = original.clone();
        redact_widget_secrets(&mut exported);
        exported.widget_settings.remove(0);

        preserve_omitted_widget_secrets(&mut exported, &original);

        assert!(exported
            .widget_settings
            .iter()
            .all(|row| row.key != INFLUXDB_SETTING_KEY));
        assert_eq!(
            exported.widget_settings[0].config[ICS_URL_FIELD],
            "https://calendar.example/private.ics"
        );
    }

    #[test]
    fn core_patch_preserves_omitted_settings_and_unrelated_fields() {
        let (state, _rx) = crate::core::event::tests::test_state();
        let mut config = state.runtime_config;
        config.widget_settings.push(config_queries::WidgetSettingRow { key: INFLUXDB_SETTING_KEY.into(), config: serde_json::json!({ URL_FIELD: "old-url", TOKEN_FIELD: "keep-token", "other": "keep-other" }) });
        let (core, updates) = CoreConfigPatch {
            warmup_time_seconds: Some(9),
            ..Default::default()
        }
        .resolve(&config)
        .unwrap();
        assert_eq!(core.warmup_time_seconds, 9);
        assert!(updates.is_empty());
        let (_, updates) = CoreConfigPatch {
            influx_url: Some("new-url".into()),
            ..Default::default()
        }
        .resolve(&config)
        .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].config[TOKEN_FIELD], "keep-token");
        assert_eq!(updates[0].config["other"], "keep-other");
        assert_eq!(updates[0].config[URL_FIELD], "new-url");
        let (_, updates) = CoreConfigPatch {
            influx_token: Some(String::new()),
            ..Default::default()
        }
        .resolve(&config)
        .unwrap();
        assert_eq!(updates[0].config[TOKEN_FIELD], "");
        assert!(CoreConfigPatch {
            warmup_time_seconds: Some(-1),
            ..Default::default()
        }
        .resolve(&config)
        .is_err());
        let (core, _) = CoreConfigPatch {
            default_transition_ms: Some(Some(1000)),
            ..Default::default()
        }
        .resolve(&config)
        .unwrap();
        assert_eq!(core.default_transition_ms, Some(1000));
        let (core, _) = CoreConfigPatch {
            default_transition_ms: Some(None),
            ..Default::default()
        }
        .resolve(&config)
        .unwrap();
        assert_eq!(core.default_transition_ms, None);
        let (core, _) = CoreConfigPatch {
            scene_transition_ms: Some(Some(1500)),
            ..Default::default()
        }
        .resolve(&config)
        .unwrap();
        assert_eq!(core.scene_transition_ms, Some(1500));
        assert!(CoreConfigPatch {
            scene_transition_ms: Some(Some(65_535_001)),
            ..Default::default()
        }
        .resolve(&config)
        .is_err());
        assert!(CoreConfigPatch {
            default_transition_ms: Some(Some(65_535_001)),
            ..Default::default()
        }
        .resolve(&config)
        .is_err());
    }

    #[tokio::test]
    async fn config_write_reports_durability_separately_from_runtime_success() {
        for (available, succeeds, expected) in [
            (true, true, "persisted"),
            (false, false, "memory_only"),
            (true, false, "failed"),
        ] {
            let result = if succeeds {
                Ok(())
            } else {
                Err(eyre::eyre!("test database failure"))
            };
            let response =
                config_write_response((), result, available, StatusCode::OK).into_response();
            let body = warp::hyper::body::to_bytes(response.into_body())
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(json["success"], true);
            assert_eq!(json["write"]["applied"], true);
            assert_eq!(json["write"]["persistence"], expected);
            assert_eq!(json["write"]["warning"].is_null(), succeeds);
        }
    }

    #[tokio::test]
    async fn integration_commit_preserves_changes_made_during_reload() {
        let (mut state, _) = crate::core::event::tests::test_state();
        let stale = state.runtime_config.clone();
        state.runtime_config.core.warmup_time_seconds = 123;
        state.commit_runtime_integrations_update(stale, state.integrations.clone(), vec![]);
        assert_eq!(state.runtime_config.core.warmup_time_seconds, 123);
    }

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
                group_state_order: Vec::new(),
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
                ..Default::default()
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                default_transition_ms: None,
                scene_transition_ms: None,
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
                group_state_order: Vec::new(),
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
                ..Default::default()
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                default_transition_ms: None,
                scene_transition_ms: None,
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
                group_state_order: Vec::new(),
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
                ..Default::default()
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                default_transition_ms: None,
                scene_transition_ms: None,
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
                default_transition_ms: None,
                scene_transition_ms: None,
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
            helpers: Vec::new(),
            helper_values: Vec::new(),
            sources: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_color_calibrations: Vec::new(),
            color_calibration_profiles: Vec::new(),
            color_calibration_assignments: Vec::new(),
            device_sensor_configs: Vec::new(),
            widget_settings: Vec::new(),
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
                default_transition_ms: None,
                scene_transition_ms: None,
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
                ..Default::default()
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                default_transition_ms: None,
                scene_transition_ms: None,
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
                ..Default::default()
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                default_transition_ms: None,
                scene_transition_ms: None,
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
