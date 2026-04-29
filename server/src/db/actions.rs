use std::collections::{BTreeMap, HashMap};

use super::get_db_connection;
use super::schema::{
    Devices, SceneDeviceStates, SceneGroupStates, SceneOverrides, Scenes, UiState,
};
use crate::types::device::{Device, DeviceData, DeviceKey};
use crate::types::group::GroupId;
use crate::types::integration::IntegrationId;
use crate::types::scene::{
    SceneConfig, SceneDeviceConfig, SceneDevicesConfig, SceneDevicesSearchConfig,
    SceneGroupsConfig, SceneId, SceneOverridesConfig, ScenesConfig,
};
use color_eyre::Result;
use sea_orm::sea_query::{Expr, OnConflict, Order, Query};
use sea_orm::{ConnectionTrait, QueryResult, Statement, StatementBuilder};

pub async fn db_update_device(device: &Device) -> Result<Device> {
    let db = get_db_connection()?;
    let state = serde_json::to_string(&device.data)?;

    db.execute(statement(
        db,
        Query::insert()
            .into_table(Devices::Table)
            .columns([
                Devices::IntegrationId,
                Devices::DeviceId,
                Devices::Name,
                Devices::State,
            ])
            .values_panic([
                device.integration_id.to_string().into(),
                device.id.to_string().into(),
                device.name.clone().into(),
                state.into(),
            ])
            .on_conflict(
                OnConflict::columns([Devices::IntegrationId, Devices::DeviceId])
                    .update_columns([Devices::Name, Devices::State])
                    .to_owned(),
            )
            .to_owned(),
    ))
    .await?;

    Ok(device.clone())
}

#[allow(dead_code)]
pub async fn db_find_device(key: &DeviceKey) -> Result<Option<Device>> {
    let db = get_db_connection()?;

    let row = db
        .query_one(statement(
            db,
            Query::select()
                .columns([
                    Devices::IntegrationId,
                    Devices::DeviceId,
                    Devices::Name,
                    Devices::State,
                ])
                .from(Devices::Table)
                .and_where(Expr::col(Devices::IntegrationId).eq(key.integration_id.to_string()))
                .and_where(Expr::col(Devices::DeviceId).eq(key.device_id.to_string()))
                .to_owned(),
        ))
        .await?;

    Ok(row.and_then(device_from_row))
}

pub async fn db_get_devices() -> Result<HashMap<DeviceKey, Device>> {
    let db = get_db_connection()?;

    let rows = db
        .query_all(statement(
            db,
            Query::select()
                .columns([
                    Devices::IntegrationId,
                    Devices::DeviceId,
                    Devices::Name,
                    Devices::State,
                ])
                .from(Devices::Table)
                .to_owned(),
        ))
        .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let device = device_from_row(row)?;
            let key = DeviceKey::new(device.integration_id.clone(), device.id.clone());
            Some((key, device))
        })
        .collect())
}

pub async fn db_delete_device(device_key: &DeviceKey) -> Result<bool> {
    let db = get_db_connection()?;

    let result = db
        .execute(statement(
            db,
            Query::delete()
                .from_table(Devices::Table)
                .and_where(
                    Expr::col(Devices::IntegrationId).eq(device_key.integration_id.to_string()),
                )
                .and_where(Expr::col(Devices::DeviceId).eq(device_key.device_id.to_string()))
                .to_owned(),
        ))
        .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn db_get_scenes() -> Result<ScenesConfig> {
    let db = get_db_connection()?;

    let scene_rows = db
        .query_all(statement(
            db,
            Query::select()
                .columns([Scenes::Id, Scenes::Name, Scenes::Hidden, Scenes::Script])
                .from(Scenes::Table)
                .to_owned(),
        ))
        .await?;

    let mut scenes = ScenesConfig::new();

    for row in scene_rows {
        let id: String = row.try_get("", "id")?;
        let name: String = row.try_get("", "name")?;
        let hidden: Option<bool> = row.try_get("", "hidden")?;
        let script: Option<String> = row.try_get("", "script")?;

        let device_states = scene_device_state_rows(db, &id).await.unwrap_or_default();
        let group_states = scene_group_state_rows(db, &id).await.unwrap_or_default();

        let devices = scene_device_search_config(&device_states);
        let groups = scene_group_config(&group_states);

        scenes.insert(
            SceneId::new(id),
            SceneConfig {
                name,
                hidden,
                devices,
                groups,
                script,
            },
        );
    }

    Ok(scenes)
}

pub async fn db_store_scene(scene_id: &SceneId, config: &SceneConfig) -> Result<()> {
    let db = get_db_connection()?;

    db.execute(statement(
        db,
        Query::insert()
            .into_table(Scenes::Table)
            .columns([Scenes::Id, Scenes::Name, Scenes::Hidden, Scenes::Script])
            .values_panic([
                scene_id.to_string().into(),
                config.name.clone().into(),
                config.hidden.into(),
                config.script.clone().into(),
            ])
            .on_conflict(
                OnConflict::column(Scenes::Id)
                    .update_columns([Scenes::Name, Scenes::Hidden, Scenes::Script])
                    .value(Scenes::UpdatedAt, Expr::current_timestamp())
                    .to_owned(),
            )
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_upsert_scene_device_state(
    scene_id: &SceneId,
    device_key: &str,
    config: &SceneDeviceConfig,
) -> Result<()> {
    let db = get_db_connection()?;
    let config = serde_json::to_string(config)?;

    db.execute(statement(
        db,
        Query::insert()
            .into_table(SceneDeviceStates::Table)
            .columns([
                SceneDeviceStates::SceneId,
                SceneDeviceStates::DeviceKey,
                SceneDeviceStates::Config,
            ])
            .values_panic([
                scene_id.to_string().into(),
                device_key.into(),
                config.into(),
            ])
            .on_conflict(
                OnConflict::columns([SceneDeviceStates::SceneId, SceneDeviceStates::DeviceKey])
                    .update_column(SceneDeviceStates::Config)
                    .to_owned(),
            )
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_upsert_scene_group_state(
    scene_id: &SceneId,
    group_id: &GroupId,
    config: &SceneDeviceConfig,
) -> Result<()> {
    let db = get_db_connection()?;
    let config = serde_json::to_string(config)?;

    db.execute(statement(
        db,
        Query::insert()
            .into_table(SceneGroupStates::Table)
            .columns([
                SceneGroupStates::SceneId,
                SceneGroupStates::GroupId,
                SceneGroupStates::Config,
            ])
            .values_panic([
                scene_id.to_string().into(),
                group_id.to_string().into(),
                config.into(),
            ])
            .on_conflict(
                OnConflict::columns([SceneGroupStates::SceneId, SceneGroupStates::GroupId])
                    .update_column(SceneGroupStates::Config)
                    .to_owned(),
            )
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_store_scene_overrides(
    scene_id: &SceneId,
    overrides: &SceneDevicesConfig,
) -> Result<()> {
    let db = get_db_connection()?;
    let overrides = serde_json::to_string(overrides)?;

    db.execute(statement(
        db,
        Query::insert()
            .into_table(SceneOverrides::Table)
            .columns([SceneOverrides::SceneId, SceneOverrides::Overrides])
            .values_panic([scene_id.to_string().into(), overrides.into()])
            .on_conflict(
                OnConflict::column(SceneOverrides::SceneId)
                    .update_column(SceneOverrides::Overrides)
                    .to_owned(),
            )
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_get_scene_overrides() -> Result<SceneOverridesConfig> {
    let db = get_db_connection()?;

    let rows = db
        .query_all(statement(
            db,
            Query::select()
                .columns([SceneOverrides::SceneId, SceneOverrides::Overrides])
                .from(SceneOverrides::Table)
                .to_owned(),
        ))
        .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let scene_id: String = row.try_get("", "scene_id").ok()?;
            let overrides: String = row.try_get("", "overrides").ok()?;
            let overrides: SceneDevicesConfig = serde_json::from_str(&overrides).ok()?;
            Some((SceneId::new(scene_id), overrides))
        })
        .collect())
}

pub async fn db_delete_scene(scene_id: &SceneId) -> Result<()> {
    let db = get_db_connection()?;

    db.execute(statement(
        db,
        Query::delete()
            .from_table(Scenes::Table)
            .and_where(Expr::col(Scenes::Id).eq(scene_id.to_string()))
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_edit_scene(scene_id: &SceneId, name: &str) -> Result<()> {
    let db = get_db_connection()?;

    db.execute(statement(
        db,
        Query::update()
            .table(Scenes::Table)
            .value(Scenes::Name, name)
            .value(Scenes::UpdatedAt, Expr::current_timestamp())
            .and_where(Expr::col(Scenes::Id).eq(scene_id.to_string()))
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_store_ui_state(key: &str, value: &serde_json::Value) -> Result<()> {
    let db = get_db_connection()?;
    let value = serde_json::to_string(value)?;

    db.execute(statement(
        db,
        Query::insert()
            .into_table(UiState::Table)
            .columns([UiState::Key, UiState::Value])
            .values_panic([key.into(), value.into()])
            .on_conflict(
                OnConflict::column(UiState::Key)
                    .update_column(UiState::Value)
                    .to_owned(),
            )
            .to_owned(),
    ))
    .await?;

    Ok(())
}

pub async fn db_get_ui_state() -> Result<HashMap<String, serde_json::Value>> {
    let db = get_db_connection()?;

    let rows = db
        .query_all(statement(
            db,
            Query::select()
                .columns([UiState::Key, UiState::Value])
                .from(UiState::Table)
                .to_owned(),
        ))
        .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let key: String = row.try_get("", "key").ok()?;
            let value: String = row.try_get("", "value").ok()?;
            let value = serde_json::from_str(&value).ok()?;
            Some((key, value))
        })
        .collect())
}

fn statement<C, S>(db: &C, builder: S) -> Statement
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    db.get_database_backend().build(&builder)
}

fn device_from_row(row: QueryResult) -> Option<Device> {
    let integration_id: String = row.try_get("", "integration_id").ok()?;
    let device_id: String = row.try_get("", "device_id").ok()?;
    let name: String = row.try_get("", "name").ok()?;
    let state: String = row.try_get("", "state").ok()?;
    let data: DeviceData = match serde_json::from_str(&state) {
        Ok(data) => data,
        Err(error) => {
            warn!("Failed to parse device state for {integration_id}/{device_id}: {error}");
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
}

async fn scene_device_state_rows<C: ConnectionTrait>(
    db: &C,
    scene_id: &str,
) -> Result<Vec<(String, String)>> {
    let rows = db
        .query_all(statement(
            db,
            Query::select()
                .columns([SceneDeviceStates::DeviceKey, SceneDeviceStates::Config])
                .from(SceneDeviceStates::Table)
                .and_where(Expr::col(SceneDeviceStates::SceneId).eq(scene_id))
                .order_by(SceneDeviceStates::DeviceKey, Order::Asc)
                .to_owned(),
        ))
        .await?;

    rows.into_iter()
        .map(|row| Ok((row.try_get("", "device_key")?, row.try_get("", "config")?)))
        .collect()
}

async fn scene_group_state_rows<C: ConnectionTrait>(
    db: &C,
    scene_id: &str,
) -> Result<Vec<(String, String)>> {
    let rows = db
        .query_all(statement(
            db,
            Query::select()
                .columns([SceneGroupStates::GroupId, SceneGroupStates::Config])
                .from(SceneGroupStates::Table)
                .and_where(Expr::col(SceneGroupStates::SceneId).eq(scene_id))
                .order_by(SceneGroupStates::GroupId, Order::Asc)
                .to_owned(),
        ))
        .await?;

    rows.into_iter()
        .map(|row| Ok((row.try_get("", "group_id")?, row.try_get("", "config")?)))
        .collect()
}

fn scene_device_search_config(
    device_states: &[(String, String)],
) -> Option<SceneDevicesSearchConfig> {
    if device_states.is_empty() {
        return None;
    }

    let mut devices_map: BTreeMap<IntegrationId, BTreeMap<String, SceneDeviceConfig>> =
        BTreeMap::new();
    for (device_key, config_json) in device_states {
        if let Some((integration_id, device_name)) = device_key.split_once('/') {
            match serde_json::from_str::<SceneDeviceConfig>(config_json) {
                Ok(config) => {
                    devices_map
                        .entry(IntegrationId::from(integration_id.to_string()))
                        .or_default()
                        .insert(device_name.to_string(), config);
                }
                Err(error) => {
                    warn!("Failed to parse scene device config for {device_key}: {error}");
                }
            }
        }
    }

    Some(SceneDevicesSearchConfig(devices_map))
}

fn scene_group_config(group_states: &[(String, String)]) -> Option<SceneGroupsConfig> {
    if group_states.is_empty() {
        return None;
    }

    let mut groups_map: BTreeMap<GroupId, SceneDeviceConfig> = BTreeMap::new();
    for (group_id, config_json) in group_states {
        match serde_json::from_str::<SceneDeviceConfig>(config_json) {
            Ok(config) => {
                groups_map.insert(GroupId(group_id.clone()), config);
            }
            Err(error) => {
                warn!("Failed to parse scene group config for {group_id}: {error}");
            }
        }
    }

    Some(SceneGroupsConfig(groups_map))
}
