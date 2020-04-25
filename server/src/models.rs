use diesel::Queryable;

#[derive(Debug, Queryable)]
pub struct Device {
    pub id: i32,
    pub serial: String,
    pub name: String,
    pub path: String,
    pub image: Option<Vec<u8>>,
}

#[derive(Debug, Queryable)]
pub struct FloorplanDevice {
    pub id: i32,
    pub floorplan_id: i32,
    pub device_id: i32,
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Queryable)]
pub struct Floorplan {
    pub id: i32,
    pub name: String,
    pub index: i32,
    pub image: Vec<u8>,
}
