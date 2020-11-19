use crate::homectl_core::device;

use super::models::*;
use super::PG_POOL;
use anyhow::Result;
use diesel::prelude::*;

pub fn find_floorplans(conn: &PgConnection) -> Result<Vec<Floorplan>> {
    use super::schema::floorplans::dsl::*;

    let result = floorplans.load::<Floorplan>(conn)?;

    Ok(result)
}

pub fn db_update_device(device: &device::Device) -> Result<usize> {
    let db_device = NewDevice {
        name: device.name.as_str(),
        integration_id: device.integration_id.as_str(),
        device_id: device.id.as_str(),
        scene_id: device.scene.as_ref().map(|scene| scene.scene_id.as_str()),
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
