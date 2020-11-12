use crate::homectl_core::device;

use super::models::*;
use diesel::prelude::*;

pub fn find_floorplans(conn: &PgConnection) -> Result<Vec<Floorplan>, diesel::result::Error> {
    use super::schema::floorplans::dsl::*;

    floorplans.load::<Floorplan>(conn)
}

pub fn db_update_device(
    conn: &PgConnection,
    device: &device::Device,
) -> Result<usize, diesel::result::Error> {
    let db_device = NewDevice {
        name: device.name.as_str(),
        integration_id: device.integration_id.as_str(),
        device_id: device.id.as_str(),
        scene_id: device.scene.as_ref().map(|scene| scene.scene_id.as_str()),
    };

    use super::schema::devices;
    use super::schema::devices::dsl::*;

    diesel::insert_into(devices::table)
        .values(&db_device)
        .on_conflict((integration_id, device_id))
        .do_update()
        .set(&db_device)
        .execute(conn)
}
