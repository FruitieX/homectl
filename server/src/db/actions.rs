use super::models::*;
use super::PG_POOL;
use anyhow::Result;
use diesel::prelude::*;
use homectl_types::device;

// pub fn find_floorplans(conn: &PgConnection) -> Result<Vec<Floorplan>> {
//     use super::schema::floorplans::dsl::*;

//     let result = floorplans.load::<Floorplan>(conn)?;

//     Ok(result)
// }

pub fn db_update_device(device: &device::Device) -> Result<usize> {
    let scene_id_ = device.scene.clone().map(|scene| scene.scene_id.to_string());

    let db_device = NewDevice {
        name: device.name.as_str(),
        integration_id: &device.integration_id.to_string(),
        device_id: &device.id.to_string(),
        scene_id: scene_id_.as_deref(),
    };

    use super::schema::devices;
    use super::schema::devices::dsl::*;

    let conn = PG_POOL.get()?;

    let result = diesel::insert_into(devices::table)
        .values(&db_device)
        .on_conflict((integration_id, device_id))
        .do_update()
        .set(&db_device)
        .execute(&conn)?;

    Ok(result)
}
