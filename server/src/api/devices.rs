use std::convert::Infallible;

use percent_encoding::percent_decode_str;

use crate::types::{
    automation_event::EventOrigin,
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
        .map(|device| match &query.color_mode {
            Some(mode) => device.color_to_mode(mode.clone(), true),
            None => device.clone(),
        })
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
                // Sensor simulation is an input report, including repeated
                // button presses. V2 report triggers exclude derived writes.
                let origin = if device.is_sensor() {
                    EventOrigin::Report
                } else {
                    EventOrigin::Derived
                };
                state
                    .devices
                    .set_state_with_origin(&device, false, false, origin);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    use crate::db::config_queries::RoutineRow;
    use crate::types::device::{DeviceData, SensorDevice};
    use crate::types::integration::IntegrationId;
    use crate::types::rule::RoutineId;

    #[tokio::test]
    async fn simulated_button_reports_trigger_v2_routines_on_repeated_presses() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let device = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("office_button"),
            "Office button".into(),
            DeviceData::Sensor(SensorDevice::Text {
                value: "single".into(),
            }),
            None,
        );
        state
            .devices
            .set_state_with_origin(&device, true, true, EventOrigin::Startup);
        state.flush_pending_frames().await;
        state.runtime_config.routines.push(RoutineRow {
            id: "api_button_report".into(), name: "Button report".into(),
            enabled: true, semantics_version: 2, revision: 1,
            definition_v2: Some(serde_json::json!({
                "triggers": [{ "kind": "report", "id": "press", "device": { "integration_id": "dummy", "device_id": "office_button" } }],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "native", "steps": [{ "action": "cancel_timer", "id": "cancel", "timer": "unused" }] }
            })),
            ..Default::default()
        });
        state.apply_runtime_routines();
        let snapshot = state.snapshot.clone();
        let (work_tx, mut work_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), work_tx);
        let route = devices(&snapshot, &handle);
        let mut last_run_id = None;
        for value in ["single", "single", "double", "hold", "off"] {
            let mut report = device.clone();
            report.data = DeviceData::Sensor(SensorDevice::Text {
                value: value.into(),
            });
            let response = warp::test::request()
                .method("PUT")
                .path("/devices/office_button")
                .json(&report)
                .reply(&route)
                .await;
            assert_eq!(response.status(), 200);
            // Barrier behind the API mutation, including its frame evaluation.
            let status = handle
                .mutate(|state| {
                    Box::pin(async move {
                        state
                            .rules
                            .get_runtime_statuses()
                            .0
                            .get(&RoutineId("api_button_report".into()))
                            .cloned()
                            .unwrap()
                    })
                })
                .await
                .unwrap();
            let v2 = status.v2.expect("v2 routine status");
            let run = v2
                .last_run
                .expect("the simulated report must run the routine");
            assert!(run.accepted);
            assert_ne!(
                last_run_id,
                Some(run.run_id),
                "each press is a separate invocation even when its value repeats"
            );
            last_run_id = Some(run.run_id);
            assert_eq!(
                snapshot
                    .load()
                    .devices
                    .0
                    .get(&device.get_device_key())
                    .unwrap()
                    .data,
                report.data
            );
        }
        assert!(
            work_rx.try_recv().is_err(),
            "simulating sensor events must not send physical-device work"
        );
    }
}
