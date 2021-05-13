use std::sync::Arc;

use homectl_types::device::{Device, DeviceId};
use rocket::State;
use rocket::{get, put};
use rocket_contrib::json::Json;

use crate::homectl_core::state::AppState;

#[derive(serde::Serialize)]
pub struct DevicesResponse {
    devices: Vec<Device>,
}

#[get("/devices")]
pub fn get_devices(app_state: &State<Arc<AppState>>) -> Json<DevicesResponse> {
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
    app_state: &State<Arc<AppState>>,
) -> Json<DevicesResponse> {
    // Make sure device_id matches with provided device
    if device_id != device.0.id {
        return Json(DevicesResponse { devices: vec![] });
    }

    let mut devices = app_state.devices.clone();
    devices.set_device_state(&device.0, true).await;

    let devices = app_state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.values().cloned().collect(),
    };

    Json(response)
}
