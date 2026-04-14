use std::collections::{BTreeMap, HashMap};

use super::get_db_connection;
use crate::types::device::{Device, DeviceData, DeviceKey};
use crate::types::group::GroupId;
use crate::types::integration::IntegrationId;
use crate::types::scene::{
    SceneConfig, SceneDeviceConfig, SceneDevicesConfig, SceneDevicesSearchConfig,
    SceneGroupsConfig, SceneId, SceneOverridesConfig, ScenesConfig,
};
use color_eyre::Result;

pub async fn db_update_device(device: &Device) -> Result<Device> {
    let db = get_db_connection()?;

    let state_str = serde_json::to_string(&device.data)?;

    sqlx::query(
        "INSERT INTO devices (integration_id, device_id, name, state) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (integration_id, device_id) DO UPDATE SET \
             name = excluded.name, state = excluded.state",
    )
    .bind(&device.integration_id.to_string())
    .bind(&device.id.to_string())
    .bind(&device.name)
    .bind(&state_str)
    .execute(db)
    .await?;

    Ok(device.clone())
}

#[allow(dead_code)]
pub async fn db_find_device(key: &DeviceKey) -> Result<Option<Device>> {
    let db = get_db_connection()?;

    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT integration_id, device_id, name, state FROM devices \
         WHERE integration_id = $1 AND device_id = $2",
    )
    .bind(&key.integration_id.to_string())
    .bind(&key.device_id.to_string())
    .fetch_optional(db)
    .await?;

    Ok(row.and_then(|(integration_id, device_id, name, state)| {
        let data: DeviceData = match serde_json::from_str(&state) {
            Ok(d) => d,
            Err(e) => {
                warn!("Failed to parse device state: {e}");
                return None;
            }
        };
        Some(Device {
            id: device_id.into(),
            integration_id: integration_id.into(),
            name,
            data,
            raw: None,
        })
    }))
}

pub async fn db_get_devices() -> Result<HashMap<DeviceKey, Device>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String, String, String)> =
        sqlx::query_as("SELECT integration_id, device_id, name, state FROM devices")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .filter_map(|(integration_id, device_id, name, state)| {
            let key = DeviceKey::new(integration_id.clone().into(), device_id.clone().into());
            let data: DeviceData = match serde_json::from_str(&state) {
                Ok(d) => d,
                Err(e) => {
                    warn!("Failed to parse device state for {integration_id}/{device_id}: {e}");
                    return None;
                }
            };
            let device = Device {
                id: device_id.into(),
                integration_id: integration_id.into(),
                name,
                data,
                raw: None,
            };
            Some((key, device))
        })
        .collect())
}

pub async fn db_get_scenes() -> Result<ScenesConfig> {
    let db = get_db_connection()?;

    let scene_rows: Vec<(String, String, Option<bool>, Option<String>)> =
        sqlx::query_as("SELECT id, name, hidden, script FROM scenes")
            .fetch_all(db)
            .await?;

    let mut scenes = ScenesConfig::new();

    for (id, name, hidden, script) in scene_rows {
        let device_states: Vec<(String, String)> = sqlx::query_as(
            "SELECT device_key, config FROM scene_device_states WHERE scene_id = $1",
        )
        .bind(&id)
        .fetch_all(db)
        .await
        .unwrap_or_default();

        let group_states: Vec<(String, String)> =
            sqlx::query_as("SELECT group_id, config FROM scene_group_states WHERE scene_id = $1")
                .bind(&id)
                .fetch_all(db)
                .await
                .unwrap_or_default();

        // Convert device states to SceneDevicesSearchConfig
        let devices = if device_states.is_empty() {
            None
        } else {
            let mut devices_map: BTreeMap<IntegrationId, BTreeMap<String, SceneDeviceConfig>> =
                BTreeMap::new();
            for (device_key, config_json) in &device_states {
                if let Some((integration_id, device_name)) = device_key.split_once('/') {
                    match serde_json::from_str::<SceneDeviceConfig>(config_json) {
                        Ok(config) => {
                            devices_map
                                .entry(IntegrationId::from(integration_id.to_string()))
                                .or_default()
                                .insert(device_name.to_string(), config);
                        }
                        Err(e) => {
                            warn!(
                                "Failed to parse scene device config for {}: {e}",
                                device_key
                            );
                        }
                    }
                }
            }
            Some(SceneDevicesSearchConfig(devices_map))
        };

        // Convert group states to SceneGroupsConfig
        let groups = if group_states.is_empty() {
            None
        } else {
            let mut groups_map: BTreeMap<GroupId, SceneDeviceConfig> = BTreeMap::new();
            for (group_id, config_json) in &group_states {
                match serde_json::from_str::<SceneDeviceConfig>(config_json) {
                    Ok(config) => {
                        groups_map.insert(GroupId(group_id.clone()), config);
                    }
                    Err(e) => {
                        warn!("Failed to parse scene group config for {}: {e}", group_id);
                    }
                }
            }
            Some(SceneGroupsConfig(groups_map))
        };

        let config = SceneConfig {
            name,
            hidden,
            devices,
            groups,
            script,
        };

        scenes.insert(SceneId::new(id), config);
    }

    Ok(scenes)
}

pub async fn db_store_scene(scene_id: &SceneId, config: &SceneConfig) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query(
        "INSERT INTO scenes (id, name, hidden, script, updated_at) \
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) \
         ON CONFLICT (id) DO UPDATE SET \
             name = excluded.name, hidden = excluded.hidden, script = excluded.script, \
             updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&scene_id.to_string())
    .bind(&config.name)
    .bind(config.hidden)
    .bind(&config.script)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_store_scene_overrides(
    scene_id: &SceneId,
    overrides: &SceneDevicesConfig,
) -> Result<()> {
    let db = get_db_connection()?;

    let overrides_str = serde_json::to_string(overrides)?;

    sqlx::query(
        "INSERT INTO scene_overrides (scene_id, overrides) VALUES ($1, $2) \
         ON CONFLICT (scene_id) DO UPDATE SET overrides = excluded.overrides",
    )
    .bind(&scene_id.to_string())
    .bind(&overrides_str)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_get_scene_overrides() -> Result<SceneOverridesConfig> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT scene_id, overrides FROM scene_overrides")
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .filter_map(|(scene_id, overrides)| {
            let overrides: SceneDevicesConfig = serde_json::from_str(&overrides).ok()?;
            Some((SceneId::new(scene_id), overrides))
        })
        .collect())
}

pub async fn db_delete_scene(scene_id: &SceneId) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query("DELETE FROM scenes WHERE id = $1")
        .bind(&scene_id.to_string())
        .execute(db)
        .await?;

    Ok(())
}

pub async fn db_edit_scene(scene_id: &SceneId, name: &str) -> Result<()> {
    let db = get_db_connection()?;

    sqlx::query("UPDATE scenes SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
        .bind(name)
        .bind(&scene_id.to_string())
        .execute(db)
        .await?;

    Ok(())
}

pub async fn db_store_ui_state(key: &str, value: &serde_json::Value) -> Result<()> {
    let db = get_db_connection()?;

    let value_str = serde_json::to_string(value)?;

    sqlx::query(
        "INSERT INTO ui_state (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(&value_str)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn db_get_ui_state() -> Result<HashMap<String, serde_json::Value>> {
    let db = get_db_connection()?;

    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM ui_state")
        .fetch_all(db)
        .await?;

    Ok(rows
        .into_iter()
        .filter_map(|(key, value)| {
            let value: serde_json::Value = serde_json::from_str(&value).ok()?;
            Some((key, value))
        })
        .collect())
}
