use super::schema::devices;
use diesel::{Insertable, Queryable};

#[derive(Debug, Queryable)]
pub struct Device {
    pub id: i32,
    pub name: String,
    pub integration_id: String,
    pub device_id: String,
    pub scene_id: Option<String>,
}

#[derive(Debug, Insertable, AsChangeset)]
#[table_name = "devices"]
pub struct NewDevice<'a> {
    pub name: &'a str,
    pub integration_id: &'a str,
    pub device_id: &'a str,
    pub scene_id: Option<&'a str>,
}

#[derive(Debug, Queryable)]
pub struct FloorplanDevice {
    pub id: i32,
    pub floorplan_id: i32,
    pub device_id: i32,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Queryable)]
pub struct Floorplan {
    pub id: i32,
    pub name: String,
    pub index: i32,
    pub image: Vec<u8>,
}
