use super::get_db_connection;
use crate::types::device::{Device, DeviceData, DeviceKey, DeviceRow};
use crate::types::scene::ScenesConfig;
use crate::types::scene::{SceneConfig, SceneId};
use color_eyre::Result;
use sqlx::types::Json;

pub async fn db_update_device(device: &Device) -> Result<Device> {
    let db = get_db_connection().await?;

    let row = sqlx::query_as!(
        DeviceRow,
        r#"
            insert into devices (integration_id, device_id, name, state)
            values ($1, $2, $3, $4)

            on conflict (integration_id, device_id)
            do update set
                name = excluded.name,
                state = excluded.state

            returning
                integration_id,
                device_id,
                name,
                state as "state: Json<DeviceData>"
        "#,
        &device.integration_id.to_string(),
        &device.id.to_string(),
        &device.name,
        Json(device.data.clone()) as _
    )
    .fetch_one(db)
    .await?;

    let device = row.into();

    Ok(device)
}

pub async fn db_find_device(key: &DeviceKey) -> Result<Device> {
    let db = get_db_connection().await?;

    let row = sqlx::query_as!(
        DeviceRow,
        r#"
            select
                integration_id,
                device_id,
                name,
                state as "state: Json<DeviceData>"
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

pub async fn db_get_scenes() -> Result<ScenesConfig> {
    let db = get_db_connection().await?;

    let result = sqlx::query!(
        r#"
            select
                scene_id,
                config as "config: Json<SceneConfig>"

            from scenes
        "#
    )
    .fetch_all(db)
    .await;

    if let Err(err) = &result {
        error!("Error fetching scenes from DB: {:?}", err);
    }

    let scenes = result?
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

pub async fn db_edit_scene(scene_id: &SceneId, name: &String) -> Result<()> {
    let db = get_db_connection().await?;

    sqlx::query!(
        r#"
            update scenes
            set
                scene_id = $2,
                config = config::jsonb || format('{"name":"%s"}', $2::text)::jsonb
            where scene_id = $1;
        "#,
        scene_id.to_string(),
        name
    )
    .fetch_one(db)
    .await?;

    Ok(())
}
