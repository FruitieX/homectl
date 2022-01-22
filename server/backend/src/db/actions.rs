use super::entities::prelude::*;
use super::entities::*;
use super::get_db_connection;
use anyhow::Context;
use anyhow::Result;
use homectl_types::device::Device;
use homectl_types::device::DeviceSceneState;
use homectl_types::device::DeviceStateKey;
use homectl_types::integration::IntegrationId;
use sea_orm::entity::prelude::*;
use sea_orm::ActiveValue::Set;

pub async fn db_update_device(device: &Device) -> Result<()> {
    let db = get_db_connection().await?;
    let scene_id = device.get_scene_id().map(|scene_id| scene_id.to_string());

    let model = Devices::find()
        .filter(devices::Column::IntegrationId.eq(String::from(device.integration_id.clone())))
        .filter(devices::Column::DeviceId.eq(String::from(device.id.clone())))
        .one(db)
        .await?;

    let active_model = devices::ActiveModel {
        name: Set(device.name.to_string()),
        integration_id: Set(device.integration_id.to_string()),
        device_id: Set(device.id.to_string()),
        scene_id: Set(scene_id),
        state: Set(serde_json::to_string(&device.state).unwrap()),
        ..Default::default()
    };

    // Manual upsert until https://github.com/SeaQL/sea-orm/issues/187
    if model.is_some() {
        devices::Entity::update_many()
            .set(active_model)
            .filter(devices::Column::IntegrationId.eq(String::from(device.integration_id.clone())))
            .filter(devices::Column::DeviceId.eq(String::from(device.id.clone())))
            .exec(db)
            .await?;
    } else {
        active_model.insert(db).await?;
    }

    Ok(())
}

pub async fn db_find_device(key: &DeviceStateKey) -> Result<Device> {
    let db = get_db_connection().await?;

    let model = Devices::find()
        .filter(devices::Column::IntegrationId.eq(String::from(key.integration_id.clone())))
        .filter(devices::Column::DeviceId.eq(String::from(key.device_id.clone())))
        .one(db)
        .await?
        .context("Device not found in DB")?;

    let device = Device {
        id: model.device_id.into(),
        name: model.name,
        integration_id: model.integration_id.into(),
        scene: model
            .scene_id
            .map(|scene_id| DeviceSceneState::new(scene_id.into())),
        state: serde_json::from_str(&model.state).unwrap(),
    };

    Ok(device)
}

pub async fn db_get_neato_last_run(
    integration_id: &IntegrationId,
) -> Result<chrono::NaiveDateTime> {
    let db = get_db_connection().await?;

    let model = IntegrationNeato::find()
        .filter(integration_neato::Column::IntegrationId.eq(String::from(integration_id.clone())))
        .one(db)
        .await?
        .context("Neato last run not found in DB")?;

    let last_run = serde_json::from_str(&model.last_run).unwrap();

    Ok(last_run)
}
pub async fn db_set_neato_last_run(
    integration_id: &IntegrationId,
    last_run: chrono::NaiveDateTime,
) -> Result<()> {
    let db = get_db_connection().await?;

    let model = IntegrationNeato::find()
        .filter(integration_neato::Column::IntegrationId.eq(String::from(integration_id.clone())))
        .one(db)
        .await?;

    let active_model = integration_neato::ActiveModel {
        integration_id: Set(integration_id.to_string()),
        last_run: Set(serde_json::to_string(&last_run).unwrap()),
    };

    // Manual upsert until https://github.com/SeaQL/sea-orm/issues/187
    if model.is_some() {
        integration_neato::Entity::update_many()
            .set(active_model)
            .filter(devices::Column::IntegrationId.eq(String::from(integration_id.clone())))
            .exec(db)
            .await?;
    } else {
        active_model.insert(db).await?;
    }

    Ok(())
}
