//! Simulation mode: mirrors production config into an in-memory runtime snapshot
//! and replaces MQTT integrations with dummy equivalents.

use crate::api::config::{parse_config_backup, ParsedConfigBackup};
use crate::db::config_queries::{
    self, ConfigExport, GroupRow, IntegrationRow, RoutineRow, SceneRow,
};
use color_eyre::Result;
use eyre::eyre;
use serde_json::json;
use sqlx::PgPool;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Load config for simulation from a legacy SQLite DB file when available, or
/// from the optional JSON backup config file otherwise.
pub async fn prepare_simulation_config(
    source_db: Option<&str>,
    config_path: Option<&str>,
) -> Result<ConfigExport> {
    let config_export = if let Some(source_db) = source_db {
        match resolve_simulation_source(source_db) {
            SimulationSource::Postgres(database_url) => {
                info!("Reading simulation config from source PostgreSQL DB");

                match export_from_postgres_source_db(database_url).await {
                    Ok(export) if config_export_has_data(&export) => export,
                    Ok(_) => {
                        info!(
                            "Source PostgreSQL DB is empty, checking for config file fallback..."
                        );
                        load_simulation_config_fallback(
                            config_path,
                            "Source PostgreSQL DB is empty",
                        )
                        .await?
                    }
                    Err(error) => {
                        warn!(
                            "Failed to read simulation config from source PostgreSQL DB: {error}"
                        );
                        load_simulation_config_fallback(
                            config_path,
                            "Source PostgreSQL DB was not readable",
                        )
                        .await?
                    }
                }
            }
            SimulationSource::SqlitePath(source_path) if source_path.exists() => {
                info!(
                    "Reading simulation config from source DB: {}",
                    source_path.display()
                );
                let export = export_from_sqlite_source_db(source_path).await?;

                if config_export_has_data(&export) {
                    export
                } else {
                    info!("Source DB is empty, checking for config file fallback...");
                    load_simulation_config_fallback(config_path, "Source DB is empty").await?
                }
            }
            SimulationSource::SqlitePath(source_path) => {
                info!(
                    "Source DB not found at {}, checking for config file fallback...",
                    source_path.display()
                );
                load_simulation_config_fallback(config_path, "No simulation source DB was readable")
                    .await?
            }
        }
    } else {
        load_simulation_config_fallback(config_path, "No simulation source DB was readable").await?
    };

    Ok(config_export)
}

/// Open a source SQLite DB file with a temporary pool and export its full config.
async fn export_from_sqlite_source_db(db_path: &Path) -> Result<ConfigExport> {
    let url = format!("sqlite:{}?mode=ro", db_path.display());
    let pool = SqlitePool::connect(&url).await?;

    // Read integrations
    let int_rows: Vec<(String, String, String, bool)> =
        sqlx::query_as("SELECT id, plugin, config, enabled FROM integrations ORDER BY id")
            .fetch_all(&pool)
            .await?;
    let integrations: Vec<IntegrationRow> = int_rows
        .into_iter()
        .map(|(id, plugin, config, enabled)| IntegrationRow {
            id,
            plugin,
            config: serde_json::from_str(&config).unwrap_or_default(),
            enabled,
        })
        .collect();

    // Read core config
    let core_row: Option<(i32,)> =
        sqlx::query_as("SELECT warmup_time_seconds FROM core_config WHERE id = 1")
            .fetch_optional(&pool)
            .await?;
    let core = config_queries::CoreConfigRow {
        warmup_time_seconds: core_row.map(|(w,)| w).unwrap_or(1),
    };

    // Read groups
    let group_rows: Vec<(String, String, bool)> =
        sqlx::query_as("SELECT id, name, hidden FROM groups ORDER BY name")
            .fetch_all(&pool)
            .await?;
    let mut groups = Vec::new();
    for (id, name, hidden) in group_rows {
        let devices: Vec<(String, String)> = sqlx::query_as(
            "SELECT integration_id, COALESCE(device_id, device_name) AS device_id FROM group_devices WHERE group_id = ?",
        )
        .bind(&id)
        .fetch_all(&pool)
        .await?;
        let linked: Vec<(String,)> =
            sqlx::query_as("SELECT linked_group_id FROM group_links WHERE group_id = ?")
                .bind(&id)
                .fetch_all(&pool)
                .await?;
        groups.push(GroupRow {
            id,
            name,
            hidden,
            devices: devices
                .into_iter()
                .map(|(iid, did)| config_queries::GroupDeviceRow {
                    integration_id: iid,
                    device_id: did,
                })
                .collect(),
            linked_groups: linked.into_iter().map(|(g,)| g).collect(),
        });
    }

    // Read scenes
    let scene_rows: Vec<(String, String, bool, Option<String>)> =
        sqlx::query_as("SELECT id, name, hidden, script FROM scenes ORDER BY name")
            .fetch_all(&pool)
            .await?;
    let mut scenes = Vec::new();
    for (id, name, hidden, script) in scene_rows {
        let ds: Vec<(String, String)> =
            sqlx::query_as("SELECT device_key, config FROM scene_device_states WHERE scene_id = ?")
                .bind(&id)
                .fetch_all(&pool)
                .await?;
        let gs: Vec<(String, String)> =
            sqlx::query_as("SELECT group_id, config FROM scene_group_states WHERE scene_id = ?")
                .bind(&id)
                .fetch_all(&pool)
                .await?;
        scenes.push(SceneRow {
            id,
            name,
            hidden,
            script,
            device_states: ds
                .into_iter()
                .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
                .collect(),
            group_states: gs
                .into_iter()
                .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
                .collect(),
        });
    }

    // Read routines
    let routine_rows: Vec<(String, String, bool, String, String)> =
        sqlx::query_as("SELECT id, name, enabled, rules, actions FROM routines ORDER BY name")
            .fetch_all(&pool)
            .await?;
    let routines: Vec<RoutineRow> = routine_rows
        .into_iter()
        .map(|(id, name, enabled, rules, actions)| RoutineRow {
            id,
            name,
            enabled,
            rules: serde_json::from_str(&rules).unwrap_or_default(),
            actions: serde_json::from_str(&actions).unwrap_or_default(),
        })
        .collect();

    // Read floorplans. Prefer the new multi-floorplan table, but fall back to the
    // legacy single-row table so simulation still works against older DBs.
    let mut floorplans: Vec<config_queries::FloorplanExportRow> = match sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<Vec<u8>>,
            Option<String>,
            Option<i32>,
            Option<i32>,
            Option<String>,
        ),
    >(
        "SELECT id, name, image_data, image_mime_type, width, height, grid_data \
         FROM floorplans ORDER BY sort_order, name",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(
                |(id, name, image_data, image_mime_type, width, height, grid_data)| {
                    config_queries::FloorplanExportRow {
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
            .collect(),
        Err(_) => {
            let legacy_floorplan: Option<(
                Option<Vec<u8>>,
                Option<String>,
                Option<i32>,
                Option<i32>,
                Option<String>,
            )> = sqlx::query_as(
                "SELECT image_data, image_mime_type, width, height, grid_data FROM floorplan LIMIT 1",
            )
            .fetch_optional(&pool)
            .await?;

            legacy_floorplan
                .map(|(image_data, image_mime_type, width, height, grid_data)| {
                    vec![config_queries::FloorplanExportRow {
                        id: "default".to_string(),
                        name: "Main floorplan".to_string(),
                        image_data,
                        image_mime_type,
                        width,
                        height,
                        grid_data,
                    }]
                })
                .unwrap_or_default()
        }
    };
    floorplans.retain(|floorplan| !is_empty_default_floorplan_stub(floorplan));
    let floorplan = floorplans
        .iter()
        .find(|floorplan| floorplan.id == "default")
        .map(|floorplan| config_queries::FloorplanRow {
            image_data: floorplan.image_data.clone(),
            image_mime_type: floorplan.image_mime_type.clone(),
            width: floorplan.width,
            height: floorplan.height,
        });

    let display_override_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT device_key, display_name FROM device_display_overrides ORDER BY device_key",
    )
    .fetch_all(&pool)
    .await?;
    let device_display_overrides = display_override_rows
        .into_iter()
        .map(
            |(device_key, display_name)| config_queries::DeviceDisplayNameRow {
                device_key,
                display_name,
            },
        )
        .collect();

    // Read dashboard layouts + widgets
    let layout_rows: Vec<(i32, String, bool)> =
        sqlx::query_as("SELECT id, name, is_default FROM dashboard_layouts ORDER BY id")
            .fetch_all(&pool)
            .await?;
    let mut dashboard_widgets = Vec::new();
    let mut dashboard_layouts = Vec::new();
    for (id, name, is_default) in layout_rows {
        dashboard_layouts.push(config_queries::DashboardLayoutRow {
            id,
            name,
            is_default,
        });
        let widgets: Vec<(i32, i32, String, String, i32, i32, i32, i32, i32)> = sqlx::query_as(
            "SELECT id, layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order \
             FROM dashboard_widgets WHERE layout_id = ? ORDER BY sort_order",
        )
        .bind(id)
        .fetch_all(&pool)
        .await?;
        for (wid, lid, wtype, wconfig, gx, gy, gw, gh, so) in widgets {
            dashboard_widgets.push(config_queries::DashboardWidgetRow {
                id: wid,
                layout_id: lid,
                widget_type: wtype,
                config: serde_json::from_str(&wconfig).unwrap_or_default(),
                grid_x: gx,
                grid_y: gy,
                grid_w: gw,
                grid_h: gh,
                sort_order: so,
            });
        }
    }

    pool.close().await;

    Ok(ConfigExport {
        version: 1,
        core,
        integrations,
        groups,
        scenes,
        routines,
        floorplan,
        floorplans,
        group_positions: Vec::new(),
        device_display_overrides,
        device_sensor_configs: Vec::new(),
        dashboard_layouts,
        dashboard_widgets,
    })
}

async fn export_from_postgres_source_db(database_url: &str) -> Result<ConfigExport> {
    let pool = PgPool::connect(database_url).await?;

    let int_rows: Vec<(String, String, String, bool)> =
        sqlx::query_as("SELECT id, plugin, config, enabled FROM integrations ORDER BY id")
            .fetch_all(&pool)
            .await?;
    let integrations: Vec<IntegrationRow> = int_rows
        .into_iter()
        .map(|(id, plugin, config, enabled)| IntegrationRow {
            id,
            plugin,
            config: serde_json::from_str(&config).unwrap_or_default(),
            enabled,
        })
        .collect();

    let core_row: Option<(i32,)> =
        sqlx::query_as("SELECT warmup_time_seconds FROM core_config WHERE id = 1")
            .fetch_optional(&pool)
            .await?;
    let core = config_queries::CoreConfigRow {
        warmup_time_seconds: core_row.map(|(w,)| w).unwrap_or(1),
    };

    let group_rows: Vec<(String, String, bool)> =
        sqlx::query_as("SELECT id, name, hidden FROM groups ORDER BY name")
            .fetch_all(&pool)
            .await?;
    let mut groups = Vec::new();
    for (id, name, hidden) in group_rows {
        let devices: Vec<(String, String)> = sqlx::query_as(
            "SELECT integration_id, device_id FROM group_devices WHERE group_id = $1 ORDER BY sort_order",
        )
        .bind(&id)
        .fetch_all(&pool)
        .await?;
        let linked: Vec<(String,)> = sqlx::query_as(
            "SELECT child_group_id FROM group_links WHERE parent_group_id = $1 ORDER BY sort_order",
        )
        .bind(&id)
        .fetch_all(&pool)
        .await?;
        groups.push(GroupRow {
            id,
            name,
            hidden,
            devices: devices
                .into_iter()
                .map(|(iid, did)| config_queries::GroupDeviceRow {
                    integration_id: iid,
                    device_id: did,
                })
                .collect(),
            linked_groups: linked.into_iter().map(|(g,)| g).collect(),
        });
    }

    let scene_rows: Vec<(String, String, bool, Option<String>)> =
        sqlx::query_as("SELECT id, name, hidden, script FROM scenes ORDER BY name")
            .fetch_all(&pool)
            .await?;
    let mut scenes = Vec::new();
    for (id, name, hidden, script) in scene_rows {
        let ds: Vec<(String, String)> = sqlx::query_as(
            "SELECT device_key, config FROM scene_device_states WHERE scene_id = $1",
        )
        .bind(&id)
        .fetch_all(&pool)
        .await?;
        let gs: Vec<(String, String)> =
            sqlx::query_as("SELECT group_id, config FROM scene_group_states WHERE scene_id = $1")
                .bind(&id)
                .fetch_all(&pool)
                .await?;
        scenes.push(SceneRow {
            id,
            name,
            hidden,
            script,
            device_states: ds
                .into_iter()
                .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
                .collect(),
            group_states: gs
                .into_iter()
                .map(|(k, v)| (k, serde_json::from_str(&v).unwrap_or_default()))
                .collect(),
        });
    }

    let routine_rows: Vec<(String, String, bool, String, String)> =
        sqlx::query_as("SELECT id, name, enabled, rules, actions FROM routines ORDER BY name")
            .fetch_all(&pool)
            .await?;
    let routines: Vec<RoutineRow> = routine_rows
        .into_iter()
        .map(|(id, name, enabled, rules, actions)| RoutineRow {
            id,
            name,
            enabled,
            rules: serde_json::from_str(&rules).unwrap_or_default(),
            actions: serde_json::from_str(&actions).unwrap_or_default(),
        })
        .collect();

    let mut floorplans: Vec<config_queries::FloorplanExportRow> = sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<Vec<u8>>,
            Option<String>,
            Option<i32>,
            Option<i32>,
            Option<String>,
        ),
    >(
        "SELECT id, name, image_data, image_mime_type, width, height, grid_data \
         FROM floorplans ORDER BY sort_order, name",
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .map(
        |(id, name, image_data, image_mime_type, width, height, grid_data)| {
            config_queries::FloorplanExportRow {
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
    .collect();
    floorplans.retain(|floorplan| !is_empty_default_floorplan_stub(floorplan));
    let floorplan = floorplans
        .iter()
        .find(|floorplan| floorplan.id == "default")
        .map(|floorplan| config_queries::FloorplanRow {
            image_data: floorplan.image_data.clone(),
            image_mime_type: floorplan.image_mime_type.clone(),
            width: floorplan.width,
            height: floorplan.height,
        });

    let group_position_rows: Vec<(String, f32, f32, f32, f32, i32)> = sqlx::query_as(
        "SELECT group_id, x, y, width, height, z_index FROM group_positions ORDER BY group_id",
    )
    .fetch_all(&pool)
    .await?;
    let group_positions = group_position_rows
        .into_iter()
        .map(
            |(group_id, x, y, width, height, z_index)| config_queries::GroupPositionRow {
                group_id,
                x,
                y,
                width,
                height,
                z_index,
            },
        )
        .collect();

    let display_override_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT device_key, display_name FROM device_display_overrides ORDER BY device_key",
    )
    .fetch_all(&pool)
    .await?;
    let device_display_overrides = display_override_rows
        .into_iter()
        .map(
            |(device_key, display_name)| config_queries::DeviceDisplayNameRow {
                device_key,
                display_name,
            },
        )
        .collect();

    let device_sensor_config_rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT device_ref, interaction_kind, config_json FROM device_sensor_configs ORDER BY device_ref",
    )
    .fetch_all(&pool)
    .await?;
    let device_sensor_configs = device_sensor_config_rows
        .into_iter()
        .map(
            |(device_ref, interaction_kind, config_json)| config_queries::DeviceSensorConfigRow {
                device_ref,
                interaction_kind,
                config: serde_json::from_str(&config_json).unwrap_or_default(),
            },
        )
        .collect();

    let layout_rows: Vec<(i32, String, bool)> =
        sqlx::query_as("SELECT id, name, is_default FROM dashboard_layouts ORDER BY id")
            .fetch_all(&pool)
            .await?;
    let mut dashboard_widgets = Vec::new();
    let mut dashboard_layouts = Vec::new();
    for (id, name, is_default) in layout_rows {
        dashboard_layouts.push(config_queries::DashboardLayoutRow {
            id,
            name,
            is_default,
        });
        let widgets: Vec<(i32, i32, String, String, i32, i32, i32, i32, i32)> = sqlx::query_as(
            "SELECT id, layout_id, widget_type, config, grid_x, grid_y, grid_w, grid_h, sort_order \
             FROM dashboard_widgets WHERE layout_id = $1 ORDER BY sort_order",
        )
        .bind(id)
        .fetch_all(&pool)
        .await?;
        for (wid, lid, wtype, wconfig, gx, gy, gw, gh, so) in widgets {
            dashboard_widgets.push(config_queries::DashboardWidgetRow {
                id: wid,
                layout_id: lid,
                widget_type: wtype,
                config: serde_json::from_str(&wconfig).unwrap_or_default(),
                grid_x: gx,
                grid_y: gy,
                grid_w: gw,
                grid_h: gh,
                sort_order: so,
            });
        }
    }

    pool.close().await;

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
        dashboard_layouts,
        dashboard_widgets,
    })
}

/// Parse a JSON export backup config file into a ConfigExport.
async fn export_from_config_file(config_path: &str) -> Result<ConfigExport> {
    let path = Path::new(config_path);
    if !path.exists() {
        return Err(eyre!("Config file not found: {config_path}"));
    }

    info!("Reading simulation config from file: {config_path}");
    let config_str = std::fs::read_to_string(path)?;
    let parsed = parse_config_backup(&config_str).map_err(|e| eyre!(e))?;

    Ok(match parsed {
        ParsedConfigBackup::JsonExport(config) => config,
    })
}

#[derive(Clone, Copy)]
enum SimulationSource<'a> {
    Postgres(&'a str),
    SqlitePath(&'a Path),
}

fn resolve_simulation_source(source_db: &str) -> SimulationSource<'_> {
    if is_postgres_database_url(source_db) {
        SimulationSource::Postgres(source_db)
    } else {
        SimulationSource::SqlitePath(Path::new(source_db))
    }
}

fn is_postgres_database_url(source_db: &str) -> bool {
    source_db.starts_with("postgres://") || source_db.starts_with("postgresql://")
}

async fn load_simulation_config_fallback(
    config_path: Option<&str>,
    reason: &str,
) -> Result<ConfigExport> {
    match config_path {
        Some(path) => export_from_config_file(path).await,
        None => Err(eyre!("{reason} and no --config backup file provided")),
    }
}

fn config_export_has_data(config: &ConfigExport) -> bool {
    !config.integrations.is_empty()
        || !config.groups.is_empty()
        || !config.scenes.is_empty()
        || !config.routines.is_empty()
        || config.floorplan.is_some()
        || !config.floorplans.is_empty()
        || !config.group_positions.is_empty()
        || !config.device_display_overrides.is_empty()
        || !config.device_sensor_configs.is_empty()
        || config
            .dashboard_layouts
            .iter()
            .any(|layout| layout.id != 1 || layout.name != "Default" || !layout.is_default)
        || !config.dashboard_widgets.is_empty()
}

fn is_empty_default_floorplan_stub(floorplan: &config_queries::FloorplanExportRow) -> bool {
    floorplan.id == "default"
        && floorplan.name == "Main floorplan"
        && floorplan.image_data.is_none()
        && floorplan.image_mime_type.is_none()
        && floorplan.width.is_none()
        && floorplan.height.is_none()
        && floorplan.grid_data.is_none()
}

/// Rewrite all MQTT integrations in the simulation snapshot as dummy equivalents.
/// Discovers devices by scanning groups, scenes, and routines for references
/// to each MQTT integration.
pub fn convert_mqtt_to_dummy(config: &mut ConfigExport) -> Result<()> {
    let mqtt_ids: Vec<String> = config
        .integrations
        .iter()
        .filter(|i| i.plugin == "mqtt")
        .map(|i| i.id.clone())
        .collect();

    if mqtt_ids.is_empty() {
        info!("No MQTT integrations found, nothing to convert");
        return Ok(());
    }

    // Collect sensor device keys from routine rules
    let sensor_keys = collect_sensor_device_keys(&config.routines);

    for mqtt_id in mqtt_ids {
        let mut devices: HashMap<String, serde_json::Value> = HashMap::new();

        // 1. Scan groups for device references
        for group in &config.groups {
            for gd in &group.devices {
                if gd.integration_id == mqtt_id {
                    let device_id = gd.device_id.clone();
                    let key = format!("{mqtt_id}/{device_id}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices
                        .entry(device_id.clone())
                        .or_insert_with(|| build_dummy_device_config(&device_id, is_sensor));
                }
            }
        }

        // 2. Scan scene device_states for device keys under this integration
        for scene in &config.scenes {
            for device_key_str in scene.device_states.keys() {
                if let Some((iid, did)) = device_key_str.split_once('/') {
                    if iid == mqtt_id {
                        let is_sensor = sensor_keys.contains(device_key_str);
                        devices
                            .entry(did.to_string())
                            .or_insert_with(|| build_dummy_device_config(did, is_sensor));
                    }
                }
            }
        }

        // 3. Scan routine rules for direct device references under this integration
        for routine in &config.routines {
            collect_device_refs_from_rules(&routine.rules, &mqtt_id, &sensor_keys, &mut devices);
        }

        if devices.is_empty() {
            warn!(
                "MQTT integration '{mqtt_id}' has no discoverable devices — \
                 creating empty dummy integration"
            );
        } else {
            info!(
                "Converting MQTT integration '{mqtt_id}' to dummy with {} devices",
                devices.len()
            );
        }

        // Build DummyConfig JSON and rewrite the integration row
        let dummy_config = json!({ "devices": devices });
        let row = IntegrationRow {
            id: mqtt_id.to_string(),
            plugin: "dummy".to_string(),
            config: dummy_config,
            enabled: true,
        };

        if let Some(existing) = config
            .integrations
            .iter_mut()
            .find(|integration| integration.id == mqtt_id)
        {
            *existing = row;
        }
    }

    Ok(())
}

/// Build a DummyDeviceConfig JSON value for a single device.
fn build_dummy_device_config(name: &str, is_sensor: bool) -> serde_json::Value {
    if is_sensor {
        json!({
            "name": name,
            "init_state": {
                "Sensor": {
                    "value": false
                }
            }
        })
    } else {
        json!({
            "name": name,
            "init_state": {
                "Controllable": {
                    "state": {
                        "power": false,
                        "color": null,
                        "brightness": null,
                        "transition_ms": null
                    },
                    "capabilities": {
                        "color_modes": ["Hs"],
                        "brightness_range": [0.0, 1.0]
                    },
                    "managed": "Full"
                }
            }
        })
    }
}

/// Collect device keys (as "integration_id/device_id") that appear in Sensor rules.
fn collect_sensor_device_keys(routines: &[RoutineRow]) -> HashSet<String> {
    let mut sensor_keys = HashSet::new();

    for routine in routines {
        collect_sensors_from_value(&routine.rules, &mut sensor_keys);
    }

    sensor_keys
}

/// Recursively scan a JSON value for Sensor rule patterns and extract device keys.
/// Sensor rules contain `"state": { "value": ... }` (untagged SensorDevice format)
/// and a device reference with `"integration_id"` + `"device_id"` or `"name"`.
fn collect_sensors_from_value(value: &serde_json::Value, sensor_keys: &mut HashSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            // Check if this object looks like a sensor rule: has "state" with a "value" key
            // SensorDevice is #[serde(untagged)], so it serializes as {"value": ...}
            let has_sensor_state = map
                .get("state")
                .is_some_and(|s| s.is_object() && s.get("value").is_some());

            if has_sensor_state {
                if let Some(iid) = map.get("integration_id").and_then(|v| v.as_str()) {
                    if let Some(did) = map.get("device_id").and_then(|v| v.as_str()) {
                        sensor_keys.insert(format!("{iid}/{did}"));
                    }
                    if let Some(name) = map.get("name").and_then(|v| v.as_str()) {
                        sensor_keys.insert(format!("{iid}/{name}"));
                    }
                }
            }

            // Recurse into all values
            for v in map.values() {
                collect_sensors_from_value(v, sensor_keys);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_sensors_from_value(v, sensor_keys);
            }
        }
        _ => {}
    }
}

/// Scan routine rules JSON for device references belonging to a specific integration.
fn collect_device_refs_from_rules(
    rules: &serde_json::Value,
    integration_id: &str,
    sensor_keys: &HashSet<String>,
    devices: &mut HashMap<String, serde_json::Value>,
) {
    match rules {
        serde_json::Value::Object(map) => {
            // Check if this has an integration_id matching ours
            let matches_integration = map
                .get("integration_id")
                .and_then(|v| v.as_str())
                .is_some_and(|iid| iid == integration_id);

            if matches_integration {
                if let Some(did) = map.get("device_id").and_then(|v| v.as_str()) {
                    let key = format!("{integration_id}/{did}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices
                        .entry(did.to_string())
                        .or_insert_with(|| build_dummy_device_config(did, is_sensor));
                }
                if let Some(name) = map.get("name").and_then(|v| v.as_str()) {
                    let key = format!("{integration_id}/{name}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices
                        .entry(name.to_string())
                        .or_insert_with(|| build_dummy_device_config(name, is_sensor));
                }
            }

            for v in map.values() {
                collect_device_refs_from_rules(v, integration_id, sensor_keys, devices);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_device_refs_from_rules(v, integration_id, sensor_keys, devices);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::export_from_config_file;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_temp_config_file(suffix: &str, contents: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("homectl-sim-config-{unique}.{suffix}"));
        fs::write(&path, contents).expect("temp config file should be written");
        path
    }

    #[tokio::test]
    async fn export_from_config_file_accepts_json_backup() {
        let path = write_temp_config_file(
            "json",
            &serde_json::json!({
                "version": 1,
                "core": { "warmup_time_seconds": 3 },
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
            .to_string(),
        );

        let config = export_from_config_file(path.to_str().expect("utf-8 path"))
            .await
            .expect("json backup should load");

        assert_eq!(config.core.warmup_time_seconds, 3);
        assert_eq!(config.integrations.len(), 1);
        assert_eq!(config.integrations[0].plugin, "dummy");

        fs::remove_file(path).expect("temp config file should be removed");
    }

    #[tokio::test]
    async fn export_from_config_file_rejects_legacy_toml() {
        let path = write_temp_config_file(
            "toml",
            r#"
[core]
warmup_time_seconds = 9

[integrations.zigbee2mqtt]
plugin = "mqtt"
host = "mqtt.example.org"

[routines.entryway_motion]
name = "Entryway motion"
rules = [
  { integration_id = "zigbee2mqtt", name = "Entryway motion sensor", state = { value = true } }
]
actions = []
"#,
        );

        let error = export_from_config_file(path.to_str().expect("utf-8 path"))
            .await
            .expect_err("legacy toml should be rejected");

        assert!(error.to_string().contains("JSON export"));

        fs::remove_file(path).expect("temp config file should be removed");
    }
}
