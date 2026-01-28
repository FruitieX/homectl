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

use super::{get_db_connection, is_db_available};
use color_eyre::Result;
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
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
    pub device_name: String,
    pub device_id: Option<String>,
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
pub struct DevicePositionRow {
    pub device_key: String,
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    pub rotation: f32,
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
    pub device_positions: Vec<DevicePositionRow>,
    pub dashboard_layouts: Vec<DashboardLayoutRow>,
    pub dashboard_widgets: Vec<DashboardWidgetRow>,
}

// ============================================================================
// Core Config
// ============================================================================

pub async fn db_get_core_config() -> Result<Option<CoreConfigRow>> {
    if !is_db_available() {
        return Ok(None);
    }
    let db = get_db_connection().await?;

    let row = sqlx::query!(
        r#"
        SELECT warmup_time_seconds
        FROM core_config
        WHERE id = 1
        "#
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| CoreConfigRow {
        warmup_time_seconds: r.warmup_time_seconds.unwrap_or(1),
    }))
}

pub async fn db_update_core_config(config: &CoreConfigRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
        UPDATE core_config
        SET warmup_time_seconds = $1,
            updated_at = NOW()
        WHERE id = 1
        "#,
        config.warmup_time_seconds
    )
    .execute(db)
    .await?;

    Ok(())
}

// ============================================================================
// Integrations
// ============================================================================

pub async fn db_get_integrations() -> Result<Vec<IntegrationRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    let rows = sqlx::query!(
        r#"
        SELECT id, plugin, config, enabled
        FROM integrations
        ORDER BY id
        "#
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| IntegrationRow {
            id: r.id,
            plugin: r.plugin,
            config: r.config,
            enabled: r.enabled.unwrap_or(true),
        })
        .collect())
}

pub async fn db_get_integration(id: &str) -> Result<Option<IntegrationRow>> {
    if !is_db_available() {
        return Ok(None);
    }
    let db = get_db_connection().await?;

    let row = sqlx::query!(
        r#"
        SELECT id, plugin, config, enabled
        FROM integrations
        WHERE id = $1
        "#,
        id
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| IntegrationRow {
        id: r.id,
        plugin: r.plugin,
        config: r.config,
        enabled: r.enabled.unwrap_or(true),
    }))
}

pub async fn db_upsert_integration(integration: &IntegrationRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
        INSERT INTO integrations (id, plugin, config, enabled, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
            plugin = EXCLUDED.plugin,
            config = EXCLUDED.config,
            enabled = EXCLUDED.enabled,
            updated_at = NOW()
        "#,
        integration.id,
        integration.plugin,
        integration.config,
        integration.enabled
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_integration(id: &str) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM integrations WHERE id = $1
        "#,
        id
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Groups
// ============================================================================

pub async fn db_get_groups() -> Result<Vec<GroupRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    // First get all groups
    let groups = sqlx::query!(
        r#"
        SELECT id, name, hidden
        FROM groups
        ORDER BY name
        "#
    )
    .fetch_all(db)
    .await?;

    let mut result = Vec::new();
    for g in groups {
        // Get devices for this group
        let devices = sqlx::query!(
            r#"
            SELECT integration_id, device_name, device_id
            FROM group_devices
            WHERE group_id = $1
            ORDER BY sort_order
            "#,
            g.id
        )
        .fetch_all(db)
        .await?;

        // Get linked groups
        let links = sqlx::query!(
            r#"
            SELECT child_group_id
            FROM group_links
            WHERE parent_group_id = $1
            ORDER BY sort_order
            "#,
            g.id
        )
        .fetch_all(db)
        .await?;

        result.push(GroupRow {
            id: g.id,
            name: g.name,
            hidden: g.hidden.unwrap_or(false),
            devices: devices
                .into_iter()
                .map(|d| GroupDeviceRow {
                    integration_id: d.integration_id,
                    device_name: d.device_name,
                    device_id: d.device_id,
                })
                .collect(),
            linked_groups: links.into_iter().map(|l| l.child_group_id).collect(),
        });
    }

    Ok(result)
}

pub async fn db_get_group(id: &str) -> Result<Option<GroupRow>> {
    if !is_db_available() {
        return Ok(None);
    }
    let db = get_db_connection().await?;

    let group = sqlx::query!(
        r#"
        SELECT id, name, hidden
        FROM groups
        WHERE id = $1
        "#,
        id
    )
    .fetch_optional(db)
    .await?;

    let Some(g) = group else {
        return Ok(None);
    };

    let devices = sqlx::query!(
        r#"
        SELECT integration_id, device_name, device_id
        FROM group_devices
        WHERE group_id = $1
        ORDER BY sort_order
        "#,
        id
    )
    .fetch_all(db)
    .await?;

    let links = sqlx::query!(
        r#"
        SELECT child_group_id
        FROM group_links
        WHERE parent_group_id = $1
        ORDER BY sort_order
        "#,
        id
    )
    .fetch_all(db)
    .await?;

    Ok(Some(GroupRow {
        id: g.id,
        name: g.name,
        hidden: g.hidden.unwrap_or(false),
        devices: devices
            .into_iter()
            .map(|d| GroupDeviceRow {
                integration_id: d.integration_id,
                device_name: d.device_name,
                device_id: d.device_id,
            })
            .collect(),
        linked_groups: links.into_iter().map(|l| l.child_group_id).collect(),
    }))
}

pub async fn db_upsert_group(group: &GroupRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    // Upsert the group
    sqlx::query!(
        r#"
        INSERT INTO groups (id, name, hidden, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            hidden = EXCLUDED.hidden,
            updated_at = NOW()
        "#,
        group.id,
        group.name,
        group.hidden
    )
    .execute(db)
    .await?;

    // Delete existing devices and links
    sqlx::query!(r#"DELETE FROM group_devices WHERE group_id = $1"#, group.id)
        .execute(db)
        .await?;

    sqlx::query!(
        r#"DELETE FROM group_links WHERE parent_group_id = $1"#,
        group.id
    )
    .execute(db)
    .await?;

    // Insert devices
    for (i, device) in group.devices.iter().enumerate() {
        sqlx::query!(
            r#"
            INSERT INTO group_devices (group_id, integration_id, device_name, device_id, sort_order)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            group.id,
            device.integration_id,
            device.device_name,
            device.device_id,
            i as i32
        )
        .execute(db)
        .await?;
    }

    // Insert links
    for (i, linked_group) in group.linked_groups.iter().enumerate() {
        sqlx::query!(
            r#"
            INSERT INTO group_links (parent_group_id, child_group_id, sort_order)
            VALUES ($1, $2, $3)
            "#,
            group.id,
            linked_group,
            i as i32
        )
        .execute(db)
        .await?;
    }

    Ok(())
}

pub async fn db_delete_group(id: &str) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM groups WHERE id = $1
        "#,
        id
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Scenes
// ============================================================================

pub async fn db_get_config_scenes() -> Result<Vec<SceneRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    let scenes = sqlx::query!(
        r#"
        SELECT id, name, hidden, script
        FROM scenes
        ORDER BY name
        "#
    )
    .fetch_all(db)
    .await?;

    let mut result = Vec::new();
    for s in scenes {
        let device_states = sqlx::query!(
            r#"
            SELECT device_key, config
            FROM scene_device_states
            WHERE scene_id = $1
            "#,
            s.id
        )
        .fetch_all(db)
        .await?;

        let group_states = sqlx::query!(
            r#"
            SELECT group_id, config
            FROM scene_group_states
            WHERE scene_id = $1
            "#,
            s.id
        )
        .fetch_all(db)
        .await?;

        result.push(SceneRow {
            id: s.id,
            name: s.name,
            hidden: s.hidden.unwrap_or(false),
            script: s.script,
            device_states: device_states
                .into_iter()
                .map(|d| (d.device_key, d.config))
                .collect(),
            group_states: group_states
                .into_iter()
                .map(|g| (g.group_id, g.config))
                .collect(),
        });
    }

    Ok(result)
}

pub async fn db_get_config_scene(id: &str) -> Result<Option<SceneRow>> {
    if !is_db_available() {
        return Ok(None);
    }
    let db = get_db_connection().await?;

    let scene = sqlx::query!(
        r#"
        SELECT id, name, hidden, script
        FROM scenes
        WHERE id = $1
        "#,
        id
    )
    .fetch_optional(db)
    .await?;

    let Some(s) = scene else {
        return Ok(None);
    };

    let device_states = sqlx::query!(
        r#"
        SELECT device_key, config
        FROM scene_device_states
        WHERE scene_id = $1
        "#,
        id
    )
    .fetch_all(db)
    .await?;

    let group_states = sqlx::query!(
        r#"
        SELECT group_id, config
        FROM scene_group_states
        WHERE scene_id = $1
        "#,
        id
    )
    .fetch_all(db)
    .await?;

    Ok(Some(SceneRow {
        id: s.id,
        name: s.name,
        hidden: s.hidden.unwrap_or(false),
        script: s.script,
        device_states: device_states
            .into_iter()
            .map(|d| (d.device_key, d.config))
            .collect(),
        group_states: group_states
            .into_iter()
            .map(|g| (g.group_id, g.config))
            .collect(),
    }))
}

pub async fn db_upsert_config_scene(scene: &SceneRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    // Upsert scene
    sqlx::query!(
        r#"
        INSERT INTO scenes (id, name, hidden, script, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            hidden = EXCLUDED.hidden,
            script = EXCLUDED.script,
            updated_at = NOW()
        "#,
        scene.id,
        scene.name,
        scene.hidden,
        scene.script
    )
    .execute(db)
    .await?;

    // Delete existing states
    sqlx::query!(
        r#"DELETE FROM scene_device_states WHERE scene_id = $1"#,
        scene.id
    )
    .execute(db)
    .await?;

    sqlx::query!(
        r#"DELETE FROM scene_group_states WHERE scene_id = $1"#,
        scene.id
    )
    .execute(db)
    .await?;

    // Insert device states
    for (device_key, config) in &scene.device_states {
        sqlx::query!(
            r#"
            INSERT INTO scene_device_states (scene_id, device_key, config)
            VALUES ($1, $2, $3)
            "#,
            scene.id,
            device_key,
            config
        )
        .execute(db)
        .await?;
    }

    // Insert group states
    for (group_id, config) in &scene.group_states {
        sqlx::query!(
            r#"
            INSERT INTO scene_group_states (scene_id, group_id, config)
            VALUES ($1, $2, $3)
            "#,
            scene.id,
            group_id,
            config
        )
        .execute(db)
        .await?;
    }

    Ok(())
}

pub async fn db_delete_config_scene(id: &str) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM scenes WHERE id = $1
        "#,
        id
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Routines
// ============================================================================

pub async fn db_get_routines() -> Result<Vec<RoutineRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    let rows = sqlx::query!(
        r#"
        SELECT id, name, enabled, rules, actions
        FROM routines
        ORDER BY name
        "#
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| RoutineRow {
            id: r.id,
            name: r.name,
            enabled: r.enabled.unwrap_or(true),
            rules: r.rules,
            actions: r.actions,
        })
        .collect())
}

pub async fn db_get_routine(id: &str) -> Result<Option<RoutineRow>> {
    if !is_db_available() {
        return Ok(None);
    }
    let db = get_db_connection().await?;

    let row = sqlx::query!(
        r#"
        SELECT id, name, enabled, rules, actions
        FROM routines
        WHERE id = $1
        "#,
        id
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| RoutineRow {
        id: r.id,
        name: r.name,
        enabled: r.enabled.unwrap_or(true),
        rules: r.rules,
        actions: r.actions,
    }))
}

pub async fn db_upsert_routine(routine: &RoutineRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
        INSERT INTO routines (id, name, enabled, rules, actions, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            enabled = EXCLUDED.enabled,
            rules = EXCLUDED.rules,
            actions = EXCLUDED.actions,
            updated_at = NOW()
        "#,
        routine.id,
        routine.name,
        routine.enabled,
        routine.rules,
        routine.actions
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_routine(id: &str) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM routines WHERE id = $1
        "#,
        id
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Floorplan
// ============================================================================

pub async fn db_get_floorplan() -> Result<Option<FloorplanRow>> {
    if !is_db_available() {
        return Ok(None);
    }
    let db = get_db_connection().await?;

    let row = sqlx::query!(
        r#"
        SELECT image_data, image_mime_type, width, height
        FROM floorplan
        WHERE id = 1
        "#
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| FloorplanRow {
        image_data: r.image_data,
        image_mime_type: r.image_mime_type,
        width: r.width,
        height: r.height,
    }))
}

pub async fn db_upsert_floorplan(floorplan: &FloorplanRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
        UPDATE floorplan
        SET image_data = $1,
            image_mime_type = $2,
            width = $3,
            height = $4,
            updated_at = NOW()
        WHERE id = 1
        "#,
        floorplan.image_data,
        floorplan.image_mime_type,
        floorplan.width,
        floorplan.height
    )
    .execute(db)
    .await?;

    Ok(())
}

// ============================================================================
// Device Positions
// ============================================================================

pub async fn db_get_device_positions() -> Result<Vec<DevicePositionRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    let rows = sqlx::query!(
        r#"
        SELECT device_key, x, y, scale, rotation
        FROM device_positions
        "#
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| DevicePositionRow {
            device_key: r.device_key,
            x: r.x,
            y: r.y,
            scale: r.scale.unwrap_or(1.0),
            rotation: r.rotation.unwrap_or(0.0),
        })
        .collect())
}

pub async fn db_upsert_device_position(pos: &DevicePositionRow) -> Result<()> {
    if !is_db_available() {
        return Ok(());
    }
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
        INSERT INTO device_positions (device_key, x, y, scale, rotation)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (device_key) DO UPDATE SET
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            scale = EXCLUDED.scale,
            rotation = EXCLUDED.rotation
        "#,
        pos.device_key,
        pos.x,
        pos.y,
        pos.scale,
        pos.rotation
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_delete_device_position(device_key: &str) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM device_positions WHERE device_key = $1
        "#,
        device_key
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Dashboard Layouts
// ============================================================================

pub async fn db_get_dashboard_layouts() -> Result<Vec<DashboardLayoutRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    let rows = sqlx::query!(
        r#"
        SELECT id, name, is_default
        FROM dashboard_layouts
        ORDER BY name
        "#
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardLayoutRow {
            id: r.id,
            name: r.name,
            is_default: r.is_default.unwrap_or(false),
        })
        .collect())
}

pub async fn db_upsert_dashboard_layout(layout: &DashboardLayoutRow) -> Result<i32> {
    if !is_db_available() {
        return Ok(0);
    }
    let db = get_db_connection().await?;

    // If making this default, unset other defaults
    if layout.is_default {
        sqlx::query!(
            r#"
            UPDATE dashboard_layouts SET is_default = FALSE WHERE is_default = TRUE
            "#
        )
        .execute(db)
        .await?;
    }

    if layout.id > 0 {
        sqlx::query!(
            r#"
            UPDATE dashboard_layouts
            SET name = $2, is_default = $3, updated_at = NOW()
            WHERE id = $1
            "#,
            layout.id,
            layout.name,
            layout.is_default
        )
        .execute(db)
        .await?;
        Ok(layout.id)
    } else {
        let row = sqlx::query!(
            r#"
            INSERT INTO dashboard_layouts (name, is_default, updated_at)
            VALUES ($1, $2, NOW())
            RETURNING id
            "#,
            layout.name,
            layout.is_default
        )
        .fetch_one(db)
        .await?;
        Ok(row.id)
    }
}

pub async fn db_delete_dashboard_layout(id: i32) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM dashboard_layouts WHERE id = $1
        "#,
        id
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Dashboard Widgets
// ============================================================================

pub async fn db_get_dashboard_widgets(layout_id: i32) -> Result<Vec<DashboardWidgetRow>> {
    if !is_db_available() {
        return Ok(vec![]);
    }
    let db = get_db_connection().await?;

    let rows = sqlx::query!(
        r#"
        SELECT id, layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order
        FROM dashboard_widgets
        WHERE layout_id = $1
        ORDER BY sort_order
        "#,
        layout_id
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardWidgetRow {
            id: r.id,
            layout_id: r.layout_id.unwrap_or(layout_id),
            widget_type: r.widget_type,
            config: r.config,
            grid_x: r.grid_x,
            grid_y: r.grid_y,
            grid_w: r.grid_w,
            grid_h: r.grid_h,
            sort_order: r.sort_order.unwrap_or(0),
        })
        .collect())
}

pub async fn db_upsert_dashboard_widget(widget: &DashboardWidgetRow) -> Result<i32> {
    if !is_db_available() {
        return Ok(0);
    }
    let db = get_db_connection().await?;

    if widget.id > 0 {
        sqlx::query!(
            r#"
            UPDATE dashboard_widgets
            SET layout_id = $2, widget_type = $3, config = $4,
                grid_x = $5, grid_y = $6, grid_w = $7, grid_h = $8, sort_order = $9
            WHERE id = $1
            "#,
            widget.id,
            widget.layout_id,
            widget.widget_type,
            widget.config,
            widget.grid_x,
            widget.grid_y,
            widget.grid_w,
            widget.grid_h,
            widget.sort_order
        )
        .execute(db)
        .await?;
        Ok(widget.id)
    } else {
        let row = sqlx::query!(
            r#"
            INSERT INTO dashboard_widgets (layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
            "#,
            widget.layout_id,
            widget.widget_type,
            widget.config,
            widget.grid_x,
            widget.grid_y,
            widget.grid_w,
            widget.grid_h,
            widget.sort_order
        )
        .fetch_one(db)
        .await?;
        Ok(row.id)
    }
}

pub async fn db_delete_dashboard_widget(id: i32) -> Result<bool> {
    if !is_db_available() {
        return Ok(false);
    }
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
        DELETE FROM dashboard_widgets WHERE id = $1
        "#,
        id
    )
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
    let device_positions = db_get_device_positions().await?;
    let dashboard_layouts = db_get_dashboard_layouts().await?;

    // Get widgets for all layouts
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
        device_positions,
        dashboard_layouts,
        dashboard_widgets,
    })
}

pub async fn db_import_config(config: &ConfigExport) -> Result<()> {
    // Update core config
    db_update_core_config(&config.core).await?;

    // Import integrations
    for integration in &config.integrations {
        db_upsert_integration(integration).await?;
    }

    // Import groups
    for group in &config.groups {
        db_upsert_group(group).await?;
    }

    // Import scenes
    for scene in &config.scenes {
        db_upsert_config_scene(scene).await?;
    }

    // Import routines
    for routine in &config.routines {
        db_upsert_routine(routine).await?;
    }

    // Import floorplan
    if let Some(floorplan) = &config.floorplan {
        db_upsert_floorplan(floorplan).await?;
    }

    // Import device positions
    for pos in &config.device_positions {
        db_upsert_device_position(pos).await?;
    }

    // Import dashboard layouts and widgets
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
    if !is_db_available() {
        return Ok(0);
    }
    let db = get_db_connection().await?;

    // Get next version number
    let last_version = sqlx::query!(
        r#"
        SELECT COALESCE(MAX(version), 0) as version FROM config_versions
        "#
    )
    .fetch_one(db)
    .await?;

    let new_version = last_version.version.unwrap_or(0) + 1;

    sqlx::query!(
        r#"
        INSERT INTO config_versions (version, description, config_json)
        VALUES ($1, $2, $3)
        "#,
        new_version,
        description,
        Json(config) as _
    )
    .execute(db)
    .await?;

    Ok(new_version)
}
