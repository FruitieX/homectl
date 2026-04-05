//! Simulation mode: mirrors production config into an in-memory DB and
//! replaces MQTT integrations with dummy equivalents.

use crate::db::config_queries::{
    self, ConfigExport, GroupRow, IntegrationRow, RoutineRow, SceneRow,
};
use color_eyre::Result;
use eyre::eyre;
use serde_json::json;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Load config from a source database file into the (already initialized) in-memory DB.
/// If the source DB doesn't exist or is empty, falls back to the optional TOML config file.
pub async fn prepare_simulation_db(source_db_path: &str, config_path: Option<&str>) -> Result<()> {
    let source_path = Path::new(source_db_path);

    let config_export = if source_path.exists() {
        info!("Reading simulation config from source DB: {source_db_path}");
        let export = export_from_source_db(source_db_path).await?;

        if export.integrations.is_empty() {
            info!("Source DB is empty, checking for TOML fallback...");
            match config_path {
                Some(toml_path) => export_from_toml(toml_path).await?,
                None => return Err(eyre!("Source DB is empty and no --config TOML file provided")),
            }
        } else {
            export
        }
    } else {
        info!("Source DB not found at {source_db_path}, checking for TOML fallback...");
        match config_path {
            Some(toml_path) => export_from_toml(toml_path).await?,
            None => {
                return Err(eyre!(
                    "Source DB not found at {source_db_path} and no --config TOML file provided"
                ))
            }
        }
    };

    // Import into the in-memory DB (already initialized via init_db(":memory:"))
    config_queries::db_import_config(&config_export).await?;
    info!(
        "Imported {} integrations, {} groups, {} scenes, {} routines into simulation DB",
        config_export.integrations.len(),
        config_export.groups.len(),
        config_export.scenes.len(),
        config_export.routines.len(),
    );

    Ok(())
}

/// Open a source SQLite DB file with a temporary pool and export its full config.
async fn export_from_source_db(db_path: &str) -> Result<ConfigExport> {
    let url = format!("sqlite:{}?mode=ro", db_path);
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
        let devices: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT integration_id, device_name, device_id FROM group_devices WHERE group_id = ?",
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
                .map(|(iid, dn, did)| config_queries::GroupDeviceRow {
                    integration_id: iid,
                    device_name: dn,
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

    // Read floorplan (optional)
    let fp: Option<(Option<Vec<u8>>, Option<String>, Option<i32>, Option<i32>)> =
        sqlx::query_as("SELECT image_data, image_mime_type, width, height FROM floorplan LIMIT 1")
            .fetch_optional(&pool)
            .await?;
    let floorplan = fp.map(|(image_data, image_mime_type, width, height)| {
        config_queries::FloorplanRow {
            image_data,
            image_mime_type,
            width,
            height,
        }
    });

    // Read device positions
    let pos_rows: Vec<(String, f32, f32, f32, f32)> = sqlx::query_as(
        "SELECT device_key, x, y, scale, rotation FROM device_positions",
    )
    .fetch_all(&pool)
    .await?;
    let device_positions = pos_rows
        .into_iter()
        .map(
            |(device_key, x, y, scale, rotation)| config_queries::DevicePositionRow {
                device_key,
                x,
                y,
                scale,
                rotation,
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
        device_positions,
        dashboard_layouts,
        dashboard_widgets,
    })
}

/// Parse a TOML config file and convert it into a ConfigExport via the existing
/// migration/preview API.
async fn export_from_toml(toml_path: &str) -> Result<ConfigExport> {
    use crate::api::config::{apply_migration, parse_toml_config};

    let path = Path::new(toml_path);
    if !path.exists() {
        return Err(eyre!("TOML config file not found: {toml_path}"));
    }

    info!("Reading simulation config from TOML: {toml_path}");
    let toml_str = std::fs::read_to_string(path)?;
    let preview = parse_toml_config(&toml_str).map_err(|e| eyre!(e))?;

    // Apply the migration to seed the in-memory DB, then export the result
    apply_migration(&preview).await?;
    let export = config_queries::db_export_config().await?;
    Ok(export)
}

/// Rewrite all MQTT integrations in the in-memory DB as dummy equivalents.
/// Discovers devices by scanning groups, scenes, and routines for references
/// to each MQTT integration.
pub async fn convert_mqtt_to_dummy(
    integrations: &[IntegrationRow],
    groups: &[GroupRow],
    scenes: &[SceneRow],
    routines: &[RoutineRow],
) -> Result<()> {
    let mqtt_ids: Vec<&str> = integrations
        .iter()
        .filter(|i| i.plugin == "mqtt")
        .map(|i| i.id.as_str())
        .collect();

    if mqtt_ids.is_empty() {
        info!("No MQTT integrations found, nothing to convert");
        return Ok(());
    }

    // Collect sensor device keys from routine rules
    let sensor_keys = collect_sensor_device_keys(routines);

    for mqtt_id in &mqtt_ids {
        let mut devices: HashMap<String, serde_json::Value> = HashMap::new();

        // 1. Scan groups for device references
        for group in groups {
            for gd in &group.devices {
                if gd.integration_id == *mqtt_id {
                    let device_id = gd
                        .device_id
                        .clone()
                        .unwrap_or_else(|| gd.device_name.clone());
                    let key = format!("{mqtt_id}/{device_id}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices.entry(device_id).or_insert_with(|| {
                        build_dummy_device_config(&gd.device_name, is_sensor)
                    });
                }
            }
        }

        // 2. Scan scene device_states for device keys under this integration
        for scene in scenes {
            for device_key_str in scene.device_states.keys() {
                if let Some((iid, did)) = device_key_str.split_once('/') {
                    if iid == *mqtt_id {
                        let is_sensor = sensor_keys.contains(device_key_str);
                        devices.entry(did.to_string()).or_insert_with(|| {
                            build_dummy_device_config(did, is_sensor)
                        });
                    }
                }
            }
        }

        // 3. Scan routine rules for direct device references under this integration
        for routine in routines {
            collect_device_refs_from_rules(&routine.rules, mqtt_id, &sensor_keys, &mut devices);
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
        config_queries::db_upsert_integration(&row).await?;
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
