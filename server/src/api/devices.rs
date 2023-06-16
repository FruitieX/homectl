use std::{convert::Infallible, sync::Arc};

use crate::types::{
    color::{Capabilities, ColorMode},
    device::{Device, DeviceData, DeviceId},
};
use serde::{Deserialize, Serialize};
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

#[derive(Serialize, Deserialize)]
struct GetQuery {
    color_mode: Option<ColorMode>,
}

fn get_devices(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::get()
        .and(warp::query::<GetQuery>())
        .and(with_state(app_state))
        .map(|q: GetQuery, app_state: Arc<AppState>| {
            let devices = app_state.devices.get_devices();

            let devices_converted = devices
                .0
                .values()
                .map(|device| {
                    let mut device = device.clone();

                    if let DeviceData::Managed(managed) = &mut device.data {
                        let converted_state =
                            managed
                                .state
                                .color_to_device_preferred_mode(&Capabilities::singleton(
                                    q.color_mode.clone().unwrap_or(ColorMode::Hs),
                                ));
                        managed.state = converted_state;
                    }

                    device
                })
                .collect::<Vec<Device>>();

            let response = DevicesResponse {
                devices: devices_converted,
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
    devices.set_device_state(&device, true, false).await;

    let devices = app_state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.0.values().cloned().collect(),
    };

    Ok(warp::reply::json(&response))
}
