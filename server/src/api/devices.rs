use std::{convert::Infallible, sync::Arc};

use crate::types::{
    color::ColorMode,
    device::{Device, DeviceId},
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use warp::Filter;

use crate::core::state::AppState;

use super::with_state;

#[derive(serde::Serialize)]
pub struct DevicesResponse {
    devices: Vec<Device>,
}

pub fn devices(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("devices").and(get_devices(app_state).or(put_device(app_state)))
}

#[derive(Serialize, Deserialize)]
struct GetQuery {
    color_mode: Option<ColorMode>,
}

fn get_devices(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::get()
        .and(warp::query::<GetQuery>())
        .and(with_state(app_state))
        .map(|q: GetQuery, app_state: Arc<RwLock<AppState>>| {
            let app_state = app_state.blocking_read();
            let devices = app_state.devices.get_state();

            let devices_converted = devices
                .0
                .values()
                .map(|device| {
                    device.color_to_mode(q.color_mode.clone().unwrap_or(ColorMode::Hs), true)
                })
                .collect::<Vec<Device>>();

            let response = DevicesResponse {
                devices: devices_converted,
            };

            warp::reply::json(&response)
        })
}

fn put_device(
    app_state: &Arc<RwLock<AppState>>,
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
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl warp::Reply, Infallible> {
    // Make sure device_id matches with provided device
    if device_id != device.id {
        return Ok(warp::reply::json(&DevicesResponse { devices: vec![] }));
    }

    let mut app_state = app_state.write().await;
    let scenes = app_state.scenes.clone();

    app_state
        .devices
        .set_internal_state(&device, &scenes, true, false, false)
        .await;

    let devices = app_state.devices.get_state();
    let response = DevicesResponse {
        devices: devices.0.values().cloned().collect(),
    };

    Ok(warp::reply::json(&response))
}
