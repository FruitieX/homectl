use std::{convert::Infallible, sync::Arc};

use crate::types::device::{Device, DeviceId};
use warp::Filter;

use crate::core::state::AppState;

use super::with_state;

#[derive(serde::Serialize)]
pub struct DevicesResponse {
    devices: Vec<Device>,
}

pub fn devices(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("devices").and(get_devices(app_state).or(put_device(app_state)))
}

fn get_devices(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::get()
        .and(with_state(app_state))
        .map(|app_state: Arc<AppState>| {
            let devices = app_state.devices.get_devices();

            let response = DevicesResponse {
                devices: devices.0.values().cloned().collect(),
            };

            Ok(warp::reply::json(&response))
        })
}

fn put_device(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path!(DeviceId)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(put_device_impl)
}

async fn put_device_impl(
    device_id: DeviceId,
    device: Device,
    app_state: Arc<AppState>,
) -> Result<impl warp::Reply, Infallible> {
    // Make sure device_id matches with provided device
    if device_id != device.id {
        return Ok(warp::reply::json(&DevicesResponse { devices: vec![] }));
    }

    let mut devices = app_state.devices.clone();
    devices.set_device_state(&device, true, false, false).await;

    let devices = app_state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.0.values().cloned().collect(),
    };

    Ok(warp::reply::json(&response))
}
