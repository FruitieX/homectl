//! Database queries for configuration entities.
//!
//! This module keeps the public configuration row types stable while executing
//! all runtime persistence through SeaORM/SeaQuery builders so the same code can
//! target SQLite and PostgreSQL.

use super::get_db_connection;
use super::schema::{
    ConfigVersions, CoreConfig, DashboardLayouts, DashboardWidgets, DeviceDisplayOverrides,
    DeviceSensorConfigs, Floorplans, GroupDevices, GroupLinks, GroupPositions, Groups,
    Integrations, Routines, SceneDeviceStates, SceneGroupStates, SceneOverrides, Scenes,
    WidgetSettings,
};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub rules: serde_json::Value,
    pub actions: serde_json::Value,
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
    pub grid_w: i32,
    pub grid_h: i32,
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
}

impl Default for CoreConfigRow {
    fn default() -> Self {
        Self {
            warmup_time_seconds: default_warmup_time_seconds(),
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

/// Full config export structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigExport {
    pub version: i32,
    pub core: CoreConfigRow,
    pub integrations: Vec<IntegrationRow>,
    pub groups: Vec<GroupRow>,
    pub scenes: Vec<SceneRow>,
    pub routines: Vec<RoutineRow>,
    pub floorplan: Option<FloorplanRow>,
    #[serde(default)]
    pub floorplans: Vec<FloorplanExportRow>,
    #[serde(default)]
    pub group_positions: Vec<GroupPositionRow>,
    #[serde(default)]
    pub device_display_overrides: Vec<DeviceDisplayNameRow>,
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
                .from(CoreConfig::Table)
                .and_where(Expr::col(CoreConfig::Id).eq(1))
                .to_owned(),
        ))
        .await?;

    Ok(row.map(|row| CoreConfigRow {
        warmup_time_seconds: get_i32_or_default(&row, "warmup_time_seconds", 1),
    }))
}

pub async fn db_update_core_config(config: &CoreConfigRow) -> Result<()> {
    let db = get_db_connection()?;

    execute(
        db,
        Query::update()
            .table(CoreConfig::Table)
            .value(
                CoreConfig::WarmupTimeSeconds,
                Expr::value(config.warmup_time_seconds),
            )
            .value(CoreConfig::UpdatedAt, Expr::current_timestamp())
            .and_where(Expr::col(CoreConfig::Id).eq(1))
            .to_owned(),
    )
    .await?;

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
    let db = get_db_connection()?;
    let rules = serde_json::to_string(&routine.rules)?;
    let actions = serde_json::to_string(&routine.actions)?;

    execute(
        db,
        Query::insert()
            .into_table(Routines::Table)
            .columns([
                Routines::Id,
                Routines::Name,
                Routines::Enabled,
                Routines::Rules,
                Routines::Actions,
            ])
            .values_panic([
                Expr::value(routine.id.clone()),
                Expr::value(routine.name.clone()),
                Expr::value(routine.enabled),
                Expr::value(rules),
                Expr::value(actions),
            ])
            .on_conflict(
                OnConflict::column(Routines::Id)
                    .update_columns([
                        Routines::Name,
                        Routines::Enabled,
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

pub async fn db_delete_routine(id: &str) -> Result<bool> {
    let db = get_db_connection()?;
    delete_by_string_key(db, Routines::Table, Routines::Id, id).await
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
                .value(DashboardWidgets::GridW, Expr::value(widget.grid_w))
                .value(DashboardWidgets::GridH, Expr::value(widget.grid_h))
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
                    DashboardWidgets::GridW,
                    DashboardWidgets::GridH,
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
            .from(CoreConfig::Table)
            .and_where(Expr::col(CoreConfig::Id).eq(1))
            .to_owned(),
    )
    .await?
    .map(|row| CoreConfigRow {
        warmup_time_seconds: get_i32_or_default(&row, "warmup_time_seconds", 1),
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
        floorplan,
        floorplans,
        group_positions,
        device_display_overrides,
        device_sensor_configs,
        widget_settings,
        dashboard_layouts,
        dashboard_widgets,
    })
}

pub async fn db_import_config(config: &ConfigExport) -> Result<()> {
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
    for device_sensor_config in &config.device_sensor_configs {
        db_upsert_device_sensor_config(device_sensor_config).await?;
    }
    for layout in &config.dashboard_layouts {
        db_upsert_dashboard_layout(layout).await?;
    }
    for widget in &config.dashboard_widgets {
        db_upsert_dashboard_widget(widget).await?;
    }

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
        || !db_get_group_positions().await?.is_empty()
        || !db_get_device_display_overrides().await?.is_empty()
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

    let group_states = all(
        db,
        Query::select()
            .columns([SceneGroupStates::GroupId, SceneGroupStates::Config])
            .from(SceneGroupStates::Table)
            .and_where(Expr::col(SceneGroupStates::SceneId).eq(id.clone()))
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(|row| {
        let key: String = row.try_get("", "group_id")?;
        let config: String = row.try_get("", "config")?;
        Ok((key, parse_json_or_default(&config, "scene group state")))
    })
    .collect::<Result<HashMap<_, _>>>()?;

    Ok(SceneRow {
        id,
        name,
        hidden,
        script,
        device_states,
        group_states,
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

    for (group_id, config) in &scene.group_states {
        execute(
            db,
            Query::insert()
                .into_table(SceneGroupStates::Table)
                .columns([
                    SceneGroupStates::SceneId,
                    SceneGroupStates::GroupId,
                    SceneGroupStates::Config,
                ])
                .values_panic([
                    Expr::value(scene.id.clone()),
                    Expr::value(group_id.clone()),
                    Expr::value(serde_json::to_string(config)?),
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
                DashboardWidgets::GridW,
                DashboardWidgets::GridH,
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
    Ok(RoutineRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        enabled: get_bool_or_default(&row, "enabled", true),
        rules: parse_json_or_default(&rules, "routine rules"),
        actions: parse_json_or_default(&actions, "routine actions"),
    })
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
        grid_w: row.try_get("", "grid_w")?,
        grid_h: row.try_get("", "grid_h")?,
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
