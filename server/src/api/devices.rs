use std::sync::Arc;

use rocket::State;
use rocket::{get, put};
use rocket_contrib::json::Json;

use crate::homectl_core::{
    device::{Device, DeviceId},
    state::AppState,
};

#[derive(serde::Serialize)]
pub struct DevicesResponse {
    devices: Vec<Device>,
}

#[get("/devices")]
pub fn get_devices(app_state: State<Arc<AppState>>) -> Json<DevicesResponse> {
    let devices = app_state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.values().cloned().collect(),
    };
    Json(response)
}

#[put("/devices/<device_id>", data = "<device>")]
pub async fn put_device(
    device_id: DeviceId,
    device: Json<Device>,
    app_state: State<'_, Arc<AppState>>,
) -> Json<DevicesResponse> {
    let mut devices = app_state.devices.clone();
    devices.set_device_state(&device.0, true).await;

    let devices = app_state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.values().cloned().collect(),
    };

    Json(response)
}
