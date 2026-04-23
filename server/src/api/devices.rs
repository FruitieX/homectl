use std::convert::Infallible;

use percent_encoding::percent_decode_str;

use crate::types::{
    color::ColorMode,
    device::{Device, DeviceId},
};
use serde::{Deserialize, Serialize};
use warp::Filter;

use crate::core::snapshot::SnapshotHandle;
use crate::core::state::StateHandle;

use super::{with_handle, with_snapshot};

#[derive(serde::Serialize)]
pub struct DevicesResponse {
    devices: Vec<Device>,
}

pub fn devices(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("devices").and(get_devices(snapshot).or(put_device(handle)))
}

#[derive(Serialize, Deserialize)]
struct GetQuery {
    color_mode: Option<ColorMode>,
}

fn get_devices(
    snapshot: &SnapshotHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::get()
        .and(warp::query::<GetQuery>())
        .and(with_snapshot(snapshot))
        .and_then(get_devices_impl)
}

async fn get_devices_impl(
    query: GetQuery,
    snapshot: SnapshotHandle,
) -> Result<impl warp::Reply, Infallible> {
    let snapshot = snapshot.load();
    let devices_converted = snapshot
        .devices
        .0
        .values()
        .map(|device| device.color_to_mode(query.color_mode.clone().unwrap_or(ColorMode::Hs), true))
        .collect::<Vec<Device>>();

    let response = DevicesResponse {
        devices: devices_converted,
    };

    Ok(warp::reply::json(&response))
}

fn put_device(
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path::tail()
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(put_device_impl)
}

async fn put_device_impl(
    tail: warp::path::Tail,
    device: Device,
    handle: StateHandle,
) -> Result<impl warp::Reply, Infallible> {
    // Decode percent-encoded path segment to get the device ID
    let decoded = percent_decode_str(tail.as_str()).decode_utf8_lossy();
    let device_id = DeviceId::new(&decoded);

    // Make sure device_id matches with provided device
    if device_id != device.id {
        return Ok(warp::reply::json(&DevicesResponse { devices: vec![] }));
    }

    let response = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.devices.set_state(&device, false, false);
                let devices = state.devices.get_state();
                DevicesResponse {
                    devices: devices.0.values().cloned().collect(),
                }
            })
        })
        .await
        .unwrap_or(DevicesResponse { devices: vec![] });

    Ok(warp::reply::json(&response))
}
