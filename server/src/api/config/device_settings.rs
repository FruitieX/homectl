use super::*;

/// One editing scope for the two existing device metadata tables. Runtime
/// observations and commands are deliberately outside this value/baseline.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct DeviceSettings {
    device_key: String,
    display_name: Option<String>,
    sensor: Option<DeviceSensorConfigRow>,
    #[serde(default)]
    reporting_policy: crate::types::device_health::ReportingPolicy,
}
#[derive(Deserialize)]
struct SettingsWrite {
    #[serde(flatten)]
    value: DeviceSettings,
    expected: DeviceSettings,
}
#[derive(Deserialize)]
struct SettingsQuery {
    device_key: String,
}
fn current(config: &config_queries::ConfigExport, key: &str) -> DeviceSettings {
    DeviceSettings {
        reporting_policy: crate::core::device_health::read_policy(config, "device", key),
        device_key: key.into(),
        display_name: config
            .device_display_overrides
            .iter()
            .find(|row| row.device_key == key)
            .map(|row| row.display_name.clone()),
        sensor: config
            .device_sensor_configs
            .iter()
            .find(|row| row.device_ref == key)
            .cloned(),
    }
}
pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path!("device-settings")
        .and(warp::get())
        .and(warp::query::<SettingsQuery>())
        .and(with_snapshot(snapshot))
        .map(|query: SettingsQuery, snapshot: SnapshotHandle| {
            ApiResponse::success(current(&snapshot.load().runtime_config, &query.device_key))
        });
    let put = warp::path!("device-settings")
        .and(warp::put())
        .and(warp::body::content_length_limit(64 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(write);
    get.or(put)
}
async fn write(request: SettingsWrite, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    if let Err(error) = request.value.reporting_policy.validate() {
        return Ok(error_response(error, StatusCode::BAD_REQUEST));
    }
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    if request.expected.device_key != request.value.device_key
        || request
            .value
            .sensor
            .as_ref()
            .is_some_and(|row| row.device_ref != request.value.device_key)
    {
        return Ok(error_response(
            "Device keys must match the editing scope.",
            StatusCode::BAD_REQUEST,
        ));
    }
    if request
        .value
        .display_name
        .as_ref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Ok(error_response(
            "Use null to restore the integration label, or provide a display name.",
            StatusCode::BAD_REQUEST,
        ));
    }
    let outcome = handle
        .mutate(move |state| {
            Box::pin(async move {
                let saved = current(&state.runtime_config, &request.value.device_key);
                if serde_json::to_value(&saved).unwrap()
                    != serde_json::to_value(&request.expected).unwrap()
                {
                    return Err((
                        StatusCode::CONFLICT,
                        "Device settings changed elsewhere.",
                        Some(saved),
                    ));
                }
                if !state
                    .devices
                    .get_state()
                    .0
                    .keys()
                    .any(|key| key.to_string() == request.value.device_key)
                {
                    return Err((
                        StatusCode::NOT_FOUND,
                        "This device is no longer available.",
                        None,
                    ));
                }
                let value = request.value;
                state.upsert_widget_setting(crate::core::device_health::policy_row(
                    "device",
                    &value.device_key,
                    &value.reporting_policy,
                ));
                if let Some(display_name) = &value.display_name {
                    state.upsert_device_display_override(DeviceDisplayNameRow {
                        device_key: value.device_key.clone(),
                        display_name: display_name.clone(),
                    });
                } else {
                    state.delete_device_display_override(&value.device_key);
                }
                if let Some(sensor) = &value.sensor {
                    state.upsert_device_sensor_config(sensor.clone());
                } else {
                    state.delete_device_sensor_config(&value.device_key);
                }
                Ok(value)
            })
        })
        .await;
    let value = match outcome {
        Err(_) => return Ok(actor_unavailable()),
        Ok(Err((status, error, saved))) => {
            return Ok(warp::reply::with_status(
                warp::reply::json(
                    &serde_json::json!({ "success": false, "error": error, "current": saved }),
                ),
                status,
            ))
        }
        Ok(Ok(value)) => value,
    };
    let available = db::is_db_connected();
    let persistence = config_queries::db_save_device_settings(
        &value.device_key,
        value.display_name.as_deref(),
        value.sensor.as_ref(),
        Some(&crate::core::device_health::policy_row(
            "device",
            &value.device_key,
            &value.reporting_policy,
        )),
    )
    .await;
    Ok(config_write_response(
        value,
        persistence,
        available,
        StatusCode::OK,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    use crate::types::device::{Device, DeviceData, DeviceId, SensorDevice};
    use crate::types::integration::IntegrationId;
    async fn setup() -> (StateHandle, SnapshotHandle, DeviceSettings) {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let device = Device::new(
            IntegrationId::from("test".to_string()),
            DeviceId::new("button"),
            "Button".into(),
            DeviceData::Sensor(SensorDevice::Boolean { value: false }),
            None,
        );
        state.devices.set_state(&device, true, true);
        let snapshot = state.snapshot.clone();
        let expected = current(&state.runtime_config, "test/button");
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), tx);
        (handle, snapshot, expected)
    }
    #[tokio::test]
    async fn device_settings_reject_stale_scope_and_keep_unrecognized_sensor_fields() {
        let (handle, snapshot, expected) = setup().await;
        let mut value = expected.clone();
        value.display_name = Some("New label".into());
        value.reporting_policy = crate::types::device_health::ReportingPolicy::Custom {
            expected_interval_seconds: 120,
        };
        value.sensor = Some(DeviceSensorConfigRow {
            device_ref: "test/button".into(),
            interaction_kind: "hue_dimmer".into(),
            config: serde_json::json!({ "future": [null, { "keep": true }] }),
        });
        let response = write(
            SettingsWrite {
                value: value.clone(),
                expected: expected.clone(),
            },
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(response.status(), StatusCode::OK);
        let result = current(&snapshot.load().runtime_config, "test/button");
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(&value).unwrap()
        );
        let mut stale = expected.clone();
        stale.display_name = Some("Stale name".into());
        assert_eq!(
            write(
                SettingsWrite {
                    value: stale,
                    expected
                },
                handle.clone()
            )
            .await
            .unwrap()
            .into_response()
            .status(),
            StatusCode::CONFLICT
        );
        let mut mismatched = value.clone();
        mismatched.device_key = "test/other".into();
        assert_eq!(
            write(
                SettingsWrite {
                    value: mismatched,
                    expected: value.clone()
                },
                handle
            )
            .await
            .unwrap()
            .into_response()
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            serde_json::to_value(current(&snapshot.load().runtime_config, "test/button")).unwrap(),
            serde_json::to_value(value).unwrap()
        );
    }
}
