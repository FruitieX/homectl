use super::get_db_connection;
use anyhow::Result;
use homectl_types::device::{Device, DeviceRow, DeviceState, DeviceStateKey};
use homectl_types::integration::IntegrationId;
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
