//! Database queries for configuration entities
//!
//! This module provides CRUD operations for all configuration stored in PostgreSQL:
//! - Integrations
//! - Groups (with devices and links)
//! - Scenes (with device and group states)
//! - Routines
//! - Floorplan and device positions
//! - Dashboard layouts and widgets
//! - Config import/export

use super::get_db_connection;
use color_eyre::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
pub struct CoreConfigRow {
    pub warmup_time_seconds: i32,
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

/// Full config export structure
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
    pub device_positions: Vec<DevicePositionRow>,
    #[serde(default)]
    pub group_positions: Vec<GroupPositionRow>,
    #[serde(default)]
    pub device_display_overrides: Vec<DeviceDisplayNameRow>,
    #[serde(default)]
    pub device_sensor_configs: Vec<DeviceSensorConfigRow>,
    pub dashboard_layouts: Vec<DashboardLayoutRow>,
    pub dashboard_widgets: Vec<DashboardWidgetRow>,
}

// ============================================================================
// Core Config
// ============================================================================

pub async fn db_get_core_config() -> Result<Option<CoreConfigRow>> {
    let db = get_db_connection()?;

    let row: Option<(i32,)> =
        sqlx::query_as("SELECT warmup_time_seconds FROM core_config WHERE id = 1")
            .fetch_optional(db)
            .await?;

    Ok(row.map(|(warmup_time_seconds,)| CoreConfigRow {
        warmup_time_seconds,
    }))
}

pub async fn db_update_core_config(config: &CoreConfigRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query("UPDATE core_config SET warmup_time_seconds = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
        .bind(config.warmup_time_seconds)
        .execute(db)
        .await?;

    Ok(())
}

pub async fn db_get_device_display_overrides() -> Result<Vec<DeviceDisplayNameRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT device_key, display_name FROM device_display_overrides ORDER BY device_key",
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(device_key, display_name)| DeviceDisplayNameRow {
            device_key,
            display_name,
        })
        .collect())
}

pub async fn db_upsert_device_display_override(row: &DeviceDisplayNameRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO device_display_overrides (device_key, display_name, updated_at) \
         VALUES ($1, $2, CURRENT_TIMESTAMP) \
         ON CONFLICT (device_key) DO UPDATE SET \
             display_name = excluded.display_name, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&row.device_key)
    .bind(&row.display_name)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_device_display_override(device_key: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM device_display_overrides WHERE device_key = $1")
        .bind(device_key)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn db_get_device_sensor_configs() -> Result<Vec<DeviceSensorConfigRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT device_ref, interaction_kind, config_json FROM device_sensor_configs ORDER BY device_ref",
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(device_ref, interaction_kind, config_json)| DeviceSensorConfigRow {
                device_ref,
                interaction_kind,
                config: serde_json::from_str(&config_json).unwrap_or_default(),
            },
        )
        .collect())
}

pub async fn db_upsert_device_sensor_config(row: &DeviceSensorConfigRow) -> Result<()> {
    let db = get_db_connection()?;
    let config_json = serde_json::to_string(&row.config)?;

    sqlx::query(
        "INSERT INTO device_sensor_configs (device_ref, interaction_kind, config_json, updated_at) \
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP) \
         ON CONFLICT (device_ref) DO UPDATE SET \
             interaction_kind = excluded.interaction_kind, \
             config_json = excluded.config_json, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&row.device_ref)
    .bind(&row.interaction_kind)
    .bind(config_json)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_device_sensor_config(device_ref: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM device_sensor_configs WHERE device_ref = $1")
        .bind(device_ref)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Integrations
// ============================================================================

pub async fn db_get_integrations() -> Result<Vec<IntegrationRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String, String, bool)> =
        sqlx::query_as("SELECT id, plugin, config, enabled FROM integrations ORDER BY id")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(id, plugin, config, enabled)| IntegrationRow {
            id,
            plugin,
            config: serde_json::from_str(&config).unwrap_or_default(),
            enabled,
        })
        .collect())
}

pub async fn db_get_integration(id: &str) -> Result<Option<IntegrationRow>> {
    let db = get_db_connection()?;

    let row: Option<(String, String, String, bool)> =
        sqlx::query_as("SELECT id, plugin, config, enabled FROM integrations WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
            .await?;

    Ok(row.map(|(id, plugin, config, enabled)| IntegrationRow {
        id,
        plugin,
        config: serde_json::from_str(&config).unwrap_or_default(),
        enabled,
    }))
}

pub async fn db_upsert_integration(integration: &IntegrationRow) -> Result<()> {
    let db = get_db_connection()?;

    let config_str = serde_json::to_string(&integration.config)?;

    sqlx::query(
        "INSERT INTO integrations (id, plugin, config, enabled, updated_at) \
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             plugin = excluded.plugin, \
             config = excluded.config, \
             enabled = excluded.enabled, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&integration.id)
    .bind(&integration.plugin)
    .bind(&config_str)
    .bind(integration.enabled)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_integration(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM integrations WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Groups
// ============================================================================

pub async fn db_get_groups() -> Result<Vec<GroupRow>> {
    let db = get_db_connection()?;

    let groups: Vec<(String, String, bool)> =
        sqlx::query_as("SELECT id, name, hidden FROM groups ORDER BY name")
            .fetch_all(db)
            .await?;

    let mut result = Vec::new();
    for (id, name, hidden) in groups {
        let devices: Vec<(String, String)> = sqlx::query_as(
            "SELECT integration_id, device_id \
             FROM group_devices WHERE group_id = $1 ORDER BY sort_order",
        )
        .bind(&id)
        .fetch_all(db)
        .await?;

        let links: Vec<(String,)> = sqlx::query_as(
            "SELECT child_group_id FROM group_links \
             WHERE parent_group_id = $1 ORDER BY sort_order",
        )
        .bind(&id)
        .fetch_all(db)
        .await?;

        result.push(GroupRow {
            id,
            name,
            hidden,
            devices: devices
                .into_iter()
                .map(|(integration_id, device_id)| GroupDeviceRow {
                    integration_id,
                    device_id,
                })
                .collect(),
            linked_groups: links.into_iter().map(|(g,)| g).collect(),
        });
    }

    Ok(result)
}

pub async fn db_get_group(id: &str) -> Result<Option<GroupRow>> {
    let db = get_db_connection()?;

    let group: Option<(String, String, bool)> =
        sqlx::query_as("SELECT id, name, hidden FROM groups WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
            .await?;

    let Some((gid, name, hidden)) = group else {
        return Ok(None);
    };

    let devices: Vec<(String, String)> = sqlx::query_as(
        "SELECT integration_id, device_id \
         FROM group_devices WHERE group_id = $1 ORDER BY sort_order",
    )
    .bind(id)
    .fetch_all(db)
    .await?;

    let links: Vec<(String,)> = sqlx::query_as(
        "SELECT child_group_id FROM group_links \
         WHERE parent_group_id = $1 ORDER BY sort_order",
    )
    .bind(id)
    .fetch_all(db)
    .await?;

    Ok(Some(GroupRow {
        id: gid,
        name,
        hidden,
        devices: devices
            .into_iter()
            .map(|(integration_id, device_id)| GroupDeviceRow {
                integration_id,
                device_id,
            })
            .collect(),
        linked_groups: links.into_iter().map(|(g,)| g).collect(),
    }))
}

pub async fn db_upsert_group(group: &GroupRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO groups (id, name, hidden, updated_at) \
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             name = excluded.name, \
             hidden = excluded.hidden, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&group.id)
    .bind(&group.name)
    .bind(group.hidden)
    .execute(db)
    .await?;

    // Delete existing devices and links
    sqlx::query("DELETE FROM group_devices WHERE group_id = $1")
        .bind(&group.id)
        .execute(db)
        .await?;

    sqlx::query("DELETE FROM group_links WHERE parent_group_id = $1")
        .bind(&group.id)
        .execute(db)
        .await?;

    // Insert devices
    for (i, device) in group.devices.iter().enumerate() {
        sqlx::query(
            "INSERT INTO group_devices (group_id, integration_id, device_id, sort_order) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(&group.id)
        .bind(&device.integration_id)
        .bind(&device.device_id)
        .bind(i as i32)
        .execute(db)
        .await?;
    }

    // Insert links
    for (i, linked_group) in group.linked_groups.iter().enumerate() {
        sqlx::query(
            "INSERT INTO group_links (parent_group_id, child_group_id, sort_order) \
             VALUES ($1, $2, $3)",
        )
        .bind(&group.id)
        .bind(linked_group)
        .bind(i as i32)
        .execute(db)
        .await?;
    }

    Ok(())
}

pub async fn db_delete_group(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM groups WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Scenes
// ============================================================================

pub async fn db_get_config_scenes() -> Result<Vec<SceneRow>> {
    let db = get_db_connection()?;

    let scenes: Vec<(String, String, bool, Option<String>)> =
        sqlx::query_as("SELECT id, name, hidden, script FROM scenes ORDER BY name")
            .fetch_all(db)
            .await?;

    let mut result = Vec::new();
    for (id, name, hidden, script) in scenes {
        let device_states: Vec<(String, String)> = sqlx::query_as(
            "SELECT device_key, config FROM scene_device_states WHERE scene_id = $1",
        )
        .bind(&id)
        .fetch_all(db)
        .await?;

        let group_states: Vec<(String, String)> =
            sqlx::query_as("SELECT group_id, config FROM scene_group_states WHERE scene_id = $1")
                .bind(&id)
                .fetch_all(db)
                .await?;

        result.push(SceneRow {
            id,
            name,
            hidden,
            script,
            device_states: device_states
                .into_iter()
                .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
                .collect(),
            group_states: group_states
                .into_iter()
                .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
                .collect(),
        });
    }

    Ok(result)
}

pub async fn db_get_config_scene(id: &str) -> Result<Option<SceneRow>> {
    let db = get_db_connection()?;

    let scene: Option<(String, String, bool, Option<String>)> =
        sqlx::query_as("SELECT id, name, hidden, script FROM scenes WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
            .await?;

    let Some((sid, name, hidden, script)) = scene else {
        return Ok(None);
    };

    let device_states: Vec<(String, String)> =
        sqlx::query_as("SELECT device_key, config FROM scene_device_states WHERE scene_id = $1")
            .bind(id)
            .fetch_all(db)
            .await?;

    let group_states: Vec<(String, String)> =
        sqlx::query_as("SELECT group_id, config FROM scene_group_states WHERE scene_id = $1")
            .bind(id)
            .fetch_all(db)
            .await?;

    Ok(Some(SceneRow {
        id: sid,
        name,
        hidden,
        script,
        device_states: device_states
            .into_iter()
            .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
            .collect(),
        group_states: group_states
            .into_iter()
            .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
            .collect(),
    }))
}

pub async fn db_upsert_config_scene(scene: &SceneRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO scenes (id, name, hidden, script, updated_at) \
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             name = excluded.name, \
             hidden = excluded.hidden, \
             script = excluded.script, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&scene.id)
    .bind(&scene.name)
    .bind(scene.hidden)
    .bind(&scene.script)
    .execute(db)
    .await?;

    // Delete existing states
    sqlx::query("DELETE FROM scene_device_states WHERE scene_id = $1")
        .bind(&scene.id)
        .execute(db)
        .await?;

    sqlx::query("DELETE FROM scene_group_states WHERE scene_id = $1")
        .bind(&scene.id)
        .execute(db)
        .await?;

    // Insert device states
    for (device_key, config) in &scene.device_states {
        let config_str = serde_json::to_string(config)?;
        sqlx::query(
            "INSERT INTO scene_device_states (scene_id, device_key, config) VALUES ($1, $2, $3)",
        )
        .bind(&scene.id)
        .bind(device_key)
        .bind(&config_str)
        .execute(db)
        .await?;
    }

    // Insert group states
    for (group_id, config) in &scene.group_states {
        let config_str = serde_json::to_string(config)?;
        sqlx::query(
            "INSERT INTO scene_group_states (scene_id, group_id, config) VALUES ($1, $2, $3)",
        )
        .bind(&scene.id)
        .bind(group_id)
        .bind(&config_str)
        .execute(db)
        .await?;
    }

    Ok(())
}

pub async fn db_delete_config_scene(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM scenes WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Routines
// ============================================================================

pub async fn db_get_routines() -> Result<Vec<RoutineRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String, bool, String, String)> =
        sqlx::query_as("SELECT id, name, enabled, rules, actions FROM routines ORDER BY name")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, enabled, rules, actions)| RoutineRow {
            id,
            name,
            enabled,
            rules: serde_json::from_str(&rules).unwrap_or_default(),
            actions: serde_json::from_str(&actions).unwrap_or_default(),
        })
        .collect())
}

pub async fn db_get_routine(id: &str) -> Result<Option<RoutineRow>> {
    let db = get_db_connection()?;

    let row: Option<(String, String, bool, String, String)> =
        sqlx::query_as("SELECT id, name, enabled, rules, actions FROM routines WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
            .await?;

    Ok(row.map(|(id, name, enabled, rules, actions)| RoutineRow {
        id,
        name,
        enabled,
        rules: serde_json::from_str(&rules).unwrap_or_default(),
        actions: serde_json::from_str(&actions).unwrap_or_default(),
    }))
}

pub async fn db_upsert_routine(routine: &RoutineRow) -> Result<()> {
    let db = get_db_connection()?;

    let rules_str = serde_json::to_string(&routine.rules)?;
    let actions_str = serde_json::to_string(&routine.actions)?;

    sqlx::query(
        "INSERT INTO routines (id, name, enabled, rules, actions, updated_at) \
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             name = excluded.name, \
             enabled = excluded.enabled, \
             rules = excluded.rules, \
             actions = excluded.actions, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&routine.id)
    .bind(&routine.name)
    .bind(routine.enabled)
    .bind(&rules_str)
    .bind(&actions_str)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_routine(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM routines WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Floorplan
// ============================================================================

pub async fn db_get_floorplan() -> Result<Option<FloorplanRow>> {
    db_get_floorplan_by_id("default").await
}

pub async fn db_get_floorplan_by_id(id: &str) -> Result<Option<FloorplanRow>> {
    let db = get_db_connection()?;

    let row: Option<(Option<Vec<u8>>, Option<String>, Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT image_data, image_mime_type, width, height FROM floorplans WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(
        |(image_data, image_mime_type, width, height)| FloorplanRow {
            image_data,
            image_mime_type,
            width,
            height,
        },
    ))
}

pub async fn db_upsert_floorplan(floorplan: &FloorplanRow) -> Result<()> {
    db_upsert_floorplan_by_id("default", floorplan).await
}

pub async fn db_upsert_floorplan_by_id(id: &str, floorplan: &FloorplanRow) -> Result<()> {
    let db = get_db_connection()?;
    let default_name = if id == "default" {
        "Main floorplan"
    } else {
        id
    };

    sqlx::query(
        "INSERT INTO floorplans (id, name, image_data, image_mime_type, width, height, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             image_data = excluded.image_data, \
             image_mime_type = excluded.image_mime_type, \
             width = excluded.width, \
             height = excluded.height, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(id)
    .bind(default_name)
    .bind(&floorplan.image_data)
    .bind(&floorplan.image_mime_type)
    .bind(floorplan.width)
    .bind(floorplan.height)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_clear_floorplan_image(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query(
        "UPDATE floorplans \
         SET image_data = NULL, \
             image_mime_type = NULL, \
             width = NULL, \
             height = NULL, \
             updated_at = CURRENT_TIMESTAMP \
         WHERE id = $1",
    )
    .bind(id)
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn db_get_floorplan_grid() -> Result<Option<FloorplanGridRow>> {
    db_get_floorplan_grid_by_id("default").await
}

pub async fn db_get_floorplan_grid_by_id(id: &str) -> Result<Option<FloorplanGridRow>> {
    let db = get_db_connection()?;

    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT grid_data FROM floorplans WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
            .await?;

    Ok(row.and_then(|(grid_data,)| grid_data.map(|g| FloorplanGridRow { grid: g })))
}

pub async fn db_upsert_floorplan_grid(grid: &str) -> Result<()> {
    db_upsert_floorplan_grid_by_id("default", grid).await
}

pub async fn db_upsert_floorplan_grid_by_id(id: &str, grid: &str) -> Result<()> {
    let db = get_db_connection()?;
    let default_name = if id == "default" {
        "Main floorplan"
    } else {
        id
    };

    sqlx::query(
        "INSERT INTO floorplans (id, name, grid_data, updated_at) \
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             grid_data = excluded.grid_data, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(id)
    .bind(default_name)
    .bind(grid)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_get_floorplans() -> Result<Vec<FloorplanMetadataRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, name FROM floorplans ORDER BY sort_order, name")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name)| FloorplanMetadataRow { id, name })
        .collect())
}

pub async fn db_get_floorplan_exports() -> Result<Vec<FloorplanExportRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(
        String,
        String,
        Option<Vec<u8>>,
        Option<String>,
        Option<i32>,
        Option<i32>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, name, image_data, image_mime_type, width, height, grid_data \
         FROM floorplans ORDER BY sort_order, name",
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, name, image_data, image_mime_type, width, height, grid_data)| {
                FloorplanExportRow {
                    id,
                    name,
                    image_data,
                    image_mime_type,
                    width,
                    height,
                    grid_data,
                }
            },
        )
        .collect())
}

pub async fn db_upsert_floorplan_export(
    floorplan: &FloorplanExportRow,
    sort_order: i32,
) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO floorplans \
         (id, name, image_data, image_mime_type, width, height, grid_data, sort_order, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             name = excluded.name, \
             image_data = excluded.image_data, \
             image_mime_type = excluded.image_mime_type, \
             width = excluded.width, \
             height = excluded.height, \
             grid_data = excluded.grid_data, \
             sort_order = excluded.sort_order, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&floorplan.id)
    .bind(&floorplan.name)
    .bind(&floorplan.image_data)
    .bind(&floorplan.image_mime_type)
    .bind(floorplan.width)
    .bind(floorplan.height)
    .bind(&floorplan.grid_data)
    .bind(sort_order)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_create_floorplan(floorplan: &FloorplanMetadataRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO floorplans (id, name, sort_order, updated_at) \
         VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM floorplans), CURRENT_TIMESTAMP)",
    )
    .bind(&floorplan.id)
    .bind(&floorplan.name)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_update_floorplan_metadata(floorplan: &FloorplanMetadataRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query("UPDATE floorplans SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
        .bind(&floorplan.name)
        .bind(&floorplan.id)
        .execute(db)
        .await?;

    Ok(())
}

pub async fn db_delete_floorplan(id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM floorplans WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Device Positions
// ============================================================================

pub async fn db_get_device_positions() -> Result<Vec<DevicePositionRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, f32, f32, Option<f32>, Option<f32>)> =
        sqlx::query_as("SELECT device_key, x, y, scale, rotation FROM device_positions")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(device_key, x, y, scale, rotation)| DevicePositionRow {
            device_key,
            x,
            y,
            scale: scale.unwrap_or(1.0),
            rotation: rotation.unwrap_or(0.0),
        })
        .collect())
}

pub async fn db_upsert_device_position(pos: &DevicePositionRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO device_positions (device_key, x, y, scale, rotation) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (device_key) DO UPDATE SET \
             x = excluded.x, y = excluded.y, \
             scale = excluded.scale, rotation = excluded.rotation",
    )
    .bind(&pos.device_key)
    .bind(pos.x)
    .bind(pos.y)
    .bind(pos.scale)
    .bind(pos.rotation)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_device_position(device_key: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM device_positions WHERE device_key = $1")
        .bind(device_key)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Group Positions
// ============================================================================

pub async fn db_get_group_positions() -> Result<Vec<GroupPositionRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, f32, f32, f32, f32, i32)> =
        sqlx::query_as("SELECT group_id, x, y, width, height, z_index FROM group_positions")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(
            |(group_id, x, y, width, height, z_index)| GroupPositionRow {
                group_id,
                x,
                y,
                width,
                height,
                z_index,
            },
        )
        .collect())
}

pub async fn db_upsert_group_position(pos: &GroupPositionRow) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO group_positions (group_id, x, y, width, height, z_index) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (group_id) DO UPDATE SET \
             x = excluded.x, y = excluded.y, \
             width = excluded.width, height = excluded.height, \
             z_index = excluded.z_index",
    )
    .bind(&pos.group_id)
    .bind(pos.x)
    .bind(pos.y)
    .bind(pos.width)
    .bind(pos.height)
    .bind(pos.z_index)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_group_position(group_id: &str) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM group_positions WHERE group_id = $1")
        .bind(group_id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Dashboard Layouts
// ============================================================================

pub async fn db_get_dashboard_layouts() -> Result<Vec<DashboardLayoutRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(i32, String, bool)> =
        sqlx::query_as("SELECT id, name, is_default FROM dashboard_layouts ORDER BY name")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, is_default)| DashboardLayoutRow {
            id,
            name,
            is_default,
        })
        .collect())
}

pub async fn db_upsert_dashboard_layout(layout: &DashboardLayoutRow) -> Result<i32> {
    let db = get_db_connection()?;

    // If making this default, unset other defaults
    if layout.is_default {
        sqlx::query("UPDATE dashboard_layouts SET is_default = FALSE WHERE is_default = TRUE")
            .execute(db)
            .await?;
    }

    if layout.id > 0 {
        sqlx::query(
            "UPDATE dashboard_layouts SET name = $1, is_default = $2, \
             updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        )
        .bind(&layout.name)
        .bind(layout.is_default)
        .bind(layout.id)
        .execute(db)
        .await?;
        Ok(layout.id)
    } else {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO dashboard_layouts (name, is_default, updated_at) \
             VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id",
        )
        .bind(&layout.name)
        .bind(layout.is_default)
        .fetch_one(db)
        .await?;
        Ok(row.0 as i32)
    }
}

pub async fn db_delete_dashboard_layout(id: i32) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM dashboard_layouts WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Dashboard Widgets
// ============================================================================

pub async fn db_get_dashboard_widgets(layout_id: i32) -> Result<Vec<DashboardWidgetRow>> {
    let db = get_db_connection()?;

    let rows: Vec<(i32, i32, String, String, i32, i32, i32, i32, i32)> = sqlx::query_as(
        "SELECT id, layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order \
         FROM dashboard_widgets WHERE layout_id = $1 ORDER BY sort_order",
    )
    .bind(layout_id)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order)| {
                DashboardWidgetRow {
                    id,
                    layout_id,
                    widget_type,
                    config: serde_json::from_str(&config).unwrap_or_default(),
                    grid_x,
                    grid_y,
                    grid_w,
                    grid_h,
                    sort_order,
                }
            },
        )
        .collect())
}

pub async fn db_upsert_dashboard_widget(widget: &DashboardWidgetRow) -> Result<i32> {
    let db = get_db_connection()?;

    let config_str = serde_json::to_string(&widget.config)?;

    if widget.id > 0 {
        sqlx::query(
            "UPDATE dashboard_widgets SET layout_id = $1, widget_type = $2, config = $3, \
             grid_x = $4, grid_y = $5, grid_w = $6, grid_h = $7, sort_order = $8 WHERE id = $9",
        )
        .bind(widget.layout_id)
        .bind(&widget.widget_type)
        .bind(&config_str)
        .bind(widget.grid_x)
        .bind(widget.grid_y)
        .bind(widget.grid_w)
        .bind(widget.grid_h)
        .bind(widget.sort_order)
        .bind(widget.id)
        .execute(db)
        .await?;
        Ok(widget.id)
    } else {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO dashboard_widgets \
             (layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        )
        .bind(widget.layout_id)
        .bind(&widget.widget_type)
        .bind(&config_str)
        .bind(widget.grid_x)
        .bind(widget.grid_y)
        .bind(widget.grid_w)
        .bind(widget.grid_h)
        .bind(widget.sort_order)
        .fetch_one(db)
        .await?;
        Ok(row.0 as i32)
    }
}

pub async fn db_delete_dashboard_widget(id: i32) -> Result<bool> {
    let db = get_db_connection()?;

    let result = sqlx::query("DELETE FROM dashboard_widgets WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Config Import/Export
// ============================================================================

pub async fn db_export_config() -> Result<ConfigExport> {
    let core = db_get_core_config().await?.unwrap_or(CoreConfigRow {
        warmup_time_seconds: 1,
    });
    let integrations = db_get_integrations().await?;
    let groups = db_get_groups().await?;
    let scenes = db_get_config_scenes().await?;
    let routines = db_get_routines().await?;
    let floorplan = db_get_floorplan().await?;
    let floorplans = db_get_floorplan_exports().await?;
    let device_positions = db_get_device_positions().await?;
    let group_positions = db_get_group_positions().await?;
    let device_display_overrides = db_get_device_display_overrides().await?;
    let device_sensor_configs = db_get_device_sensor_configs().await?;
    let dashboard_layouts = db_get_dashboard_layouts().await?;

    let mut dashboard_widgets = Vec::new();
    for layout in &dashboard_layouts {
        let widgets = db_get_dashboard_widgets(layout.id).await?;
        dashboard_widgets.extend(widgets);
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
        device_positions,
        group_positions,
        device_display_overrides,
        device_sensor_configs,
        dashboard_layouts,
        dashboard_widgets,
    })
}

pub async fn db_import_config(config: &ConfigExport) -> Result<()> {
    db_update_core_config(&config.core).await?;

    for integration in &config.integrations {
        db_upsert_integration(integration).await?;
    }

    // Collect valid group IDs so we can skip invalid group links
    let valid_group_ids: std::collections::HashSet<&str> =
        config.groups.iter().map(|g| g.id.as_str()).collect();

    // Two-pass group import: insert all group rows first (without links),
    // then insert links in a second pass. This avoids FK violations when
    // a group links to another group that hasn't been inserted yet.
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
    for pos in &config.device_positions {
        db_upsert_device_position(pos).await?;
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

    let last_version: (Option<i32>,) = sqlx::query_as("SELECT MAX(version) FROM config_versions")
        .fetch_one(db)
        .await?;

    let new_version = last_version.0.unwrap_or(0) + 1;
    let config_str = serde_json::to_string(config)?;

    sqlx::query(
        "INSERT INTO config_versions (version, description, config_json) VALUES ($1, $2, $3)",
    )
    .bind(new_version)
    .bind(description)
    .bind(&config_str)
    .execute(db)
    .await?;

    Ok(new_version)
}

/// Check whether the database contains any user-managed configuration.
pub async fn db_has_config() -> Result<bool> {
    let db = get_db_connection()?;

    let has_config: (bool,) = sqlx::query_as(
        "SELECT (
            EXISTS (SELECT 1 FROM integrations)
            OR EXISTS (SELECT 1 FROM groups)
            OR EXISTS (SELECT 1 FROM group_devices)
            OR EXISTS (SELECT 1 FROM group_links)
            OR EXISTS (SELECT 1 FROM scenes)
            OR EXISTS (SELECT 1 FROM scene_device_states)
            OR EXISTS (SELECT 1 FROM scene_group_states)
            OR EXISTS (SELECT 1 FROM scene_overrides)
            OR EXISTS (SELECT 1 FROM routines)
            OR EXISTS (
                SELECT 1
                FROM floorplans
                WHERE NOT (
                    id = 'default'
                    AND name = 'Main floorplan'
                    AND image_data IS NULL
                    AND image_mime_type IS NULL
                    AND width IS NULL
                    AND height IS NULL
                    AND grid_data IS NULL
                )
            )
            OR EXISTS (SELECT 1 FROM device_positions)
            OR EXISTS (SELECT 1 FROM group_positions)
            OR EXISTS (SELECT 1 FROM device_display_overrides)
            OR EXISTS (SELECT 1 FROM device_sensor_configs)
            OR EXISTS (
                SELECT 1
                FROM dashboard_layouts
                WHERE id <> 1 OR name <> 'Default' OR is_default = FALSE
            )
            OR EXISTS (SELECT 1 FROM dashboard_widgets)
        )",
    )
    .fetch_one(db)
    .await?;

    Ok(has_config.0)
}
