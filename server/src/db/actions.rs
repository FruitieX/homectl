use super::models::*;
use diesel::prelude::*;

pub fn find_floorplans(conn: &PgConnection) -> Result<Vec<Floorplan>, diesel::result::Error> {
    use super::schema::floorplans::dsl::*;

    floorplans.load::<Floorplan>(conn)
}
