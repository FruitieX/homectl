use super::get_db_connection;
use anyhow::Result;
use homectl_types::device::{Device, DeviceRow, DeviceState, DeviceStateKey};
use homectl_types::integration::IntegrationId;
use homectl_types::scene::ScenesConfig;
use homectl_types::scene::{SceneConfig, SceneId};
use sqlx::types::Json;

pub async fn db_update_device(device: &Device) -> Result<Device> {
    let db = get_db_connection().await?;

    let row = sqlx::query_as!(
        DeviceRow,
        r#"
            insert into devices (integration_id, device_id, name, scene_id, state)
            values ($1, $2, $3, $4, $5)

            on conflict (integration_id, device_id)
            do update set
                name = excluded.name,
                scene_id = excluded.scene_id,
                state = excluded.state

            returning
                integration_id,
                device_id,
                name,
                scene_id,
                state as "state: Json<DeviceState>"
        "#,
        &device.integration_id.to_string(),
        &device.id.to_string(),
        &device.name,
        device.get_scene_id().map(|id| id.to_string()),
        Json(device.state.clone()) as _
    )
    .fetch_one(db)
    .await?;

    let device = row.into();

    Ok(device)
}

pub async fn db_find_device(key: &DeviceStateKey) -> Result<Device> {
    let db = get_db_connection().await?;

    let row = sqlx::query_as!(
        DeviceRow,
        r#"
            select
                integration_id,
                device_id,
                name,
                scene_id,
                state as "state: Json<DeviceState>"
            from devices
            where integration_id = $1
              and device_id = $2
        "#,
        &key.integration_id.to_string(),
        &key.device_id.to_string()
    )
    .fetch_one(db)
    .await?;

    let device = row.into();

    Ok(device)
}

pub async fn db_get_neato_last_run(
    integration_id: &IntegrationId,
) -> Result<chrono::NaiveDateTime> {
    let db = get_db_connection().await?;

    let row = sqlx::query!(
        r#"
            select last_run
            from integration_neato
            where integration_id = $1
        "#,
        &integration_id.to_string()
    )
    .fetch_one(db)
    .await?;

    let last_run = serde_json::from_str(&row.last_run).unwrap();

    Ok(last_run)
}

pub async fn db_set_neato_last_run(
    integration_id: &IntegrationId,
    last_run: chrono::NaiveDateTime,
) -> Result<()> {
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
            insert into integration_neato (integration_id, last_run)
            values ($1, $2)

            on conflict (integration_id)
            do update set
                last_run = excluded.last_run

            returning
                integration_id,
                last_run
        "#,
        &integration_id.to_string(),
        &serde_json::to_string(&last_run).unwrap()
    )
    .fetch_one(db)
    .await?;

    Ok(())
}

pub async fn db_get_scenes() -> Result<ScenesConfig> {
    let db = get_db_connection().await?;

    let rows = sqlx::query!(
        r#"
            select
                scene_id,
                config as "config: Json<SceneConfig>"

            from scenes
        "#
    )
    .fetch_all(db)
    .await?;

    let scenes = rows
        .into_iter()
        .map(|row| (SceneId::new(row.scene_id), row.config.0))
        .collect();

    Ok(scenes)
}

pub async fn db_store_scene(scene_id: &SceneId, config: &SceneConfig) -> Result<()> {
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
            insert into scenes (scene_id, config)
            values ($1, $2)

            on conflict (scene_id)
            do update set
                config = excluded.config
        "#,
        scene_id.to_string(),
        Json(config) as _
    )
    .fetch_one(db)
    .await?;

    Ok(())
}

pub async fn db_delete_scene(scene_id: &SceneId) -> Result<()> {
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
            delete from scenes
            where scene_id = $1
        "#,
        scene_id.to_string(),
    )
    .fetch_one(db)
    .await?;

    Ok(())
}
