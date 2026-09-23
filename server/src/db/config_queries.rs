//! Database queries for configuration entities.
//!
//! This module keeps the public configuration row types stable while executing
//! all runtime persistence through SeaORM/SeaQuery builders so the same code can
//! target SQLite and PostgreSQL.

use super::actions;
use super::get_db_connection;
pub mod calibration;
use super::schema::DeviceColorCalibrations;
use super::schema::{
    AssistantThreads, AutomationSources, AutomationTimerJobs, AutomationValueState,
    AutomationValues, ConfigVersions, CoreConfig, DashboardLayouts, DashboardWidgets,
    DeviceDisplayOverrides, DeviceSensorConfigs, Devices, Floorplans, GroupDevices, GroupLinks,
    GroupPositions, Groups, Integrations, RoutineHistory, Routines, SceneDeviceStates,
    SceneGroupStates, SceneOverrides, Scenes, ValueHistory, WidgetSettings,
};
use crate::core::color_calibration::DeviceColorCalibration;
use crate::types::assistant::{AssistantHistoryMessage, AssistantThread, AssistantThreadSummary};
use crate::types::automation_definition::HelperId;
use crate::types::automation_source::{SourceCompute, SourceDefinition};
use crate::types::automation_value::{HelperDefinition, HelperKind, HelperPersistence};
use crate::types::config_authoring::ValueHistoryEntry;
use crate::types::routine_history::RoutineHistoryEntry;
use color_eyre::Result;
use sea_orm::sea_query::{Expr, OnConflict, Order, Query};
use sea_orm::{ConnectionTrait, QueryResult, Statement, StatementBuilder, TransactionTrait};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// ============================================================================
// Types for config entities
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationRow {
    pub id: String,
    pub plugin: String,
    pub config: serde_json::Value,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRow {
    pub id: String,
    pub name: String,
    pub hidden: bool,
    pub devices: Vec<GroupDeviceRow>,
    pub linked_groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupDeviceRow {
    pub integration_id: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneRow {
    pub id: String,
    pub name: String,
    pub hidden: bool,
    pub script: Option<String>,
    pub device_states: HashMap<String, serde_json::Value>,
    pub group_states: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub group_state_order: Vec<String>,
}

/// One stored routine.
///
/// `semantics_version` is authoritative: `1` selects the legacy `rules` /
/// `actions` interpreter, `2` selects the compiled `definition_v2` body.
/// Unknown versions are rejected/quarantined, never interpreted as v1.
///
/// `definition_v2` is kept as raw JSON so unknown/newer fields survive
/// save/export/import without being dropped. The compiler parses the raw body
/// into the typed schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(
        default = "default_routine_semantics_version",
        skip_serializing_if = "is_v1_semantics_version"
    )]
    pub semantics_version: i32,
    /// Server-managed per-routine revision. Initial revisions are omitted from
    /// exports so legacy (v1) exports round-trip unchanged.
    #[serde(
        default = "default_routine_revision",
        skip_serializing_if = "is_initial_routine_revision"
    )]
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition_v2: Option<serde_json::Value>,
    pub rules: serde_json::Value,
    pub actions: serde_json::Value,
}

fn default_routine_semantics_version() -> i32 {
    1
}

fn is_v1_semantics_version(value: &i32) -> bool {
    *value == 1
}

fn default_routine_revision() -> i64 {
    1
}

fn is_initial_routine_revision(value: &i64) -> bool {
    *value == 1
}

impl Default for RoutineRow {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            enabled: true,
            semantics_version: default_routine_semantics_version(),
            revision: default_routine_revision(),
            definition_v2: None,
            rules: serde_json::Value::Array(Vec::new()),
            actions: serde_json::Value::Array(Vec::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorplanRow {
    pub image_data: Option<Vec<u8>>,
    pub image_mime_type: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorplanGridRow {
    pub grid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorplanMetadataRow {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorplanExportRow {
    pub id: String,
    pub name: String,
    pub image_data: Option<Vec<u8>>,
    pub image_mime_type: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub grid_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePositionRow {
    pub device_key: String,
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    pub rotation: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupPositionRow {
    pub group_id: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub z_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardLayoutRow {
    pub id: i32,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardWidgetRow {
    pub id: i32,
    pub layout_id: i32,
    pub widget_type: String,
    pub config: serde_json::Value,
    pub grid_x: i32,
    pub grid_y: i32,
    pub grid_w: f32,
    pub grid_h: f32,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetSettingRow {
    pub key: String,
    #[serde(default)]
    pub config: serde_json::Value,
}

fn default_warmup_time_seconds() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreConfigRow {
    #[serde(default = "default_warmup_time_seconds")]
    pub warmup_time_seconds: i32,
    /// Optional system-wide fallback for commands without an explicit
    /// transition. Stored in milliseconds so integrations with sub-second
    /// transition support can preserve the configured duration exactly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_transition_ms: Option<u64>,
    /// Optional transition applied when a scene command does not provide an
    /// explicit transition. Stored separately so interactive controls and
    /// scene applications can be tuned independently.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_transition_ms: Option<u64>,
}

impl Default for CoreConfigRow {
    fn default() -> Self {
        Self {
            warmup_time_seconds: default_warmup_time_seconds(),
            default_transition_ms: None,
            scene_transition_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceDisplayNameRow {
    pub device_key: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceSensorConfigRow {
    pub device_ref: String,
    pub interaction_kind: String,
    #[serde(default)]
    pub config: serde_json::Value,
}

/// Current value of a durable helper as carried through `ConfigExport`.
///
/// Session helper values are runtime-only and are never exported. Unknown
/// fields are ignored and missing fields default so older exports import
/// unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperValueExportRow {
    pub id: String,
    pub value: serde_json::Value,
    pub revision: i64,
}

/// One best-effort persisted named timer job (P10). Captured intent *tokens*
/// are process-local revisions and are deliberately absent: the capture spec
/// is re-frozen against the live intent tracker when the job is restored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimerJobRow {
    pub routine_id: String,
    pub timer_id: String,
    pub definition_revision: i64,
    pub generation: i64,
    pub due_wall_ms: i64,
    /// Serialized `TimerIntentCapture`, when the timer was scheduled with one.
    pub capture: Option<String>,
}

/// Full config export structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigExport {
    pub version: i32,
    pub core: CoreConfigRow,
    pub integrations: Vec<IntegrationRow>,
    pub groups: Vec<GroupRow>,
    pub scenes: Vec<SceneRow>,
    pub routines: Vec<RoutineRow>,
    #[serde(default)]
    pub helpers: Vec<crate::types::automation_value::HelperDefinition>,
    #[serde(default)]
    pub helper_values: Vec<HelperValueExportRow>,
    #[serde(default)]
    pub sources: Vec<SourceDefinition>,
    pub floorplan: Option<FloorplanRow>,
    #[serde(default)]
    pub floorplans: Vec<FloorplanExportRow>,
    #[serde(default)]
    pub group_positions: Vec<GroupPositionRow>,
    #[serde(default)]
    pub device_display_overrides: Vec<DeviceDisplayNameRow>,
    #[serde(default)]
    pub device_color_calibrations: Vec<DeviceColorCalibration>,
    #[serde(default)]
    pub color_calibration_profiles: Vec<crate::core::color_calibration::ColorCalibrationProfile>,
    #[serde(default)]
    pub color_calibration_assignments:
        Vec<crate::core::color_calibration::ColorCalibrationAssignment>,
    #[serde(default)]
    pub device_sensor_configs: Vec<DeviceSensorConfigRow>,
    #[serde(default)]
    pub widget_settings: Vec<WidgetSettingRow>,
    pub dashboard_layouts: Vec<DashboardLayoutRow>,
    pub dashboard_widgets: Vec<DashboardWidgetRow>,
}

pub fn extract_floorplan_device_positions(
    floorplans: &[FloorplanExportRow],
) -> Vec<DevicePositionRow> {
    let mut seen_keys = HashSet::new();
    let mut positions = Vec::new();

    for floorplan in floorplans {
        let Some(grid_json) = floorplan.grid_data.as_deref() else {
            continue;
        };

        let grid_data: serde_json::Value = match serde_json::from_str(grid_json) {
            Ok(grid_data) => grid_data,
            Err(error) => {
                warn!(
                    "Failed to parse grid_data for floorplan '{}': {error}",
                    floorplan.id
                );
                continue;
            }
        };

        let tile_size = grid_data
            .get("tileSize")
            .and_then(serde_json::Value::as_f64)
            .filter(|value| *value > 0.0)
            .unwrap_or(1.0) as f32;

        let Some(devices) = grid_data
            .get("devices")
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };

        for device in devices {
            let Some(device_key) = device.get("deviceKey").and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            let Some(x) = device.get("x").and_then(serde_json::Value::as_f64) else {
                continue;
            };
            let Some(y) = device.get("y").and_then(serde_json::Value::as_f64) else {
                continue;
            };

            if !seen_keys.insert(device_key.to_string()) {
                continue;
            }

            positions.push(DevicePositionRow {
                device_key: device_key.to_string(),
                x: (x as f32 + 0.5) * tile_size,
                y: (y as f32 + 0.5) * tile_size,
                scale: 1.0,
                rotation: 0.0,
            });
        }
    }

    positions
}

pub fn rewrite_floorplan_device_references_in_grid(
    floorplan: &mut FloorplanExportRow,
    source_device_key: &str,
    replacement_device_key: Option<&str>,
    replacement_device_name: Option<&str>,
) -> bool {
    let Some(grid_json) = floorplan.grid_data.as_deref() else {
        return false;
    };

    let mut grid_data: serde_json::Value = match serde_json::from_str(grid_json) {
        Ok(grid_data) => grid_data,
        Err(error) => {
            warn!(
                "Failed to parse grid_data for floorplan '{}': {error}",
                floorplan.id
            );
            return false;
        }
    };

    let Some(devices) = grid_data
        .get_mut("devices")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return false;
    };

    let mut replacement_inserted = replacement_device_key.is_some_and(|replacement_device_key| {
        devices.iter().any(|device| {
            device
                .get("deviceKey")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|device_key| {
                    device_key == replacement_device_key && device_key != source_device_key
                })
        })
    });

    let mut changed = false;
    devices.retain_mut(|device| {
        let is_source_device = device
            .get("deviceKey")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|device_key| device_key == source_device_key);

        if !is_source_device {
            return true;
        }

        changed = true;

        let Some(replacement_device_key) = replacement_device_key else {
            return false;
        };

        if replacement_inserted {
            return false;
        }

        replacement_inserted = true;

        if let Some(device_object) = device.as_object_mut() {
            device_object.insert(
                "deviceKey".to_string(),
                serde_json::Value::String(replacement_device_key.to_string()),
            );

            if let Some(replacement_device_name) = replacement_device_name {
                device_object.insert(
                    "deviceName".to_string(),
                    serde_json::Value::String(replacement_device_name.to_string()),
                );
            }
        }

        true
    });

    if !changed {
        return false;
    }

    match serde_json::to_string(&grid_data) {
        Ok(serialized) => {
            floorplan.grid_data = Some(serialized);
            true
        }
        Err(error) => {
            warn!(
                "Failed to serialize rewritten grid_data for floorplan '{}': {error}",
                floorplan.id
            );
            false
        }
    }
}

// ============================================================================
// Core Config
// ============================================================================

pub async fn db_get_core_config() -> Result<Option<CoreConfigRow>> {
    let db = get_db_connection()?;

    let row = db
        .query_one(statement(
            db,
            Query::select()
                .column(CoreConfig::WarmupTimeSeconds)
                .column(CoreConfig::DefaultTransitionMs)
                .column(CoreConfig::SceneTransitionMs)
                .from(CoreConfig::Table)
                .and_where(Expr::col(CoreConfig::Id).eq(1))
                .to_owned(),
        ))
        .await?;

    Ok(row.map(|row| CoreConfigRow {
        warmup_time_seconds: get_i32_or_default(&row, "warmup_time_seconds", 1),
        default_transition_ms: get_u64(&row, "default_transition_ms"),
        scene_transition_ms: get_u64(&row, "scene_transition_ms"),
    }))
}

pub async fn db_update_core_config(config: &CoreConfigRow) -> Result<()> {
    update_core_config_on(get_db_connection()?, config).await
}

async fn update_core_config_on<C: ConnectionTrait>(db: &C, config: &CoreConfigRow) -> Result<()> {
    execute(
        db,
        Query::update()
            .table(CoreConfig::Table)
            .value(
                CoreConfig::WarmupTimeSeconds,
                Expr::value(config.warmup_time_seconds),
            )
            .value(
                CoreConfig::DefaultTransitionMs,
                config
                    .default_transition_ms
                    .map(Expr::value)
                    .unwrap_or_else(|| Expr::cust("NULL")),
            )
            .value(
                CoreConfig::SceneTransitionMs,
                config
                    .scene_transition_ms
                    .map(Expr::value)
                    .unwrap_or_else(|| Expr::cust("NULL")),
            )
            .value(CoreConfig::UpdatedAt, Expr::current_timestamp())
            .and_where(Expr::col(CoreConfig::Id).eq(1))
            .to_owned(),
    )
    .await?;

    Ok(())
}

/// Keep core settings and the service settings submitted with them atomic.
pub async fn db_update_core_settings(
    config: &CoreConfigRow,
    settings: &[WidgetSettingRow],
) -> Result<()> {
    update_core_settings_on(get_db_connection()?, config, settings).await
}

async fn update_core_settings_on<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &CoreConfigRow,
    settings: &[WidgetSettingRow],
) -> Result<()> {
    let txn = db.begin().await?;
    update_core_config_on(&txn, config).await?;
    for setting in settings {
        upsert_widget_setting_on(&txn, setting).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub async fn db_get_device_display_overrides() -> Result<Vec<DeviceDisplayNameRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                DeviceDisplayOverrides::DeviceKey,
                DeviceDisplayOverrides::DisplayName,
            ])
            .from(DeviceDisplayOverrides::Table)
            .order_by(DeviceDisplayOverrides::DeviceKey, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(device_display_name_from_row).collect()
}

pub async fn db_upsert_device_display_override(row: &DeviceDisplayNameRow) -> Result<()> {
    let db = get_db_connection()?;

    upsert_device_display_override_on(db, row).await
}

async fn upsert_device_display_override_on<C: ConnectionTrait>(
    db: &C,
    row: &DeviceDisplayNameRow,
) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(DeviceDisplayOverrides::Table)
            .columns([
                DeviceDisplayOverrides::DeviceKey,
                DeviceDisplayOverrides::DisplayName,
            ])
            .values_panic([
                Expr::value(row.device_key.clone()),
                Expr::value(row.display_name.clone()),
            ])
            .on_conflict(
                OnConflict::column(DeviceDisplayOverrides::DeviceKey)
                    .update_column(DeviceDisplayOverrides::DisplayName)
                    .value(DeviceDisplayOverrides::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_device_display_override(device_key: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(
        db,
        DeviceDisplayOverrides::Table,
        DeviceDisplayOverrides::DeviceKey,
        device_key,
    )
    .await
}

pub async fn db_get_device_color_calibrations() -> Result<Vec<DeviceColorCalibration>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                DeviceColorCalibrations::DeviceKey,
                DeviceColorCalibrations::Points,
            ])
            .from(DeviceColorCalibrations::Table)
            .order_by(DeviceColorCalibrations::DeviceKey, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter()
        .map(device_color_calibration_from_row)
        .collect()
}

pub async fn db_upsert_device_color_calibration(row: &DeviceColorCalibration) -> Result<()> {
    let txn = get_db_connection()?.begin().await?;
    delete_by_string_key(
        &txn,
        calibration::CalibrationAssignments::Table,
        calibration::CalibrationAssignments::DeviceKey,
        &row.device_key,
    )
    .await?;
    upsert_device_color_calibration_on(&txn, row).await?;
    txn.commit().await?;
    Ok(())
}

async fn upsert_device_color_calibration_on<C: ConnectionTrait>(
    db: &C,
    row: &DeviceColorCalibration,
) -> Result<()> {
    row.validate().map_err(|error| eyre!(error))?;

    execute(
        db,
        Query::insert()
            .into_table(DeviceColorCalibrations::Table)
            .columns([
                DeviceColorCalibrations::DeviceKey,
                DeviceColorCalibrations::Points,
            ])
            .values_panic([
                Expr::value(row.device_key.clone()),
                Expr::value(serde_json::to_string(&row.points)?),
            ])
            .on_conflict(
                OnConflict::column(DeviceColorCalibrations::DeviceKey)
                    .update_column(DeviceColorCalibrations::Points)
                    .value(
                        DeviceColorCalibrations::UpdatedAt,
                        Expr::current_timestamp(),
                    )
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_device_color_calibration(device_key: &str) -> Result<bool> {
    let txn = get_db_connection()?.begin().await?;
    let assignment = delete_by_string_key(
        &txn,
        calibration::CalibrationAssignments::Table,
        calibration::CalibrationAssignments::DeviceKey,
        device_key,
    )
    .await?;
    let legacy = delete_by_string_key(
        &txn,
        DeviceColorCalibrations::Table,
        DeviceColorCalibrations::DeviceKey,
        device_key,
    )
    .await?;
    txn.commit().await?;
    Ok(assignment || legacy)
}

async fn replace_device_color_calibrations_on<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    rows: &[DeviceColorCalibration],
) -> Result<()> {
    for row in rows {
        row.validate().map_err(|error| eyre!(error))?;
    }
    let txn = db.begin().await?;
    execute(
        &txn,
        Query::delete()
            .from_table(DeviceColorCalibrations::Table)
            .to_owned(),
    )
    .await?;
    for row in rows {
        upsert_device_color_calibration_on(&txn, row).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub async fn db_get_device_sensor_configs() -> Result<Vec<DeviceSensorConfigRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                DeviceSensorConfigs::DeviceRef,
                DeviceSensorConfigs::InteractionKind,
                DeviceSensorConfigs::ConfigJson,
            ])
            .from(DeviceSensorConfigs::Table)
            .order_by(DeviceSensorConfigs::DeviceRef, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter()
        .map(device_sensor_config_from_row)
        .collect()
}

pub async fn db_upsert_device_sensor_config(row: &DeviceSensorConfigRow) -> Result<()> {
    let db = get_db_connection()?;

    upsert_device_sensor_config_on(db, row).await
}

async fn upsert_device_sensor_config_on<C: ConnectionTrait>(
    db: &C,
    row: &DeviceSensorConfigRow,
) -> Result<()> {
    let config_json = serde_json::to_string(&row.config)?;

    execute(
        db,
        Query::insert()
            .into_table(DeviceSensorConfigs::Table)
            .columns([
                DeviceSensorConfigs::DeviceRef,
                DeviceSensorConfigs::InteractionKind,
                DeviceSensorConfigs::ConfigJson,
            ])
            .values_panic([
                Expr::value(row.device_ref.clone()),
                Expr::value(row.interaction_kind.clone()),
                Expr::value(config_json),
            ])
            .on_conflict(
                OnConflict::column(DeviceSensorConfigs::DeviceRef)
                    .update_columns([
                        DeviceSensorConfigs::InteractionKind,
                        DeviceSensorConfigs::ConfigJson,
                    ])
                    .value(DeviceSensorConfigs::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_device_sensor_config(device_ref: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(
        db,
        DeviceSensorConfigs::Table,
        DeviceSensorConfigs::DeviceRef,
        device_ref,
    )
    .await
}

// ============================================================================
// Integrations
// ============================================================================

pub async fn db_get_integrations() -> Result<Vec<IntegrationRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                Integrations::Id,
                Integrations::Plugin,
                Integrations::Config,
                Integrations::Enabled,
            ])
            .from(Integrations::Table)
            .order_by(Integrations::Id, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(integration_from_row).collect()
}

pub async fn db_get_integration(id: &str) -> Result<Option<IntegrationRow>> {
    let db = get_db_connection()?;
    let row = one(
        db,
        Query::select()
            .columns([
                Integrations::Id,
                Integrations::Plugin,
                Integrations::Config,
                Integrations::Enabled,
            ])
            .from(Integrations::Table)
            .and_where(Expr::col(Integrations::Id).eq(id))
            .to_owned(),
    )
    .await?;

    row.map(integration_from_row).transpose()
}

pub async fn db_upsert_integration(integration: &IntegrationRow) -> Result<()> {
    let db = get_db_connection()?;
    upsert_integration_on(db, integration).await
}

async fn upsert_integration_on<C: ConnectionTrait>(
    db: &C,
    integration: &IntegrationRow,
) -> Result<()> {
    let config = serde_json::to_string(&integration.config)?;
    execute(
        db,
        Query::insert()
            .into_table(Integrations::Table)
            .columns([
                Integrations::Id,
                Integrations::Plugin,
                Integrations::Config,
                Integrations::Enabled,
            ])
            .values_panic([
                Expr::value(integration.id.clone()),
                Expr::value(integration.plugin.clone()),
                Expr::value(config),
                Expr::value(integration.enabled),
            ])
            .on_conflict(
                OnConflict::column(Integrations::Id)
                    .update_columns([
                        Integrations::Plugin,
                        Integrations::Config,
                        Integrations::Enabled,
                    ])
                    .value(Integrations::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_integration(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, Integrations::Table, Integrations::Id, id).await
}

// ============================================================================
// Groups
// ============================================================================

pub async fn db_get_groups() -> Result<Vec<GroupRow>> {
    let db = get_db_connection()?;
    let rows = group_rows(db, None).await?;

    let mut result = Vec::new();
    for row in rows {
        result.push(group_from_row(db, row).await?);
    }

    Ok(result)
}

pub async fn db_get_group(id: &str) -> Result<Option<GroupRow>> {
    let db = get_db_connection()?;
    let mut rows = group_rows(db, Some(id)).await?;
    let Some(row) = rows.pop() else {
        return Ok(None);
    };

    Ok(Some(group_from_row(db, row).await?))
}

pub async fn db_upsert_group(group: &GroupRow) -> Result<()> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;
    upsert_group_on(&txn, group).await?;
    txn.commit().await?;
    Ok(())
}

pub async fn db_delete_group(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, Groups::Table, Groups::Id, id).await
}

// ============================================================================
// Scenes
// ============================================================================

pub async fn db_get_config_scenes() -> Result<Vec<SceneRow>> {
    let db = get_db_connection()?;
    let rows = scene_rows(db, None).await?;

    let mut result = Vec::new();
    for row in rows {
        result.push(scene_from_row(db, row).await?);
    }

    Ok(result)
}

pub async fn db_get_config_scene(id: &str) -> Result<Option<SceneRow>> {
    let db = get_db_connection()?;
    let mut rows = scene_rows(db, Some(id)).await?;
    let Some(row) = rows.pop() else {
        return Ok(None);
    };

    Ok(Some(scene_from_row(db, row).await?))
}

pub async fn db_upsert_config_scene(scene: &SceneRow) -> Result<()> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;
    upsert_scene_on(&txn, scene).await?;
    txn.commit().await?;
    Ok(())
}

pub async fn db_delete_config_scene(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, Scenes::Table, Scenes::Id, id).await
}

// ============================================================================
// Routines
// ============================================================================

pub async fn db_get_routines() -> Result<Vec<RoutineRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                Routines::Id,
                Routines::Name,
                Routines::Enabled,
                Routines::SemanticsVersion,
                Routines::DefinitionV2,
                Routines::Revision,
                Routines::Rules,
                Routines::Actions,
            ])
            .from(Routines::Table)
            .order_by(Routines::Name, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(routine_from_row).collect()
}

pub async fn db_get_routine(id: &str) -> Result<Option<RoutineRow>> {
    let db = get_db_connection()?;
    let row = one(
        db,
        Query::select()
            .columns([
                Routines::Id,
                Routines::Name,
                Routines::Enabled,
                Routines::SemanticsVersion,
                Routines::DefinitionV2,
                Routines::Revision,
                Routines::Rules,
                Routines::Actions,
            ])
            .from(Routines::Table)
            .and_where(Expr::col(Routines::Id).eq(id))
            .to_owned(),
    )
    .await?;

    row.map(routine_from_row).transpose()
}

pub async fn db_upsert_routine(routine: &RoutineRow) -> Result<()> {
    upsert_routine_on(get_db_connection()?, routine).await
}

/// Write a set of routine rows in one transaction. Used by the offline
/// converter and its archive restore; unlike `db_replace_routines` this never
/// deletes rows that are not part of the set.
pub async fn db_apply_routine_rows(routines: &[RoutineRow]) -> Result<()> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;
    for routine in routines {
        upsert_routine_on(&txn, routine).await?;
    }
    txn.commit().await?;
    Ok(())
}

/// Apply an offline conversion in one transaction: routine upserts, routine
/// deletes (archive rollback of converter-created rows), and integration
/// upserts (quiescing converted cron/timer integrations).
pub async fn db_apply_conversion(
    routine_upserts: &[RoutineRow],
    routine_deletes: &[String],
    integration_upserts: &[IntegrationRow],
) -> Result<()> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;
    for id in routine_deletes {
        delete_by_string_key(&txn, Routines::Table, Routines::Id, id).await?;
    }
    for routine in routine_upserts {
        upsert_routine_on(&txn, routine).await?;
    }
    for integration in integration_upserts {
        upsert_integration_on(&txn, integration).await?;
    }
    txn.commit().await?;
    Ok(())
}

async fn upsert_routine_on<C: ConnectionTrait>(db: &C, routine: &RoutineRow) -> Result<()> {
    let rules = serde_json::to_string(&routine.rules)?;
    let actions = serde_json::to_string(&routine.actions)?;
    let definition_v2 = match &routine.definition_v2 {
        Some(definition) => Some(serde_json::to_string(definition)?),
        None => None,
    };

    execute(
        db,
        Query::insert()
            .into_table(Routines::Table)
            .columns([
                Routines::Id,
                Routines::Name,
                Routines::Enabled,
                Routines::SemanticsVersion,
                Routines::DefinitionV2,
                Routines::Revision,
                Routines::Rules,
                Routines::Actions,
            ])
            .values_panic([
                Expr::value(routine.id.clone()),
                Expr::value(routine.name.clone()),
                Expr::value(routine.enabled),
                Expr::value(routine.semantics_version),
                Expr::value(definition_v2),
                Expr::value(routine.revision),
                Expr::value(rules),
                Expr::value(actions),
            ])
            .on_conflict(
                OnConflict::column(Routines::Id)
                    .update_columns([
                        Routines::Name,
                        Routines::Enabled,
                        Routines::SemanticsVersion,
                        Routines::DefinitionV2,
                        Routines::Revision,
                        Routines::Rules,
                        Routines::Actions,
                    ])
                    .value(Routines::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

/// Persist the actor-owned routine collection atomically. Re-saving after a
/// failed rename also repairs references and removes the old persisted ID.
pub async fn db_replace_routines(routines: &[RoutineRow]) -> Result<()> {
    replace_routines_on(get_db_connection()?, routines).await
}

async fn replace_routines_on<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    routines: &[RoutineRow],
) -> Result<()> {
    let txn = db.begin().await?;
    let mut delete = Query::delete();
    delete.from_table(Routines::Table);
    if !routines.is_empty() {
        delete.and_where(
            Expr::col(Routines::Id).is_not_in(routines.iter().map(|row| row.id.clone())),
        );
    }
    execute(&txn, delete.to_owned()).await?;
    for routine in routines {
        upsert_routine_on(&txn, routine).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub async fn db_delete_routine(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, Routines::Table, Routines::Id, id).await
}

// ============================================================================
// Automation helpers
// ============================================================================

pub async fn db_get_helpers() -> Result<Vec<HelperDefinition>> {
    helpers_on(get_db_connection()?).await
}

async fn helpers_on<C: ConnectionTrait>(db: &C) -> Result<Vec<HelperDefinition>> {
    all(
        db,
        Query::select()
            .columns([
                AutomationValues::Id,
                AutomationValues::Name,
                AutomationValues::Kind,
                AutomationValues::InitialValue,
                AutomationValues::Persistence,
                AutomationValues::Hidden,
            ])
            .from(AutomationValues::Table)
            .order_by(AutomationValues::Id, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(helper_from_row)
    .collect()
}

pub async fn db_upsert_helper(helper: &HelperDefinition) -> Result<()> {
    upsert_helper_on(get_db_connection()?, helper).await
}

async fn upsert_helper_on<C: ConnectionTrait>(db: &C, helper: &HelperDefinition) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(AutomationValues::Table)
            .columns([
                AutomationValues::Id,
                AutomationValues::Name,
                AutomationValues::Kind,
                AutomationValues::InitialValue,
                AutomationValues::Persistence,
                AutomationValues::Hidden,
            ])
            .values_panic([
                Expr::value(helper.id.as_str().to_string()),
                Expr::value(helper.name.clone()),
                Expr::value(serde_json::to_string(&helper.kind)?),
                Expr::value(serde_json::to_string(&helper.initial_value)?),
                Expr::value(helper_persistence_as_str(helper.persistence).to_string()),
                Expr::value(helper.hidden),
            ])
            .on_conflict(
                OnConflict::column(AutomationValues::Id)
                    .update_columns([
                        AutomationValues::Name,
                        AutomationValues::Kind,
                        AutomationValues::InitialValue,
                        AutomationValues::Persistence,
                        AutomationValues::Hidden,
                    ])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

/// Delete a helper definition together with its durable state row.
pub async fn db_delete_helper(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;
    delete_by_string_key(
        &txn,
        AutomationValueState::Table,
        AutomationValueState::HelperId,
        id,
    )
    .await?;
    let deleted =
        delete_by_string_key(&txn, AutomationValues::Table, AutomationValues::Id, id).await?;
    txn.commit().await?;
    Ok(deleted)
}

/// Current values for durable helpers only. Session helper values are
/// runtime-only and are never persisted or exported.
pub async fn db_get_helper_states() -> Result<Vec<HelperValueExportRow>> {
    let db = get_db_connection()?;
    let helpers = helpers_on(db).await?;
    helper_states_on(db, &helpers).await
}

async fn helper_states_on<C: ConnectionTrait>(
    db: &C,
    helpers: &[HelperDefinition],
) -> Result<Vec<HelperValueExportRow>> {
    let durable_ids: HashSet<&str> = helpers
        .iter()
        .filter(|helper| helper.persistence == HelperPersistence::Durable)
        .map(|helper| helper.id.as_str())
        .collect();

    Ok(all(
        db,
        Query::select()
            .columns([
                AutomationValueState::HelperId,
                AutomationValueState::Value,
                AutomationValueState::Revision,
            ])
            .from(AutomationValueState::Table)
            .order_by(AutomationValueState::HelperId, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(helper_state_from_row)
    .collect::<Result<Vec<_>>>()?
    .into_iter()
    .filter(|row| durable_ids.contains(row.id.as_str()))
    .collect())
}

pub async fn db_upsert_helper_state(
    helper_id: &str,
    value: &serde_json::Value,
    revision: i64,
) -> Result<()> {
    upsert_helper_state_on(get_db_connection()?, helper_id, value, revision).await
}

async fn upsert_helper_state_on<C: ConnectionTrait>(
    db: &C,
    helper_id: &str,
    value: &serde_json::Value,
    revision: i64,
) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(AutomationValueState::Table)
            .columns([
                AutomationValueState::HelperId,
                AutomationValueState::Value,
                AutomationValueState::Revision,
            ])
            .values_panic([
                Expr::value(helper_id.to_string()),
                Expr::value(serde_json::to_string(value)?),
                Expr::value(revision),
            ])
            .on_conflict(
                OnConflict::column(AutomationValueState::HelperId)
                    .update_columns([AutomationValueState::Value, AutomationValueState::Revision])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_helper_state(helper_id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(
        db,
        AutomationValueState::Table,
        AutomationValueState::HelperId,
        helper_id,
    )
    .await
}

// ============================================================================
// Computed source definitions (P11)
// ============================================================================

pub async fn db_get_sources() -> Result<Vec<SourceDefinition>> {
    sources_on(get_db_connection()?).await
}

async fn sources_on<C: ConnectionTrait>(db: &C) -> Result<Vec<SourceDefinition>> {
    all(
        db,
        Query::select()
            .columns([
                AutomationSources::Id,
                AutomationSources::Name,
                AutomationSources::Enabled,
                AutomationSources::Revision,
                AutomationSources::Timezone,
                AutomationSources::RefreshIntervalMs,
                AutomationSources::Aliases,
                AutomationSources::Compute,
            ])
            .from(AutomationSources::Table)
            .order_by(AutomationSources::Id, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(source_from_row)
    .collect()
}

pub async fn db_upsert_source(source: &SourceDefinition) -> Result<()> {
    upsert_source_on(get_db_connection()?, source).await
}

async fn upsert_source_on<C: ConnectionTrait>(db: &C, source: &SourceDefinition) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(AutomationSources::Table)
            .columns([
                AutomationSources::Id,
                AutomationSources::Name,
                AutomationSources::Enabled,
                AutomationSources::Revision,
                AutomationSources::Timezone,
                AutomationSources::RefreshIntervalMs,
                AutomationSources::Aliases,
                AutomationSources::Compute,
            ])
            .values_panic([
                Expr::value(source.id.0.clone()),
                Expr::value(source.name.clone()),
                Expr::value(source.enabled),
                Expr::value(source.revision),
                Expr::value(source.timezone.clone()),
                Expr::value(source.refresh_interval_ms.min(i64::MAX as u64) as i64),
                Expr::value(serde_json::to_string(&source.aliases)?),
                Expr::value(serde_json::to_string(&source.compute)?),
            ])
            .on_conflict(
                OnConflict::column(AutomationSources::Id)
                    .update_columns([
                        AutomationSources::Name,
                        AutomationSources::Enabled,
                        AutomationSources::Revision,
                        AutomationSources::Timezone,
                        AutomationSources::RefreshIntervalMs,
                        AutomationSources::Aliases,
                        AutomationSources::Compute,
                    ])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_source(id: &str) -> Result<bool> {
    delete_by_string_key(
        get_db_connection()?,
        AutomationSources::Table,
        AutomationSources::Id,
        id,
    )
    .await
}

// ============================================================================
// Best-effort durable named timer jobs (P10)
// ============================================================================

pub async fn db_get_timer_jobs() -> Result<Vec<TimerJobRow>> {
    timer_jobs_on(get_db_connection()?).await
}

async fn timer_jobs_on<C: ConnectionTrait>(db: &C) -> Result<Vec<TimerJobRow>> {
    all(
        db,
        Query::select()
            .columns([
                AutomationTimerJobs::RoutineId,
                AutomationTimerJobs::TimerId,
                AutomationTimerJobs::DefinitionRevision,
                AutomationTimerJobs::Generation,
                AutomationTimerJobs::DueWallMs,
                AutomationTimerJobs::Capture,
            ])
            .from(AutomationTimerJobs::Table)
            .order_by(AutomationTimerJobs::RoutineId, Order::Asc)
            .order_by(AutomationTimerJobs::TimerId, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(timer_job_from_row)
    .collect()
}

fn timer_job_from_row(row: QueryResult) -> Result<TimerJobRow> {
    Ok(TimerJobRow {
        routine_id: row.try_get("", "routine_id")?,
        timer_id: row.try_get("", "timer_id")?,
        definition_revision: row.try_get("", "definition_revision")?,
        generation: row.try_get("", "generation")?,
        due_wall_ms: row.try_get("", "due_wall_ms")?,
        capture: row.try_get("", "capture")?,
    })
}

pub async fn db_upsert_timer_job(job: &TimerJobRow) -> Result<()> {
    upsert_timer_job_on(get_db_connection()?, job).await
}

async fn upsert_timer_job_on<C: ConnectionTrait>(db: &C, job: &TimerJobRow) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(AutomationTimerJobs::Table)
            .columns([
                AutomationTimerJobs::RoutineId,
                AutomationTimerJobs::TimerId,
                AutomationTimerJobs::DefinitionRevision,
                AutomationTimerJobs::Generation,
                AutomationTimerJobs::DueWallMs,
                AutomationTimerJobs::Capture,
            ])
            .values_panic([
                Expr::value(job.routine_id.clone()),
                Expr::value(job.timer_id.clone()),
                Expr::value(job.definition_revision),
                Expr::value(job.generation),
                Expr::value(job.due_wall_ms),
                Expr::value(job.capture.clone()),
            ])
            .on_conflict(
                OnConflict::columns([AutomationTimerJobs::RoutineId, AutomationTimerJobs::TimerId])
                    .update_columns([
                        AutomationTimerJobs::DefinitionRevision,
                        AutomationTimerJobs::Generation,
                        AutomationTimerJobs::DueWallMs,
                        AutomationTimerJobs::Capture,
                    ])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_timer_job(routine_id: &str, timer_id: &str) -> Result<bool> {
    delete_timer_job_on(get_db_connection()?, routine_id, timer_id).await
}

async fn delete_timer_job_on<C: ConnectionTrait>(
    db: &C,
    routine_id: &str,
    timer_id: &str,
) -> Result<bool> {
    let rows = execute(
        db,
        Query::delete()
            .from_table(AutomationTimerJobs::Table)
            .and_where(Expr::col(AutomationTimerJobs::RoutineId).eq(routine_id))
            .and_where(Expr::col(AutomationTimerJobs::TimerId).eq(timer_id))
            .to_owned(),
    )
    .await?;

    Ok(rows > 0)
}

/// Drop every persisted timer job. A config import replaces the runtime
/// configuration, so previously acknowledged jobs must never resume (P10).
pub async fn db_clear_timer_jobs() -> Result<()> {
    clear_timer_jobs_on(get_db_connection()?).await
}

async fn clear_timer_jobs_on<C: ConnectionTrait>(db: &C) -> Result<()> {
    execute(
        db,
        Query::delete()
            .from_table(AutomationTimerJobs::Table)
            .to_owned(),
    )
    .await?;
    Ok(())
}

// ============================================================================
// Floorplan
// ============================================================================

pub async fn db_get_floorplan() -> Result<Option<FloorplanRow>> {
    db_get_floorplan_by_id("default").await
}

pub async fn db_get_floorplan_by_id(id: &str) -> Result<Option<FloorplanRow>> {
    let db = get_db_connection()?;
    let row = one(
        db,
        Query::select()
            .columns([
                Floorplans::ImageData,
                Floorplans::ImageMimeType,
                Floorplans::Width,
                Floorplans::Height,
            ])
            .from(Floorplans::Table)
            .and_where(Expr::col(Floorplans::Id).eq(id))
            .to_owned(),
    )
    .await?;

    row.map(floorplan_from_row).transpose()
}

pub async fn db_upsert_floorplan(floorplan: &FloorplanRow) -> Result<()> {
    db_upsert_floorplan_by_id("default", floorplan).await
}

pub async fn db_upsert_floorplan_by_id(id: &str, floorplan: &FloorplanRow) -> Result<()> {
    let db = get_db_connection()?;
    let default_name = default_floorplan_name(id);

    execute(
        db,
        Query::insert()
            .into_table(Floorplans::Table)
            .columns([
                Floorplans::Id,
                Floorplans::Name,
                Floorplans::ImageData,
                Floorplans::ImageMimeType,
                Floorplans::Width,
                Floorplans::Height,
            ])
            .values_panic([
                Expr::value(id),
                Expr::value(default_name),
                Expr::value(floorplan.image_data.clone()),
                Expr::value(floorplan.image_mime_type.clone()),
                Expr::value(floorplan.width),
                Expr::value(floorplan.height),
            ])
            .on_conflict(
                OnConflict::column(Floorplans::Id)
                    .update_columns([
                        Floorplans::ImageData,
                        Floorplans::ImageMimeType,
                        Floorplans::Width,
                        Floorplans::Height,
                    ])
                    .value(Floorplans::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_clear_floorplan_image(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let rows = execute(
        db,
        Query::update()
            .table(Floorplans::Table)
            .value(Floorplans::ImageData, Expr::value(Option::<Vec<u8>>::None))
            .value(
                Floorplans::ImageMimeType,
                Expr::value(Option::<String>::None),
            )
            .value(Floorplans::Width, Expr::value(Option::<i32>::None))
            .value(Floorplans::Height, Expr::value(Option::<i32>::None))
            .value(Floorplans::UpdatedAt, Expr::current_timestamp())
            .and_where(Expr::col(Floorplans::Id).eq(id))
            .to_owned(),
    )
    .await?;

    Ok(rows > 0)
}

pub async fn db_get_floorplan_grid() -> Result<Option<FloorplanGridRow>> {
    db_get_floorplan_grid_by_id("default").await
}

pub async fn db_get_floorplan_grid_by_id(id: &str) -> Result<Option<FloorplanGridRow>> {
    let db = get_db_connection()?;
    let row = one(
        db,
        Query::select()
            .column(Floorplans::GridData)
            .from(Floorplans::Table)
            .and_where(Expr::col(Floorplans::Id).eq(id))
            .to_owned(),
    )
    .await?;

    Ok(row.and_then(|row| {
        row.try_get::<Option<String>>("", "grid_data")
            .ok()
            .flatten()
            .map(|grid| FloorplanGridRow { grid })
    }))
}

pub async fn db_upsert_floorplan_grid(grid: &str) -> Result<()> {
    db_upsert_floorplan_grid_by_id("default", grid).await
}

pub async fn db_upsert_floorplan_grid_by_id(id: &str, grid: &str) -> Result<()> {
    let db = get_db_connection()?;
    let default_name = default_floorplan_name(id);

    execute(
        db,
        Query::insert()
            .into_table(Floorplans::Table)
            .columns([Floorplans::Id, Floorplans::Name, Floorplans::GridData])
            .values_panic([
                Expr::value(id),
                Expr::value(default_name),
                Expr::value(grid),
            ])
            .on_conflict(
                OnConflict::column(Floorplans::Id)
                    .update_column(Floorplans::GridData)
                    .value(Floorplans::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_get_floorplans() -> Result<Vec<FloorplanMetadataRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([Floorplans::Id, Floorplans::Name])
            .from(Floorplans::Table)
            .order_by(Floorplans::SortOrder, Order::Asc)
            .order_by(Floorplans::Name, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(floorplan_metadata_from_row).collect()
}

pub async fn db_get_floorplan_exports() -> Result<Vec<FloorplanExportRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                Floorplans::Id,
                Floorplans::Name,
                Floorplans::ImageData,
                Floorplans::ImageMimeType,
                Floorplans::Width,
                Floorplans::Height,
                Floorplans::GridData,
            ])
            .from(Floorplans::Table)
            .order_by(Floorplans::SortOrder, Order::Asc)
            .order_by(Floorplans::Name, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(floorplan_export_from_row).collect()
}

pub async fn db_upsert_floorplan_export(
    floorplan: &FloorplanExportRow,
    sort_order: i32,
) -> Result<()> {
    let db = get_db_connection()?;

    upsert_floorplan_export_on(db, floorplan, sort_order).await
}

async fn upsert_floorplan_export_on<C: ConnectionTrait>(
    db: &C,
    floorplan: &FloorplanExportRow,
    sort_order: i32,
) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(Floorplans::Table)
            .columns([
                Floorplans::Id,
                Floorplans::Name,
                Floorplans::ImageData,
                Floorplans::ImageMimeType,
                Floorplans::Width,
                Floorplans::Height,
                Floorplans::GridData,
                Floorplans::SortOrder,
            ])
            .values_panic([
                Expr::value(floorplan.id.clone()),
                Expr::value(floorplan.name.clone()),
                Expr::value(floorplan.image_data.clone()),
                Expr::value(floorplan.image_mime_type.clone()),
                Expr::value(floorplan.width),
                Expr::value(floorplan.height),
                Expr::value(floorplan.grid_data.clone()),
                Expr::value(sort_order),
            ])
            .on_conflict(
                OnConflict::column(Floorplans::Id)
                    .update_columns([
                        Floorplans::Name,
                        Floorplans::ImageData,
                        Floorplans::ImageMimeType,
                        Floorplans::Width,
                        Floorplans::Height,
                        Floorplans::GridData,
                        Floorplans::SortOrder,
                    ])
                    .value(Floorplans::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_create_floorplan(floorplan: &FloorplanMetadataRow) -> Result<()> {
    let db = get_db_connection()?;
    let sort_order = next_sort_order(db, Floorplans::Table, Floorplans::SortOrder).await?;

    execute(
        db,
        Query::insert()
            .into_table(Floorplans::Table)
            .columns([Floorplans::Id, Floorplans::Name, Floorplans::SortOrder])
            .values_panic([
                Expr::value(floorplan.id.clone()),
                Expr::value(floorplan.name.clone()),
                Expr::value(sort_order),
            ])
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_update_floorplan_metadata(floorplan: &FloorplanMetadataRow) -> Result<()> {
    let db = get_db_connection()?;

    execute(
        db,
        Query::update()
            .table(Floorplans::Table)
            .value(Floorplans::Name, Expr::value(floorplan.name.clone()))
            .value(Floorplans::UpdatedAt, Expr::current_timestamp())
            .and_where(Expr::col(Floorplans::Id).eq(floorplan.id.clone()))
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_floorplan(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, Floorplans::Table, Floorplans::Id, id).await
}

// ============================================================================
// Group Positions
// ============================================================================

pub async fn db_get_group_positions() -> Result<Vec<GroupPositionRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                GroupPositions::GroupId,
                GroupPositions::X,
                GroupPositions::Y,
                GroupPositions::Width,
                GroupPositions::Height,
                GroupPositions::ZIndex,
            ])
            .from(GroupPositions::Table)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(group_position_from_row).collect()
}

pub async fn db_upsert_group_position(pos: &GroupPositionRow) -> Result<()> {
    let db = get_db_connection()?;

    execute(
        db,
        Query::insert()
            .into_table(GroupPositions::Table)
            .columns([
                GroupPositions::GroupId,
                GroupPositions::X,
                GroupPositions::Y,
                GroupPositions::Width,
                GroupPositions::Height,
                GroupPositions::ZIndex,
            ])
            .values_panic([
                Expr::value(pos.group_id.clone()),
                Expr::value(pos.x as f64),
                Expr::value(pos.y as f64),
                Expr::value(pos.width as f64),
                Expr::value(pos.height as f64),
                Expr::value(pos.z_index),
            ])
            .on_conflict(
                OnConflict::column(GroupPositions::GroupId)
                    .update_columns([
                        GroupPositions::X,
                        GroupPositions::Y,
                        GroupPositions::Width,
                        GroupPositions::Height,
                        GroupPositions::ZIndex,
                    ])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_group_position(group_id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, GroupPositions::Table, GroupPositions::GroupId, group_id).await
}

// ============================================================================
// Dashboard Layouts
// ============================================================================

pub async fn db_get_dashboard_layouts() -> Result<Vec<DashboardLayoutRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                DashboardLayouts::Id,
                DashboardLayouts::Name,
                DashboardLayouts::IsDefault,
            ])
            .from(DashboardLayouts::Table)
            .order_by(DashboardLayouts::Name, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(dashboard_layout_from_row).collect()
}

pub async fn db_upsert_dashboard_layout(layout: &DashboardLayoutRow) -> Result<i32> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;

    if layout.is_default {
        execute(
            &txn,
            Query::update()
                .table(DashboardLayouts::Table)
                .value(DashboardLayouts::IsDefault, Expr::value(false))
                .and_where(Expr::col(DashboardLayouts::IsDefault).eq(true))
                .to_owned(),
        )
        .await?;
    }

    let id = if layout.id > 0 {
        execute(
            &txn,
            Query::update()
                .table(DashboardLayouts::Table)
                .value(DashboardLayouts::Name, Expr::value(layout.name.clone()))
                .value(DashboardLayouts::IsDefault, Expr::value(layout.is_default))
                .value(DashboardLayouts::UpdatedAt, Expr::current_timestamp())
                .and_where(Expr::col(DashboardLayouts::Id).eq(layout.id))
                .to_owned(),
        )
        .await?;
        layout.id
    } else {
        let id = next_i32_id(&txn, DashboardLayouts::Table, DashboardLayouts::Id).await?;
        execute(
            &txn,
            Query::insert()
                .into_table(DashboardLayouts::Table)
                .columns([
                    DashboardLayouts::Id,
                    DashboardLayouts::Name,
                    DashboardLayouts::IsDefault,
                ])
                .values_panic([
                    Expr::value(id),
                    Expr::value(layout.name.clone()),
                    Expr::value(layout.is_default),
                ])
                .to_owned(),
        )
        .await?;
        id
    };

    txn.commit().await?;
    Ok(id)
}

pub async fn db_delete_dashboard_layout(id: i32) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_i32_key(db, DashboardLayouts::Table, DashboardLayouts::Id, id).await
}

// ============================================================================
// Dashboard Widgets
// ============================================================================

pub async fn db_get_dashboard_widgets(layout_id: i32) -> Result<Vec<DashboardWidgetRow>> {
    let db = get_db_connection()?;
    dashboard_widgets_for_layout(db, layout_id).await
}

pub async fn db_upsert_dashboard_widget(widget: &DashboardWidgetRow) -> Result<i32> {
    let db = get_db_connection()?;
    upsert_dashboard_widget_on(db, widget).await
}

async fn upsert_dashboard_widget_on<C: ConnectionTrait>(
    db: &C,
    widget: &DashboardWidgetRow,
) -> Result<i32> {
    let config = serde_json::to_string(&widget.config)?;

    if widget.id > 0 {
        execute(
            db,
            Query::update()
                .table(DashboardWidgets::Table)
                .value(DashboardWidgets::LayoutId, Expr::value(widget.layout_id))
                .value(
                    DashboardWidgets::WidgetType,
                    Expr::value(widget.widget_type.clone()),
                )
                .value(DashboardWidgets::Config, Expr::value(config))
                .value(DashboardWidgets::GridX, Expr::value(widget.grid_x))
                .value(DashboardWidgets::GridY, Expr::value(widget.grid_y))
                .value(DashboardWidgets::GridWValue, Expr::value(widget.grid_w))
                .value(DashboardWidgets::GridHValue, Expr::value(widget.grid_h))
                .value(DashboardWidgets::SortOrder, Expr::value(widget.sort_order))
                .and_where(Expr::col(DashboardWidgets::Id).eq(widget.id))
                .to_owned(),
        )
        .await?;
        Ok(widget.id)
    } else {
        let id = next_i32_id(db, DashboardWidgets::Table, DashboardWidgets::Id).await?;
        execute(
            db,
            Query::insert()
                .into_table(DashboardWidgets::Table)
                .columns([
                    DashboardWidgets::Id,
                    DashboardWidgets::LayoutId,
                    DashboardWidgets::WidgetType,
                    DashboardWidgets::Config,
                    DashboardWidgets::GridX,
                    DashboardWidgets::GridY,
                    DashboardWidgets::GridWValue,
                    DashboardWidgets::GridHValue,
                    DashboardWidgets::SortOrder,
                ])
                .values_panic([
                    Expr::value(id),
                    Expr::value(widget.layout_id),
                    Expr::value(widget.widget_type.clone()),
                    Expr::value(config),
                    Expr::value(widget.grid_x),
                    Expr::value(widget.grid_y),
                    Expr::value(widget.grid_w),
                    Expr::value(widget.grid_h),
                    Expr::value(widget.sort_order),
                ])
                .to_owned(),
        )
        .await?;
        Ok(id)
    }
}

pub async fn db_delete_dashboard_widget(id: i32) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_i32_key(db, DashboardWidgets::Table, DashboardWidgets::Id, id).await
}

pub async fn db_get_widget_settings() -> Result<Vec<WidgetSettingRow>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([WidgetSettings::Key, WidgetSettings::Config])
            .from(WidgetSettings::Table)
            .order_by(WidgetSettings::Key, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(widget_setting_from_row).collect()
}

pub async fn db_upsert_widget_setting(setting: &WidgetSettingRow) -> Result<()> {
    let db = get_db_connection()?;
    upsert_widget_setting_on(db, setting).await
}

pub async fn db_replace_widget_settings(settings: &[WidgetSettingRow]) -> Result<()> {
    let db = get_db_connection()?;
    let txn = db.begin().await?;

    execute(
        &txn,
        Query::delete().from_table(WidgetSettings::Table).to_owned(),
    )
    .await?;

    for setting in settings {
        insert_widget_setting_on(&txn, setting).await?;
    }

    txn.commit().await?;
    Ok(())
}

// ============================================================================
// Config Import/Export
// ============================================================================

pub async fn db_export_config() -> Result<ConfigExport> {
    db_export_config_from_connection(get_db_connection()?).await
}

pub async fn db_export_config_from_connection<C: ConnectionTrait>(db: &C) -> Result<ConfigExport> {
    let core = one(
        db,
        Query::select()
            .column(CoreConfig::WarmupTimeSeconds)
            .column(CoreConfig::DefaultTransitionMs)
            .column(CoreConfig::SceneTransitionMs)
            .from(CoreConfig::Table)
            .and_where(Expr::col(CoreConfig::Id).eq(1))
            .to_owned(),
    )
    .await?
    .map(|row| CoreConfigRow {
        warmup_time_seconds: get_i32_or_default(&row, "warmup_time_seconds", 1),
        default_transition_ms: get_u64(&row, "default_transition_ms"),
        scene_transition_ms: get_u64(&row, "scene_transition_ms"),
    })
    .unwrap_or_default();

    let integrations = all(
        db,
        Query::select()
            .columns([
                Integrations::Id,
                Integrations::Plugin,
                Integrations::Config,
                Integrations::Enabled,
            ])
            .from(Integrations::Table)
            .order_by(Integrations::Id, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(integration_from_row)
    .collect::<Result<Vec<_>>>()?;

    let mut groups = Vec::new();
    for row in group_rows(db, None).await? {
        groups.push(group_from_row(db, row).await?);
    }

    let mut scenes = Vec::new();
    for row in scene_rows(db, None).await? {
        scenes.push(scene_from_row(db, row).await?);
    }

    let routines = all(
        db,
        Query::select()
            .columns([
                Routines::Id,
                Routines::Name,
                Routines::Enabled,
                Routines::SemanticsVersion,
                Routines::DefinitionV2,
                Routines::Revision,
                Routines::Rules,
                Routines::Actions,
            ])
            .from(Routines::Table)
            .order_by(Routines::Name, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(routine_from_row)
    .collect::<Result<Vec<_>>>()?;

    let helpers = helpers_on(db).await?;
    let helper_values = helper_states_on(db, &helpers).await?;

    let sources = sources_on(db).await?;

    let floorplan = one(
        db,
        Query::select()
            .columns([
                Floorplans::ImageData,
                Floorplans::ImageMimeType,
                Floorplans::Width,
                Floorplans::Height,
            ])
            .from(Floorplans::Table)
            .and_where(Expr::col(Floorplans::Id).eq("default"))
            .to_owned(),
    )
    .await?
    .map(floorplan_from_row)
    .transpose()?;

    let floorplans = all(
        db,
        Query::select()
            .columns([
                Floorplans::Id,
                Floorplans::Name,
                Floorplans::ImageData,
                Floorplans::ImageMimeType,
                Floorplans::Width,
                Floorplans::Height,
                Floorplans::GridData,
            ])
            .from(Floorplans::Table)
            .order_by(Floorplans::SortOrder, Order::Asc)
            .order_by(Floorplans::Name, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(floorplan_export_from_row)
    .collect::<Result<Vec<_>>>()?;

    let group_positions = all(
        db,
        Query::select()
            .columns([
                GroupPositions::GroupId,
                GroupPositions::X,
                GroupPositions::Y,
                GroupPositions::Width,
                GroupPositions::Height,
                GroupPositions::ZIndex,
            ])
            .from(GroupPositions::Table)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(group_position_from_row)
    .collect::<Result<Vec<_>>>()?;

    let device_display_overrides = all(
        db,
        Query::select()
            .columns([
                DeviceDisplayOverrides::DeviceKey,
                DeviceDisplayOverrides::DisplayName,
            ])
            .from(DeviceDisplayOverrides::Table)
            .order_by(DeviceDisplayOverrides::DeviceKey, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(device_display_name_from_row)
    .collect::<Result<Vec<_>>>()?;

    let device_color_calibrations = all(
        db,
        Query::select()
            .columns([
                DeviceColorCalibrations::DeviceKey,
                DeviceColorCalibrations::Points,
            ])
            .from(DeviceColorCalibrations::Table)
            .order_by(DeviceColorCalibrations::DeviceKey, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(device_color_calibration_from_row)
    .collect::<Result<Vec<_>>>()?;

    let device_sensor_configs = all(
        db,
        Query::select()
            .columns([
                DeviceSensorConfigs::DeviceRef,
                DeviceSensorConfigs::InteractionKind,
                DeviceSensorConfigs::ConfigJson,
            ])
            .from(DeviceSensorConfigs::Table)
            .order_by(DeviceSensorConfigs::DeviceRef, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(device_sensor_config_from_row)
    .collect::<Result<Vec<_>>>()?;

    let widget_settings = match all(
        db,
        Query::select()
            .columns([WidgetSettings::Key, WidgetSettings::Config])
            .from(WidgetSettings::Table)
            .order_by(WidgetSettings::Key, Order::Asc)
            .to_owned(),
    )
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(widget_setting_from_row)
            .collect::<Result<Vec<_>>>()?,
        Err(error) => {
            warn!("Failed to read widget settings from database export: {error}");
            Vec::new()
        }
    };

    let dashboard_layouts = all(
        db,
        Query::select()
            .columns([
                DashboardLayouts::Id,
                DashboardLayouts::Name,
                DashboardLayouts::IsDefault,
            ])
            .from(DashboardLayouts::Table)
            .order_by(DashboardLayouts::Name, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(dashboard_layout_from_row)
    .collect::<Result<Vec<_>>>()?;

    let mut dashboard_widgets = Vec::new();
    for layout in &dashboard_layouts {
        dashboard_widgets.extend(dashboard_widgets_for_layout(db, layout.id).await?);
    }

    Ok(ConfigExport {
        version: 1,
        core,
        integrations,
        groups,
        scenes,
        routines,
        helpers,
        helper_values,
        sources,
        floorplan,
        floorplans,
        group_positions,
        device_display_overrides,
        device_color_calibrations,
        color_calibration_profiles: calibration::profiles(db).await?,
        color_calibration_assignments: calibration::assignments(db).await?,
        device_sensor_configs,
        widget_settings,
        dashboard_layouts,
        dashboard_widgets,
    })
}

pub async fn db_import_config(config: &ConfigExport) -> Result<()> {
    config
        .validate_calibration_profiles()
        .map_err(|error| eyre!(error))?;
    for row in &config.device_color_calibrations {
        row.validate().map_err(|error| eyre!(error))?;
    }
    calibration::import(get_db_connection()?, config).await?;
    db_update_core_config(&config.core).await?;
    db_replace_widget_settings(&config.widget_settings).await?;

    for integration in &config.integrations {
        db_upsert_integration(integration).await?;
    }

    let valid_group_ids: HashSet<&str> = config.groups.iter().map(|g| g.id.as_str()).collect();

    for group in &config.groups {
        let group_without_links = GroupRow {
            linked_groups: Vec::new(),
            ..group.clone()
        };
        db_upsert_group(&group_without_links).await?;
    }

    for group in &config.groups {
        if group.linked_groups.is_empty() {
            continue;
        }

        let valid_links: Vec<String> = group
            .linked_groups
            .iter()
            .filter(|id| {
                if valid_group_ids.contains(id.as_str()) {
                    true
                } else {
                    warn!(
                        "Group '{}' links to non-existent group '{}', skipping",
                        group.id, id
                    );
                    false
                }
            })
            .cloned()
            .collect();

        if !valid_links.is_empty() {
            let filtered_group = GroupRow {
                linked_groups: valid_links,
                ..group.clone()
            };
            db_upsert_group(&filtered_group).await?;
        }
    }

    for scene in &config.scenes {
        db_upsert_config_scene(scene).await?;
    }
    for routine in &config.routines {
        db_upsert_routine(routine).await?;
    }
    for helper in &config.helpers {
        db_upsert_helper(helper).await?;
    }
    for source in &config.sources {
        db_upsert_source(source).await?;
    }
    let durable_helper_ids: HashSet<&str> = config
        .helpers
        .iter()
        .filter(|helper| helper.persistence == HelperPersistence::Durable)
        .map(|helper| helper.id.as_str())
        .collect();
    for state in &config.helper_values {
        if !durable_helper_ids.contains(state.id.as_str()) {
            warn!(
                "Skipping value for non-durable or undefined helper '{}'",
                state.id
            );
            continue;
        }
        db_upsert_helper_state(&state.id, &state.value, state.revision).await?;
    }
    if !config.floorplans.is_empty() {
        for (sort_order, floorplan) in config.floorplans.iter().enumerate() {
            db_upsert_floorplan_export(floorplan, sort_order as i32).await?;
        }
    } else if let Some(floorplan) = &config.floorplan {
        db_upsert_floorplan(floorplan).await?;
    }
    for pos in &config.group_positions {
        db_upsert_group_position(pos).await?;
    }
    for device_display_override in &config.device_display_overrides {
        db_upsert_device_display_override(device_display_override).await?;
    }
    replace_device_color_calibrations_on(get_db_connection()?, &config.device_color_calibrations)
        .await?;
    for device_sensor_config in &config.device_sensor_configs {
        db_upsert_device_sensor_config(device_sensor_config).await?;
    }
    for layout in &config.dashboard_layouts {
        db_upsert_dashboard_layout(layout).await?;
    }
    for widget in &config.dashboard_widgets {
        db_upsert_dashboard_widget(widget).await?;
    }

    // P10: an import replaces the runtime configuration, so previously
    // acknowledged named timers must never resume after a restart. Timer jobs
    // are deliberately not part of the export format.
    clear_timer_jobs_on(get_db_connection()?).await?;

    Ok(())
}

pub async fn db_save_config_version(
    config: &ConfigExport,
    description: Option<&str>,
) -> Result<i32> {
    let db = get_db_connection()?;
    let version = next_sort_order(db, ConfigVersions::Table, ConfigVersions::Version).await?;
    let config_json = serde_json::to_string(config)?;

    execute(
        db,
        Query::insert()
            .into_table(ConfigVersions::Table)
            .columns([
                ConfigVersions::Version,
                ConfigVersions::Description,
                ConfigVersions::ConfigJson,
            ])
            .values_panic([
                Expr::value(version),
                Expr::value(description.map(ToOwned::to_owned)),
                Expr::value(config_json),
            ])
            .to_owned(),
    )
    .await?;

    Ok(version)
}

/// Check whether the database contains any user-managed configuration.
pub async fn db_has_config() -> Result<bool> {
    if !db_get_integrations().await?.is_empty()
        || !db_get_groups().await?.is_empty()
        || !db_get_config_scenes().await?.is_empty()
        || !db_get_routines().await?.is_empty()
        || !db_get_helpers().await?.is_empty()
        || !db_get_sources().await?.is_empty()
        || !db_get_group_positions().await?.is_empty()
        || !db_get_device_display_overrides().await?.is_empty()
        || !calibration::profiles(get_db_connection()?)
            .await?
            .is_empty()
        || !db_get_device_color_calibrations().await?.is_empty()
        || !db_get_device_sensor_configs().await?.is_empty()
        || !db_get_widget_settings().await?.is_empty()
    {
        return Ok(true);
    }

    if db_get_floorplan_exports()
        .await?
        .iter()
        .any(|floorplan| !is_empty_default_floorplan_stub(floorplan))
    {
        return Ok(true);
    }

    if db_get_dashboard_layouts()
        .await?
        .iter()
        .any(|layout| layout.id != 1 || layout.name != "Default" || !layout.is_default)
    {
        return Ok(true);
    }

    let db = get_db_connection()?;
    if exists(
        db,
        Query::select()
            .expr(Expr::value(1))
            .from(DashboardWidgets::Table)
            .limit(1)
            .to_owned(),
    )
    .await?
    {
        return Ok(true);
    }

    exists(
        db,
        Query::select()
            .expr(Expr::value(1))
            .from(SceneOverrides::Table)
            .limit(1)
            .to_owned(),
    )
    .await
}

fn statement<C, S>(db: &C, builder: S) -> Statement
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    db.get_database_backend().build(&builder)
}

async fn all<C, S>(db: &C, builder: S) -> Result<Vec<QueryResult>>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    Ok(db.query_all(statement(db, builder)).await?)
}

async fn one<C, S>(db: &C, builder: S) -> Result<Option<QueryResult>>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    Ok(db.query_one(statement(db, builder)).await?)
}

async fn execute<C, S>(db: &C, builder: S) -> Result<u64>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    Ok(db.execute(statement(db, builder)).await?.rows_affected())
}

async fn exists<C, S>(db: &C, builder: S) -> Result<bool>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    Ok(one(db, builder).await?.is_some())
}

async fn delete_by_string_key<C, T, K>(db: &C, table: T, key_col: K, key: &str) -> Result<bool>
where
    C: ConnectionTrait,
    T: sea_orm::sea_query::IntoTableRef,
    K: sea_orm::sea_query::IntoColumnRef,
{
    let rows = execute(
        db,
        Query::delete()
            .from_table(table)
            .and_where(Expr::col(key_col).eq(key))
            .to_owned(),
    )
    .await?;
    Ok(rows > 0)
}

async fn delete_by_i32_key<C, T, K>(db: &C, table: T, key_col: K, key: i32) -> Result<bool>
where
    C: ConnectionTrait,
    T: sea_orm::sea_query::IntoTableRef,
    K: sea_orm::sea_query::IntoColumnRef,
{
    let rows = execute(
        db,
        Query::delete()
            .from_table(table)
            .and_where(Expr::col(key_col).eq(key))
            .to_owned(),
    )
    .await?;
    Ok(rows > 0)
}

async fn group_rows<C: ConnectionTrait>(db: &C, id: Option<&str>) -> Result<Vec<QueryResult>> {
    let mut query = Query::select();
    query
        .columns([Groups::Id, Groups::Name, Groups::Hidden])
        .from(Groups::Table)
        .order_by(Groups::Name, Order::Asc);

    if let Some(id) = id {
        query.and_where(Expr::col(Groups::Id).eq(id));
    }

    all(db, query.to_owned()).await
}

async fn group_from_row<C: ConnectionTrait>(db: &C, row: QueryResult) -> Result<GroupRow> {
    let id: String = row.try_get("", "id")?;
    let name: String = row.try_get("", "name")?;
    let hidden = get_bool_or_default(&row, "hidden", false);

    let devices = all(
        db,
        Query::select()
            .columns([GroupDevices::IntegrationId, GroupDevices::DeviceId])
            .from(GroupDevices::Table)
            .and_where(Expr::col(GroupDevices::GroupId).eq(id.clone()))
            .order_by(GroupDevices::SortOrder, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(group_device_from_row)
    .collect::<Result<Vec<_>>>()?;

    let linked_groups = all(
        db,
        Query::select()
            .column(GroupLinks::ChildGroupId)
            .from(GroupLinks::Table)
            .and_where(Expr::col(GroupLinks::ParentGroupId).eq(id.clone()))
            .order_by(GroupLinks::SortOrder, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(|row| Ok(row.try_get("", "child_group_id")?))
    .collect::<Result<Vec<String>>>()?;

    Ok(GroupRow {
        id,
        name,
        hidden,
        devices,
        linked_groups,
    })
}

async fn upsert_group_on<C: ConnectionTrait>(db: &C, group: &GroupRow) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(Groups::Table)
            .columns([Groups::Id, Groups::Name, Groups::Hidden])
            .values_panic([
                Expr::value(group.id.clone()),
                Expr::value(group.name.clone()),
                Expr::value(group.hidden),
            ])
            .on_conflict(
                OnConflict::column(Groups::Id)
                    .update_columns([Groups::Name, Groups::Hidden])
                    .value(Groups::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    execute(
        db,
        Query::delete()
            .from_table(GroupDevices::Table)
            .and_where(Expr::col(GroupDevices::GroupId).eq(group.id.clone()))
            .to_owned(),
    )
    .await?;
    execute(
        db,
        Query::delete()
            .from_table(GroupLinks::Table)
            .and_where(Expr::col(GroupLinks::ParentGroupId).eq(group.id.clone()))
            .to_owned(),
    )
    .await?;

    for (sort_order, device) in group.devices.iter().enumerate() {
        execute(
            db,
            Query::insert()
                .into_table(GroupDevices::Table)
                .columns([
                    GroupDevices::GroupId,
                    GroupDevices::IntegrationId,
                    GroupDevices::DeviceId,
                    GroupDevices::SortOrder,
                ])
                .values_panic([
                    Expr::value(group.id.clone()),
                    Expr::value(device.integration_id.clone()),
                    Expr::value(device.device_id.clone()),
                    Expr::value(sort_order as i32),
                ])
                .to_owned(),
        )
        .await?;
    }

    for (sort_order, linked_group) in group.linked_groups.iter().enumerate() {
        execute(
            db,
            Query::insert()
                .into_table(GroupLinks::Table)
                .columns([
                    GroupLinks::ParentGroupId,
                    GroupLinks::ChildGroupId,
                    GroupLinks::SortOrder,
                ])
                .values_panic([
                    Expr::value(group.id.clone()),
                    Expr::value(linked_group.clone()),
                    Expr::value(sort_order as i32),
                ])
                .to_owned(),
        )
        .await?;
    }

    Ok(())
}

async fn scene_rows<C: ConnectionTrait>(db: &C, id: Option<&str>) -> Result<Vec<QueryResult>> {
    let mut query = Query::select();
    query
        .columns([Scenes::Id, Scenes::Name, Scenes::Hidden, Scenes::Script])
        .from(Scenes::Table)
        .order_by(Scenes::Name, Order::Asc);

    if let Some(id) = id {
        query.and_where(Expr::col(Scenes::Id).eq(id));
    }

    all(db, query.to_owned()).await
}

async fn scene_from_row<C: ConnectionTrait>(db: &C, row: QueryResult) -> Result<SceneRow> {
    let id: String = row.try_get("", "id")?;
    let name: String = row.try_get("", "name")?;
    let hidden = get_bool_or_default(&row, "hidden", false);
    let script: Option<String> = row.try_get("", "script")?;

    let device_states = all(
        db,
        Query::select()
            .columns([SceneDeviceStates::DeviceKey, SceneDeviceStates::Config])
            .from(SceneDeviceStates::Table)
            .and_where(Expr::col(SceneDeviceStates::SceneId).eq(id.clone()))
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(|row| {
        let key: String = row.try_get("", "device_key")?;
        let config: String = row.try_get("", "config")?;
        Ok((key, parse_json_or_default(&config, "scene device state")))
    })
    .collect::<Result<HashMap<_, _>>>()?;

    let group_state_rows = all(
        db,
        Query::select()
            .columns([SceneGroupStates::GroupId, SceneGroupStates::Config])
            .from(SceneGroupStates::Table)
            .and_where(Expr::col(SceneGroupStates::SceneId).eq(id.clone()))
            .order_by(SceneGroupStates::SortOrder, Order::Asc)
            .order_by(SceneGroupStates::GroupId, Order::Asc)
            .to_owned(),
    )
    .await?;
    let mut group_state_order = Vec::with_capacity(group_state_rows.len());
    let mut group_states = HashMap::with_capacity(group_state_rows.len());
    for row in group_state_rows {
        let key: String = row.try_get("", "group_id")?;
        let config: String = row.try_get("", "config")?;
        group_state_order.push(key.clone());
        group_states.insert(key, parse_json_or_default(&config, "scene group state"));
    }

    Ok(SceneRow {
        id,
        name,
        hidden,
        script,
        device_states,
        group_states,
        group_state_order,
    })
}

async fn upsert_scene_on<C: ConnectionTrait>(db: &C, scene: &SceneRow) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(Scenes::Table)
            .columns([Scenes::Id, Scenes::Name, Scenes::Hidden, Scenes::Script])
            .values_panic([
                Expr::value(scene.id.clone()),
                Expr::value(scene.name.clone()),
                Expr::value(scene.hidden),
                Expr::value(scene.script.clone()),
            ])
            .on_conflict(
                OnConflict::column(Scenes::Id)
                    .update_columns([Scenes::Name, Scenes::Hidden, Scenes::Script])
                    .value(Scenes::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    execute(
        db,
        Query::delete()
            .from_table(SceneDeviceStates::Table)
            .and_where(Expr::col(SceneDeviceStates::SceneId).eq(scene.id.clone()))
            .to_owned(),
    )
    .await?;
    execute(
        db,
        Query::delete()
            .from_table(SceneGroupStates::Table)
            .and_where(Expr::col(SceneGroupStates::SceneId).eq(scene.id.clone()))
            .to_owned(),
    )
    .await?;

    for (device_key, config) in &scene.device_states {
        execute(
            db,
            Query::insert()
                .into_table(SceneDeviceStates::Table)
                .columns([
                    SceneDeviceStates::SceneId,
                    SceneDeviceStates::DeviceKey,
                    SceneDeviceStates::Config,
                ])
                .values_panic([
                    Expr::value(scene.id.clone()),
                    Expr::value(device_key.clone()),
                    Expr::value(serde_json::to_string(config)?),
                ])
                .to_owned(),
        )
        .await?;
    }

    let mut ordered_group_ids = Vec::with_capacity(scene.group_states.len());
    let mut seen_group_ids = HashSet::new();
    for group_id in &scene.group_state_order {
        if scene.group_states.contains_key(group_id) && seen_group_ids.insert(group_id.clone()) {
            ordered_group_ids.push(group_id.clone());
        }
    }
    let mut unordered_group_ids: Vec<_> = scene
        .group_states
        .keys()
        .filter(|group_id| !seen_group_ids.contains(*group_id))
        .cloned()
        .collect();
    unordered_group_ids.sort();
    ordered_group_ids.extend(unordered_group_ids);

    for (sort_order, group_id) in ordered_group_ids.iter().enumerate() {
        let config = &scene.group_states[group_id];
        execute(
            db,
            Query::insert()
                .into_table(SceneGroupStates::Table)
                .columns([
                    SceneGroupStates::SceneId,
                    SceneGroupStates::GroupId,
                    SceneGroupStates::Config,
                    SceneGroupStates::SortOrder,
                ])
                .values_panic([
                    Expr::value(scene.id.clone()),
                    Expr::value(group_id.clone()),
                    Expr::value(serde_json::to_string(config)?),
                    Expr::value(sort_order as i32),
                ])
                .to_owned(),
        )
        .await?;
    }

    Ok(())
}

async fn dashboard_widgets_for_layout<C: ConnectionTrait>(
    db: &C,
    layout_id: i32,
) -> Result<Vec<DashboardWidgetRow>> {
    let rows = all(
        db,
        Query::select()
            .columns([
                DashboardWidgets::Id,
                DashboardWidgets::LayoutId,
                DashboardWidgets::WidgetType,
                DashboardWidgets::Config,
                DashboardWidgets::GridX,
                DashboardWidgets::GridY,
                DashboardWidgets::GridWValue,
                DashboardWidgets::GridHValue,
                DashboardWidgets::SortOrder,
            ])
            .from(DashboardWidgets::Table)
            .and_where(Expr::col(DashboardWidgets::LayoutId).eq(layout_id))
            .order_by(DashboardWidgets::SortOrder, Order::Asc)
            .to_owned(),
    )
    .await?;

    rows.into_iter().map(dashboard_widget_from_row).collect()
}

pub struct DeviceConfigRewritePersistence<'a> {
    pub source_integration_id: &'a str,
    pub source_device_id: &'a str,
    pub replacement_device_key: Option<&'a str>,
    pub changed_groups: &'a [GroupRow],
    pub changed_scenes: &'a [SceneRow],
    pub changed_routines: &'a [RoutineRow],
    pub changed_scene_overrides: &'a [(String, crate::types::scene::SceneDevicesConfig)],
    pub changed_floorplans: &'a [(i32, FloorplanExportRow)],
    pub changed_dashboard_widgets: &'a [DashboardWidgetRow],
    pub changed_calibration_profiles:
        &'a [crate::core::color_calibration::ColorCalibrationProfile],
    pub changed_integrations: &'a [IntegrationRow],
    pub display_override_changed: bool,
    pub moved_display_override: Option<&'a DeviceDisplayNameRow>,
    pub color_calibration_changed: bool,
    pub moved_color_calibration: Option<&'a DeviceColorCalibration>,
    pub moved_calibration_assignment:
        Option<&'a crate::core::color_calibration::ColorCalibrationAssignment>,
    pub sensor_config_changed: bool,
    pub moved_sensor_config: Option<&'a DeviceSensorConfigRow>,
}

/// Persist a complete device-reference rewrite as one database transaction.
///
/// The state actor has already prepared the rewritten rows. Keeping the
/// transaction here means a restart cannot observe a half-migrated set of
/// groups, scenes, metadata, and device rows.
pub async fn db_persist_device_config_rewrite(
    rewrite: DeviceConfigRewritePersistence<'_>,
) -> Result<()> {
    let txn = get_db_connection()?.begin().await?;

    for integration in rewrite.changed_integrations {
        upsert_integration_on(&txn, integration).await?;
    }
    for group in rewrite.changed_groups {
        upsert_group_on(&txn, group).await?;
    }
    for scene in rewrite.changed_scenes {
        upsert_scene_on(&txn, scene).await?;
    }
    for routine in rewrite.changed_routines {
        upsert_routine_on(&txn, routine).await?;
    }
    for (scene_id, overrides) in rewrite.changed_scene_overrides {
        let scene_id = crate::types::scene::SceneId::new(scene_id.clone());
        actions::db_upsert_scene_overrides_on(&txn, &scene_id, overrides).await?;
    }
    for (sort_order, floorplan) in rewrite.changed_floorplans {
        upsert_floorplan_export_on(&txn, floorplan, *sort_order).await?;
    }
    for widget in rewrite.changed_dashboard_widgets {
        upsert_dashboard_widget_on(&txn, widget).await?;
    }
    for profile in rewrite.changed_calibration_profiles {
        calibration::save_profile(&txn, profile).await?;
    }

    if rewrite.display_override_changed {
        delete_by_string_key(
            &txn,
            DeviceDisplayOverrides::Table,
            DeviceDisplayOverrides::DeviceKey,
            &format!(
                "{}/{}",
                rewrite.source_integration_id, rewrite.source_device_id
            ),
        )
        .await?;
        if let Some(replacement_device_key) = rewrite.replacement_device_key {
            delete_by_string_key(
                &txn,
                DeviceDisplayOverrides::Table,
                DeviceDisplayOverrides::DeviceKey,
                replacement_device_key,
            )
            .await?;
        }
        if let Some(row) = rewrite.moved_display_override {
            upsert_device_display_override_on(&txn, row).await?;
        }
    }

    if rewrite.color_calibration_changed {
        let source_key = format!(
            "{}/{}",
            rewrite.source_integration_id, rewrite.source_device_id
        );
        delete_by_string_key(
            &txn,
            DeviceColorCalibrations::Table,
            DeviceColorCalibrations::DeviceKey,
            &source_key,
        )
        .await?;
        delete_by_string_key(
            &txn,
            calibration::CalibrationAssignments::Table,
            calibration::CalibrationAssignments::DeviceKey,
            &source_key,
        )
        .await?;
        if let Some(replacement_device_key) = rewrite.replacement_device_key {
            delete_by_string_key(
                &txn,
                DeviceColorCalibrations::Table,
                DeviceColorCalibrations::DeviceKey,
                replacement_device_key,
            )
            .await?;
            delete_by_string_key(
                &txn,
                calibration::CalibrationAssignments::Table,
                calibration::CalibrationAssignments::DeviceKey,
                replacement_device_key,
            )
            .await?;
        }
        if let Some(row) = rewrite.moved_color_calibration {
            upsert_device_color_calibration_on(&txn, row).await?;
        }
        if let Some(row) = rewrite.moved_calibration_assignment {
            calibration::save_assignment(&txn, row).await?;
        }
    }

    if rewrite.sensor_config_changed {
        let source_key = format!(
            "{}/{}",
            rewrite.source_integration_id, rewrite.source_device_id
        );
        delete_by_string_key(
            &txn,
            DeviceSensorConfigs::Table,
            DeviceSensorConfigs::DeviceRef,
            &source_key,
        )
        .await?;
        if let Some(replacement_device_key) = rewrite.replacement_device_key {
            delete_by_string_key(
                &txn,
                DeviceSensorConfigs::Table,
                DeviceSensorConfigs::DeviceRef,
                replacement_device_key,
            )
            .await?;
        }
        if let Some(row) = rewrite.moved_sensor_config {
            upsert_device_sensor_config_on(&txn, row).await?;
        }
    }

    execute(
        &txn,
        Query::delete()
            .from_table(Devices::Table)
            .and_where(Expr::col(Devices::IntegrationId).eq(rewrite.source_integration_id))
            .and_where(Expr::col(Devices::DeviceId).eq(rewrite.source_device_id))
            .to_owned(),
    )
    .await?;

    txn.commit().await?;
    Ok(())
}

async fn upsert_widget_setting_on<C: ConnectionTrait>(
    db: &C,
    setting: &WidgetSettingRow,
) -> Result<()> {
    let config = serde_json::to_string(&setting.config)?;

    execute(
        db,
        Query::insert()
            .into_table(WidgetSettings::Table)
            .columns([WidgetSettings::Key, WidgetSettings::Config])
            .values_panic([Expr::value(setting.key.clone()), Expr::value(config)])
            .on_conflict(
                OnConflict::column(WidgetSettings::Key)
                    .update_column(WidgetSettings::Config)
                    .value(WidgetSettings::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

async fn insert_widget_setting_on<C: ConnectionTrait>(
    db: &C,
    setting: &WidgetSettingRow,
) -> Result<()> {
    let config = serde_json::to_string(&setting.config)?;

    execute(
        db,
        Query::insert()
            .into_table(WidgetSettings::Table)
            .columns([WidgetSettings::Key, WidgetSettings::Config])
            .values_panic([Expr::value(setting.key.clone()), Expr::value(config)])
            .to_owned(),
    )
    .await?;

    Ok(())
}

async fn next_i32_id<C, T, K>(db: &C, table: T, id_col: K) -> Result<i32>
where
    C: ConnectionTrait,
    T: sea_orm::sea_query::IntoTableRef,
    K: sea_orm::sea_query::IntoColumnRef + Copy,
{
    let row = one(
        db,
        Query::select()
            .column(id_col)
            .from(table)
            .order_by(id_col, Order::Desc)
            .limit(1)
            .to_owned(),
    )
    .await?;

    Ok(row
        .and_then(|row| row.try_get::<i32>("", "id").ok())
        .unwrap_or(0)
        + 1)
}

async fn next_sort_order<C, T, K>(db: &C, table: T, sort_col: K) -> Result<i32>
where
    C: ConnectionTrait,
    T: sea_orm::sea_query::IntoTableRef,
    K: sea_orm::sea_query::IntoColumnRef + Copy,
{
    let row = one(
        db,
        Query::select()
            .column(sort_col)
            .from(table)
            .order_by(sort_col, Order::Desc)
            .limit(1)
            .to_owned(),
    )
    .await?;

    Ok(row
        .and_then(|row| {
            row.try_get::<i32>("", "sort_order")
                .or_else(|_| row.try_get::<i32>("", "version"))
                .ok()
        })
        .unwrap_or(0)
        + 1)
}

fn integration_from_row(row: QueryResult) -> Result<IntegrationRow> {
    let config: String = row.try_get("", "config")?;
    Ok(IntegrationRow {
        id: row.try_get("", "id")?,
        plugin: row.try_get("", "plugin")?,
        config: parse_json_or_default(&config, "integration config"),
        enabled: get_bool_or_default(&row, "enabled", true),
    })
}

fn group_device_from_row(row: QueryResult) -> Result<GroupDeviceRow> {
    Ok(GroupDeviceRow {
        integration_id: row.try_get("", "integration_id")?,
        device_id: row.try_get("", "device_id")?,
    })
}

fn routine_from_row(row: QueryResult) -> Result<RoutineRow> {
    let rules: String = row.try_get("", "rules")?;
    let actions: String = row.try_get("", "actions")?;
    let definition_v2_text: Option<String> = row.try_get("", "definition_v2")?;
    Ok(RoutineRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        enabled: get_bool_or_default(&row, "enabled", true),
        semantics_version: get_i32_or_default(&row, "semantics_version", 1),
        revision: get_i64_or_default(&row, "revision", 1),
        // A malformed body is preserved verbatim as a JSON string so it stays
        // visible/quarantined and is never silently reinterpreted.
        definition_v2: definition_v2_text
            .map(|text| serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text))),
        rules: parse_json_or_default(&rules, "routine rules"),
        actions: parse_json_or_default(&actions, "routine actions"),
    })
}

fn helper_from_row(row: QueryResult) -> Result<HelperDefinition> {
    let id: String = row.try_get("", "id")?;
    let kind_json: String = row.try_get("", "kind")?;
    let initial_value_json: String = row.try_get("", "initial_value")?;
    let persistence: String = row.try_get("", "persistence")?;

    let kind: HelperKind = serde_json::from_str(&kind_json)
        .map_err(|error| eyre!("Failed to parse helper kind for '{id}': {error}"))?;
    // Preserve a malformed initial value verbatim so it stays visible instead
    // of being silently replaced during export/import round-trips.
    let initial_value: serde_json::Value = serde_json::from_str(&initial_value_json)
        .unwrap_or(serde_json::Value::String(initial_value_json));

    Ok(HelperDefinition {
        id: HelperId(id),
        name: row.try_get("", "name")?,
        kind,
        initial_value,
        persistence: parse_helper_persistence(&persistence),
        hidden: row.try_get::<Option<bool>>("", "hidden")?,
    })
}

fn source_from_row(row: QueryResult) -> Result<SourceDefinition> {
    let id: String = row.try_get("", "id")?;
    let aliases_json: String = row.try_get("", "aliases")?;
    let compute_json: String = row.try_get("", "compute")?;

    let aliases: Vec<crate::types::device::DeviceKey> = serde_json::from_str(&aliases_json)
        .map_err(|error| eyre!("Failed to parse aliases for source '{id}': {error}"))?;
    let compute: SourceCompute = serde_json::from_str(&compute_json)
        .map_err(|error| eyre!("Failed to parse compute for source '{id}': {error}"))?;

    Ok(SourceDefinition {
        id: crate::types::automation_definition::SourceId(id),
        name: row.try_get("", "name")?,
        enabled: row.try_get("", "enabled")?,
        revision: row.try_get("", "revision")?,
        timezone: row.try_get("", "timezone")?,
        refresh_interval_ms: get_u64(&row, "refresh_interval_ms")
            .unwrap_or(crate::types::automation_source::DEFAULT_SOURCE_REFRESH_INTERVAL_MS),
        aliases,
        compute,
    })
}

fn helper_state_from_row(row: QueryResult) -> Result<HelperValueExportRow> {
    let value: String = row.try_get("", "value")?;
    Ok(HelperValueExportRow {
        id: row.try_get("", "helper_id")?,
        value: parse_json_or_default(&value, "helper state value"),
        revision: get_i64_or_default(&row, "revision", 0),
    })
}

fn helper_persistence_as_str(persistence: HelperPersistence) -> &'static str {
    match persistence {
        HelperPersistence::Durable => "durable",
        HelperPersistence::Session => "session",
    }
}

fn parse_helper_persistence(value: &str) -> HelperPersistence {
    match value {
        "session" => HelperPersistence::Session,
        _ => HelperPersistence::Durable,
    }
}

fn floorplan_from_row(row: QueryResult) -> Result<FloorplanRow> {
    Ok(FloorplanRow {
        image_data: row.try_get("", "image_data")?,
        image_mime_type: row.try_get("", "image_mime_type")?,
        width: row.try_get("", "width")?,
        height: row.try_get("", "height")?,
    })
}

fn floorplan_metadata_from_row(row: QueryResult) -> Result<FloorplanMetadataRow> {
    Ok(FloorplanMetadataRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
    })
}

fn floorplan_export_from_row(row: QueryResult) -> Result<FloorplanExportRow> {
    Ok(FloorplanExportRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        image_data: row.try_get("", "image_data")?,
        image_mime_type: row.try_get("", "image_mime_type")?,
        width: row.try_get("", "width")?,
        height: row.try_get("", "height")?,
        grid_data: row.try_get("", "grid_data")?,
    })
}

fn group_position_from_row(row: QueryResult) -> Result<GroupPositionRow> {
    Ok(GroupPositionRow {
        group_id: row.try_get("", "group_id")?,
        x: get_f32(&row, "x")?,
        y: get_f32(&row, "y")?,
        width: get_f32(&row, "width")?,
        height: get_f32(&row, "height")?,
        z_index: row.try_get("", "z_index")?,
    })
}

fn dashboard_layout_from_row(row: QueryResult) -> Result<DashboardLayoutRow> {
    Ok(DashboardLayoutRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        is_default: get_bool_or_default(&row, "is_default", false),
    })
}

fn dashboard_widget_from_row(row: QueryResult) -> Result<DashboardWidgetRow> {
    let config: String = row.try_get("", "config")?;
    Ok(DashboardWidgetRow {
        id: row.try_get("", "id")?,
        layout_id: row.try_get("", "layout_id")?,
        widget_type: row.try_get("", "widget_type")?,
        config: parse_json_or_default(&config, "dashboard widget config"),
        grid_x: row.try_get("", "grid_x")?,
        grid_y: row.try_get("", "grid_y")?,
        grid_w: get_f32(&row, "grid_w_value")?,
        grid_h: get_f32(&row, "grid_h_value")?,
        sort_order: get_i32_or_default(&row, "sort_order", 0),
    })
}

fn widget_setting_from_row(row: QueryResult) -> Result<WidgetSettingRow> {
    let config: String = row.try_get("", "config")?;
    Ok(WidgetSettingRow {
        key: row.try_get("", "key")?,
        config: parse_json_or_default(&config, "widget setting config"),
    })
}

fn device_display_name_from_row(row: QueryResult) -> Result<DeviceDisplayNameRow> {
    Ok(DeviceDisplayNameRow {
        device_key: row.try_get("", "device_key")?,
        display_name: row.try_get("", "display_name")?,
    })
}

fn device_sensor_config_from_row(row: QueryResult) -> Result<DeviceSensorConfigRow> {
    let config_json: String = row.try_get("", "config_json")?;
    Ok(DeviceSensorConfigRow {
        device_ref: row.try_get("", "device_ref")?,
        interaction_kind: row.try_get("", "interaction_kind")?,
        config: parse_json_or_default(&config_json, "device sensor config"),
    })
}

fn parse_json_or_default<T>(json: &str, context: &str) -> T
where
    T: DeserializeOwned + Default,
{
    match serde_json::from_str(json) {
        Ok(value) => value,
        Err(error) => {
            warn!("Failed to parse {context}: {error}");
            T::default()
        }
    }
}

fn get_bool_or_default(row: &QueryResult, column: &str, default: bool) -> bool {
    row.try_get::<Option<bool>>("", column)
        .ok()
        .flatten()
        .unwrap_or(default)
}

fn get_i32_or_default(row: &QueryResult, column: &str, default: i32) -> i32 {
    row.try_get::<Option<i32>>("", column)
        .ok()
        .flatten()
        .unwrap_or(default)
}

fn get_i64_or_default(row: &QueryResult, column: &str, default: i64) -> i64 {
    row.try_get::<Option<i64>>("", column)
        .ok()
        .flatten()
        .unwrap_or(default)
}

fn get_u64(row: &QueryResult, column: &str) -> Option<u64> {
    row.try_get::<Option<i64>>("", column)
        .ok()
        .flatten()
        .and_then(|value| u64::try_from(value).ok())
}

fn get_f32(row: &QueryResult, column: &str) -> Result<f32> {
    match row.try_get::<f32>("", column) {
        Ok(value) => Ok(value),
        Err(_) => {
            let value: f64 = row.try_get("", column)?;
            Ok(value as f32)
        }
    }
}

fn default_floorplan_name(id: &str) -> &str {
    if id == "default" {
        "Main floorplan"
    } else {
        id
    }
}

fn is_empty_default_floorplan_stub(floorplan: &FloorplanExportRow) -> bool {
    floorplan.id == "default"
        && floorplan.name == "Main floorplan"
        && floorplan.image_data.is_none()
        && floorplan.image_mime_type.is_none()
        && floorplan.width.is_none()
        && floorplan.height.is_none()
        && floorplan.grid_data.is_none()
}

// ============================================================================
// Assistant conversation threads
// ============================================================================

/// Newest-first list cap for the assistant panel.
pub const ASSISTANT_THREAD_LIST_LIMIT: u64 = 20;

pub async fn db_list_assistant_threads() -> Result<Vec<AssistantThreadSummary>> {
    let db = get_db_connection()?;
    let rows = all(
        db,
        Query::select()
            .columns([
                AssistantThreads::Id,
                AssistantThreads::Name,
                AssistantThreads::UpdatedAtMs,
                AssistantThreads::Messages,
            ])
            .from(AssistantThreads::Table)
            .order_by(AssistantThreads::UpdatedAtMs, Order::Desc)
            .limit(ASSISTANT_THREAD_LIST_LIMIT)
            .to_owned(),
    )
    .await?;

    rows.into_iter()
        .map(assistant_thread_summary_from_row)
        .collect()
}

pub async fn db_load_assistant_thread(id: &str) -> Result<Option<AssistantThread>> {
    let db = get_db_connection()?;
    let row = one(
        db,
        Query::select()
            .columns([
                AssistantThreads::Id,
                AssistantThreads::Name,
                AssistantThreads::CreatedAtMs,
                AssistantThreads::UpdatedAtMs,
                AssistantThreads::Messages,
            ])
            .from(AssistantThreads::Table)
            .and_where(Expr::col(AssistantThreads::Id).eq(id))
            .to_owned(),
    )
    .await?;

    row.map(assistant_thread_from_row).transpose()
}

pub async fn db_save_assistant_thread(thread: &AssistantThread) -> Result<()> {
    let db = get_db_connection()?;
    let messages = serde_json::to_string(&thread.messages)?;

    execute(
        db,
        Query::insert()
            .into_table(AssistantThreads::Table)
            .columns([
                AssistantThreads::Id,
                AssistantThreads::Name,
                AssistantThreads::CreatedAtMs,
                AssistantThreads::UpdatedAtMs,
                AssistantThreads::Messages,
            ])
            .values_panic([
                Expr::value(thread.id.clone()),
                Expr::value(thread.name.clone()),
                Expr::value(thread.created_at_ms),
                Expr::value(thread.updated_at_ms),
                Expr::value(messages),
            ])
            .on_conflict(
                OnConflict::column(AssistantThreads::Id)
                    .update_columns([
                        AssistantThreads::Name,
                        AssistantThreads::UpdatedAtMs,
                        AssistantThreads::Messages,
                    ])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn db_delete_assistant_thread(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, AssistantThreads::Table, AssistantThreads::Id, id).await
}

fn assistant_thread_summary_from_row(row: QueryResult) -> Result<AssistantThreadSummary> {
    let messages: String = row.try_get("", "messages")?;
    let messages: Vec<AssistantHistoryMessage> =
        serde_json::from_str(&messages).unwrap_or_default();
    Ok(AssistantThreadSummary {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        updated_at_ms: row.try_get("", "updated_at_ms")?,
        message_count: messages.len(),
    })
}

fn assistant_thread_from_row(row: QueryResult) -> Result<AssistantThread> {
    let messages: String = row.try_get("", "messages")?;
    Ok(AssistantThread {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        created_at_ms: row.try_get("", "created_at_ms")?,
        updated_at_ms: row.try_get("", "updated_at_ms")?,
        messages: serde_json::from_str(&messages).unwrap_or_default(),
    })
}

// ============================================================================
// Routine history
// ============================================================================

pub async fn db_value_history(source_key: &str, path: &str) -> Result<Vec<ValueHistoryEntry>> {
    value_history_on(get_db_connection()?, source_key, path).await
}

async fn value_history_on<C: ConnectionTrait>(
    db: &C,
    source_key: &str,
    path: &str,
) -> Result<Vec<ValueHistoryEntry>> {
    let rows = all(
        db,
        Query::select()
            .columns([ValueHistory::ChangedAtMs, ValueHistory::Value])
            .from(ValueHistory::Table)
            .and_where(Expr::col(ValueHistory::SourceKey).eq(source_key))
            .and_where(Expr::col(ValueHistory::Path).eq(path))
            .order_by(ValueHistory::Id, Order::Desc)
            .limit(100)
            .to_owned(),
    )
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let changed_at_ms = row.try_get("", "changed_at_ms").ok()?;
            let text: String = row.try_get("", "value").ok()?;
            Some(ValueHistoryEntry {
                changed_at_ms,
                value: serde_json::from_str(&text).ok()?,
            })
        })
        .collect())
}

pub async fn db_record_value_change(
    source_key: &str,
    path: &str,
    value: &serde_json::Value,
    changed_at_ms: i64,
) -> Result<()> {
    record_value_change_on(get_db_connection()?, source_key, path, value, changed_at_ms).await
}

pub async fn db_delete_value_history(source_key: &str) -> Result<()> {
    execute(
        get_db_connection()?,
        Query::delete()
            .from_table(ValueHistory::Table)
            .and_where(Expr::col(ValueHistory::SourceKey).eq(source_key))
            .to_owned(),
    )
    .await?;
    Ok(())
}

async fn record_value_change_on<C: ConnectionTrait>(
    db: &C,
    source_key: &str,
    path: &str,
    value: &serde_json::Value,
    changed_at_ms: i64,
) -> Result<()> {
    let recent = all(
        db,
        Query::select()
            .columns([ValueHistory::Id, ValueHistory::Value])
            .from(ValueHistory::Table)
            .and_where(Expr::col(ValueHistory::SourceKey).eq(source_key))
            .and_where(Expr::col(ValueHistory::Path).eq(path))
            .order_by(ValueHistory::Id, Order::Desc)
            .limit(100)
            .to_owned(),
    )
    .await?;
    if recent
        .first()
        .and_then(|row| row.try_get::<String>("", "value").ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .as_ref()
        == Some(value)
    {
        return Ok(());
    }
    execute(
        db,
        Query::insert()
            .into_table(ValueHistory::Table)
            .columns([
                ValueHistory::SourceKey,
                ValueHistory::Path,
                ValueHistory::ChangedAtMs,
                ValueHistory::Value,
            ])
            .values_panic([
                Expr::value(source_key),
                Expr::value(path),
                Expr::value(changed_at_ms),
                Expr::value(serde_json::to_string(value)?),
            ])
            .to_owned(),
    )
    .await?;
    if recent.len() == 100 {
        let boundary: i64 = recent[98].try_get("", "id")?;
        execute(
            db,
            Query::delete()
                .from_table(ValueHistory::Table)
                .and_where(Expr::col(ValueHistory::SourceKey).eq(source_key))
                .and_where(Expr::col(ValueHistory::Path).eq(path))
                .and_where(Expr::col(ValueHistory::Id).lt(boundary))
                .to_owned(),
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod value_history_tests {
    use super::*;
    use sea_orm::{Database, DbBackend};

    #[tokio::test]
    async fn stores_only_changes_and_keeps_the_latest_hundred_per_field() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute(Statement::from_string(DbBackend::Sqlite,
            "CREATE TABLE value_history (id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL, path TEXT NOT NULL, changed_at_ms BIGINT NOT NULL, value TEXT NOT NULL)".to_string())).await.unwrap();
        for index in 0..103 {
            let value = serde_json::json!(index);
            record_value_change_on(&db, "dummy/sensor", "/value", &value, index)
                .await
                .unwrap();
            record_value_change_on(&db, "dummy/sensor", "/value", &value, index + 1)
                .await
                .unwrap();
        }
        record_value_change_on(
            &db,
            "dummy/sensor",
            "/other",
            &serde_json::json!("separate"),
            1,
        )
        .await
        .unwrap();
        let rows = value_history_on(&db, "dummy/sensor", "/value")
            .await
            .unwrap();
        assert_eq!(rows.len(), 100);
        assert_eq!(rows[0].value, serde_json::json!(102));
        assert_eq!(rows[99].value, serde_json::json!(3));
        assert_eq!(
            value_history_on(&db, "dummy/sensor", "/other")
                .await
                .unwrap()
                .len(),
            1
        );
    }
}

/// Persisted routine history rows kept in the database. The in-memory ring
/// uses the same bound, so a restart restores exactly the buffered window.
pub const ROUTINE_HISTORY_PERSIST_LIMIT: u64 = 500;

/// Newest history entries, newest first.
pub async fn db_list_routine_history(limit: u64) -> Result<Vec<RoutineHistoryEntry>> {
    list_routine_history_on(get_db_connection()?, limit).await
}

async fn list_routine_history_on<C: ConnectionTrait>(
    db: &C,
    limit: u64,
) -> Result<Vec<RoutineHistoryEntry>> {
    let rows = all(
        db,
        Query::select()
            .columns([
                RoutineHistory::Id,
                RoutineHistory::Timestamp,
                RoutineHistory::Entry,
            ])
            .from(RoutineHistory::Table)
            .order_by(RoutineHistory::Timestamp, Order::Desc)
            .limit(limit)
            .to_owned(),
    )
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            // A malformed row must not poison startup: skip it and keep the rest.
            let entry: String = row.try_get("", "entry").ok()?;
            serde_json::from_str(&entry).ok()
        })
        .collect())
}

pub async fn db_save_routine_history_entry(entry: &RoutineHistoryEntry) -> Result<()> {
    save_routine_history_entry_on(get_db_connection()?, entry).await
}

async fn save_routine_history_entry_on<C: ConnectionTrait>(
    db: &C,
    entry: &RoutineHistoryEntry,
) -> Result<()> {
    let payload = serde_json::to_string(entry)?;
    execute(
        db,
        Query::insert()
            .into_table(RoutineHistory::Table)
            .columns([
                RoutineHistory::Id,
                RoutineHistory::Timestamp,
                RoutineHistory::Entry,
            ])
            .values_panic([
                Expr::value(entry.id.clone()),
                Expr::value(entry.timestamp.clone()),
                Expr::value(payload),
            ])
            .on_conflict(
                OnConflict::column(RoutineHistory::Id)
                    .update_columns([RoutineHistory::Timestamp, RoutineHistory::Entry])
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

/// Drop all but the newest `keep` entries. Returns whether anything was
/// removed.
pub async fn db_prune_routine_history(keep: u64) -> Result<bool> {
    prune_routine_history_on(get_db_connection()?, keep).await
}

async fn prune_routine_history_on<C: ConnectionTrait>(db: &C, keep: u64) -> Result<bool> {
    let row = one(
        db,
        Query::select()
            .column(RoutineHistory::Timestamp)
            .from(RoutineHistory::Table)
            .order_by(RoutineHistory::Timestamp, Order::Desc)
            .limit(1)
            .offset(keep)
            .to_owned(),
    )
    .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    let cutoff: String = row.try_get("", "timestamp")?;

    let deleted = execute(
        db,
        Query::delete()
            .from_table(RoutineHistory::Table)
            .and_where(Expr::col(RoutineHistory::Timestamp).lte(cutoff))
            .to_owned(),
    )
    .await?;

    Ok(deleted > 0)
}

#[cfg(test)]
mod consistency_tests {
    use super::*;
    use sea_orm::{Database, DatabaseConnection, DbBackend};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;

    async fn database() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn routine_history_round_trips_and_prunes_to_newest_entries() {
        use crate::types::routine_history::{RoutineHistoryEntry, RoutineHistoryTriggerKind};
        use crate::types::rule::RoutineId;

        let db = database().await;
        for index in 0..5 {
            let entry = RoutineHistoryEntry {
                id: index.to_string(),
                timestamp: format!("2026-01-01T00:00:0{index}Z"),
                routine_id: RoutineId(format!("routine-{index}")),
                routine_name: format!("Routine {index}"),
                trigger_kind: RoutineHistoryTriggerKind::V2Run,
                event_source_device_key: None,
                action_count: index as usize,
                status: None,
                v2: None,
            };
            save_routine_history_entry_on(&db, &entry).await.unwrap();
        }

        let listed = list_routine_history_on(&db, 3).await.unwrap();
        let ids: Vec<&str> = listed.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, vec!["4", "3", "2"]);
        assert_eq!(listed[0].routine_name, "Routine 4");

        assert!(prune_routine_history_on(&db, 3).await.unwrap());
        let listed = list_routine_history_on(&db, 10).await.unwrap();
        let ids: Vec<&str> = listed.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, vec!["4", "3", "2"]);
        assert!(!prune_routine_history_on(&db, 3).await.unwrap());
    }

    #[tokio::test]
    async fn color_calibration_database_export_import_round_trip() {
        let source = database().await;
        let row: DeviceColorCalibration = serde_json::from_value(json!({
            "device_key": "mqtt/lamp", "points": [
                {"reference":{"u":0.20,"v":0.47},"output":{"u":0.21,"v":0.48}},
                {"reference":{"u":0.30,"v":0.52},"output":{"u":0.29,"v":0.51}}
            ]
        }))
        .unwrap();
        upsert_device_color_calibration_on(&source, &row)
            .await
            .unwrap();
        let export = db_export_config_from_connection(&source).await.unwrap();
        let json = serde_json::to_value(&export).unwrap();
        let restored: ConfigExport = serde_json::from_value(json.clone()).unwrap();
        let target = database().await;
        replace_device_color_calibrations_on(&target, &restored.device_color_calibrations)
            .await
            .unwrap();
        let reexport = db_export_config_from_connection(&target).await.unwrap();
        assert_eq!(
            serde_json::to_value(&reexport.device_color_calibrations).unwrap(),
            json["device_color_calibrations"]
        );
        let mut legacy = json;
        legacy
            .as_object_mut()
            .unwrap()
            .remove("device_color_calibrations");
        let legacy: ConfigExport = serde_json::from_value(legacy).unwrap();
        assert!(legacy.device_color_calibrations.is_empty());
        replace_device_color_calibrations_on(&target, &legacy.device_color_calibrations)
            .await
            .unwrap();
        assert!(db_export_config_from_connection(&target)
            .await
            .unwrap()
            .device_color_calibrations
            .is_empty());
    }
    // P05: helper definitions and durable values survive export/import, and
    // session values never leave the process. Omitting the new fields in an
    // older export stays backward compatible.
    #[tokio::test]
    async fn helper_definitions_and_durable_values_round_trip() {
        let source = database().await;
        let mode = HelperDefinition {
            id: HelperId("mode".to_string()),
            name: "Mode".to_string(),
            kind: HelperKind::Enum {
                options: vec!["day".to_string(), "night".to_string()],
            },
            initial_value: json!("day"),
            persistence: HelperPersistence::Durable,
            hidden: None,
        };
        let scratch = HelperDefinition {
            id: HelperId("scratch".to_string()),
            name: "Scratch".to_string(),
            kind: HelperKind::String,
            initial_value: json!(""),
            persistence: HelperPersistence::Session,
            hidden: None,
        };
        for helper in [&mode, &scratch] {
            upsert_helper_on(&source, helper).await.unwrap();
        }
        upsert_helper_state_on(&source, "mode", &json!("night"), 4)
            .await
            .unwrap();
        upsert_helper_state_on(&source, "scratch", &json!("temporary"), 1)
            .await
            .unwrap();

        let export = db_export_config_from_connection(&source).await.unwrap();
        assert_eq!(export.helpers.len(), 2);
        assert_eq!(export.helper_values.len(), 1);
        assert_eq!(export.helper_values[0].id, "mode");
        assert_eq!(export.helper_values[0].value, json!("night"));
        assert_eq!(export.helper_values[0].revision, 4);

        let target = database().await;
        for helper in &export.helpers {
            upsert_helper_on(&target, helper).await.unwrap();
        }
        for state in &export.helper_values {
            upsert_helper_state_on(&target, &state.id, &state.value, state.revision)
                .await
                .unwrap();
        }
        let reexport = db_export_config_from_connection(&target).await.unwrap();
        assert_eq!(
            serde_json::to_value(&reexport.helpers).unwrap(),
            serde_json::to_value(&export.helpers).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&reexport.helper_values).unwrap(),
            serde_json::to_value(&export.helper_values).unwrap()
        );
        assert_eq!(
            helpers_on(&target).await.unwrap().len(),
            2,
            "definitions are queryable"
        );

        let mut legacy = serde_json::to_value(&export).unwrap();
        let object = legacy.as_object_mut().unwrap();
        object.remove("helpers");
        object.remove("helper_values");
        let legacy: ConfigExport = serde_json::from_value(legacy).unwrap();
        assert!(legacy.helpers.is_empty());
        assert!(legacy.helper_values.is_empty());
    }

    fn routine(id: &str, target: &str) -> RoutineRow {
        RoutineRow {
            id: id.into(),
            name: id.into(),
            enabled: true,
            rules: json!([]),
            actions: json!([{ "action": "ActivateScene", "scene_id": target }]),
            ..Default::default()
        }
    }
    async fn sql(db: &DatabaseConnection, statement: &str) {
        db.execute(Statement::from_string(DbBackend::Sqlite, statement))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn routine_rename_failure_rolls_back_new_row_and_references() {
        let db = database().await;
        upsert_routine_on(&db, &routine("old", "old"))
            .await
            .unwrap();
        upsert_routine_on(&db, &routine("caller", "old"))
            .await
            .unwrap();
        sql(&db, "CREATE TRIGGER reject_caller BEFORE INSERT ON routines WHEN NEW.id = 'caller' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").await;
        assert!(
            replace_routines_on(&db, &[routine("new", "new"), routine("caller", "new")],)
                .await
                .is_err()
        );
        let export = db_export_config_from_connection(&db).await.unwrap();
        assert!(export.routines.iter().any(|row| row.id == "old"));
        assert!(!export.routines.iter().any(|row| row.id == "new"));
        assert_eq!(
            export
                .routines
                .iter()
                .find(|row| row.id == "caller")
                .unwrap()
                .actions,
            routine("caller", "old").actions
        );
        sql(&db, "DROP TRIGGER reject_caller").await;
        replace_routines_on(&db, &[routine("new", "new"), routine("caller", "new")])
            .await
            .unwrap();
        let export = db_export_config_from_connection(&db).await.unwrap();
        assert!(!export.routines.iter().any(|row| row.id == "old"));
        assert_eq!(export.routines.len(), 2);
        assert_eq!(
            export
                .routines
                .iter()
                .find(|row| row.id == "caller")
                .unwrap()
                .actions,
            routine("caller", "new").actions
        );
    }

    #[tokio::test]
    async fn service_setting_failure_rolls_back_core_and_prior_settings() {
        let db = database().await;
        let before = db_export_config_from_connection(&db).await.unwrap();
        sql(&db, "CREATE TRIGGER reject_setting BEFORE INSERT ON widget_settings WHEN NEW.key = 'blocked' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").await;
        let settings = [
            WidgetSettingRow {
                key: "first".into(),
                config: json!({"url":"fixture"}),
            },
            WidgetSettingRow {
                key: "blocked".into(),
                config: json!({}),
            },
        ];
        assert!(update_core_settings_on(
            &db,
            &CoreConfigRow {
                warmup_time_seconds: 123,
                default_transition_ms: None,
                scene_transition_ms: None,
            },
            &settings
        )
        .await
        .is_err());
        let after = db_export_config_from_connection(&db).await.unwrap();
        assert_eq!(
            after.core.warmup_time_seconds,
            before.core.warmup_time_seconds
        );
        assert!(!after.widget_settings.iter().any(|row| row.key == "first"));
        sql(&db, "DROP TRIGGER reject_setting").await;
        update_core_settings_on(
            &db,
            &CoreConfigRow {
                warmup_time_seconds: 123,
                default_transition_ms: Some(1000),
                scene_transition_ms: Some(1000),
            },
            &settings,
        )
        .await
        .unwrap();
        let after = db_export_config_from_connection(&db).await.unwrap();
        assert_eq!(after.core.warmup_time_seconds, 123);
        assert_eq!(after.core.default_transition_ms, Some(1000));
        assert_eq!(after.core.scene_transition_ms, Some(1000));
        assert!(after.widget_settings.iter().any(|row| row.key == "first"));
    }

    // P10: named timer jobs are upserted/deleted per owner+key and are never
    // part of the config export; an import clears previously acknowledged
    // jobs so they cannot resume.
    #[tokio::test]
    async fn timer_jobs_upsert_delete_and_import_clears() {
        let db = database().await;
        let job = TimerJobRow {
            routine_id: "routine".into(),
            timer_id: "off".into(),
            definition_revision: 2,
            generation: 41,
            due_wall_ms: 5_000,
            capture: Some(r#"{"targets":[],"frozen_members":[]}"#.into()),
        };
        upsert_timer_job_on(&db, &job).await.unwrap();

        let rows = timer_jobs_on(&db).await.unwrap();
        assert_eq!(rows, vec![job.clone()]);

        let replaced = TimerJobRow {
            generation: 42,
            due_wall_ms: 9_000,
            ..job.clone()
        };
        upsert_timer_job_on(&db, &replaced).await.unwrap();
        assert_eq!(timer_jobs_on(&db).await.unwrap(), vec![replaced.clone()]);

        let other = TimerJobRow {
            timer_id: "morning".into(),
            ..job.clone()
        };
        upsert_timer_job_on(&db, &other).await.unwrap();
        assert_eq!(timer_jobs_on(&db).await.unwrap().len(), 2);

        assert!(delete_timer_job_on(&db, "routine", "off").await.unwrap());
        assert!(!delete_timer_job_on(&db, "routine", "off").await.unwrap());
        assert_eq!(timer_jobs_on(&db).await.unwrap(), vec![other]);

        let export = db_export_config_from_connection(&db).await.unwrap();
        let json = serde_json::to_value(&export).unwrap();
        assert!(
            !json.as_object().unwrap().contains_key("timer_jobs"),
            "timer jobs are runtime state, not exported configuration"
        );

        clear_timer_jobs_on(&db).await.unwrap();
        assert!(timer_jobs_on(&db).await.unwrap().is_empty());
    }
}

fn device_color_calibration_from_row(row: QueryResult) -> Result<DeviceColorCalibration> {
    let points: String = row.try_get("", "points")?;
    let calibration = DeviceColorCalibration {
        device_key: row.try_get("", "device_key")?,
        points: serde_json::from_str(&points)?,
    };
    calibration.validate().map_err(|error| eyre!(error))?;
    Ok(calibration)
}
