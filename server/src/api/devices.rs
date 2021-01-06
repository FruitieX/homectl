use std::sync::Arc;

use rocket::get;
use rocket::State;
use rocket_contrib::json::Json;

use crate::{homectl_core::{device::Device, state::AppState}};

#[derive(serde::Serialize)]
pub struct DevicesResponse {
    devices: Vec<Device>,
}

#[get("/devices")]
pub fn get_devices(state: State<Arc<AppState>>) -> Json<DevicesResponse> {
    let devices = state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.values().cloned().collect(),
    };
    Json(response)
}
