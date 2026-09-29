use super::*;
use crate::core::{
    calibration_session::{BrightnessPreview, CalibrationPreview},
    color_calibration::ColorCalibrationProfile,
};
use std::hash::{BuildHasher, Hash, Hasher};

#[derive(Clone, Serialize)]
struct EditorView {
    profiles: Vec<ColorCalibrationProfile>,
    assignments: Vec<crate::core::color_calibration::ColorCalibrationAssignment>,
    legacy: Vec<crate::core::color_calibration::DeviceColorCalibration>,
    revision_token: String,
}

fn editor_view(config: &config_queries::ConfigExport) -> EditorView {
    static HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
        once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);
    let mut view = EditorView {
        profiles: config.color_calibration_profiles.clone(),
        assignments: config.color_calibration_assignments.clone(),
        legacy: config.device_color_calibrations.clone(),
        revision_token: String::new(),
    };
    view.profiles.sort_by(|a, b| a.id.cmp(&b.id));
    view.assignments
        .sort_by(|a, b| a.device_key.cmp(&b.device_key));
    view.legacy.sort_by(|a, b| a.device_key.cmp(&b.device_key));
    let mut hasher = HASHER.build_hasher();
    serde_json::to_string(&view).unwrap().hash(&mut hasher);
    view.revision_token = format!("{:016x}", hasher.finish());
    view
}

#[derive(Deserialize)]
struct EditorWrite {
    expected: String,
    profile: Option<ColorCalibrationProfile>,
    device_keys: Vec<String>,
    profile_id: Option<String>,
}

#[derive(Serialize)]
struct EditorConflict {
    success: bool,
    error: String,
    current: Option<EditorView>,
}

async fn save_editor(
    request: EditorWrite,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle.mutate(move |state| Box::pin(async move {
        let current = editor_view(&state.runtime_config);
        if request.expected != current.revision_token {
            return Err((StatusCode::CONFLICT, "Calibration changed elsewhere. Review the saved profiles and assignments before saving.".to_string(), Some(current)));
        }
        state.save_calibration_edit(request.profile, request.device_keys, request.profile_id)
            .await.map_err(|error| (StatusCode::BAD_REQUEST, error, None))?;
        Ok(editor_view(&state.runtime_config))
    })).await;
    Ok(match result {
        Err(_) => actor_unavailable(),
        Ok(Err((status, error, current))) => warp::reply::with_status(
            warp::reply::json(&EditorConflict {
                success: false,
                error,
                current,
            }),
            status,
        ),
        Ok(Ok(view)) => {
            config_write_response(view, Ok::<(), color_eyre::Report>(()), true, StatusCode::OK)
        }
    })
}

#[derive(Deserialize)]
struct AssignRequest {
    device_keys: Vec<String>,
    profile_id: Option<String>,
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let editor = warp::path!("calibration-editor")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            ApiResponse::success(editor_view(&snapshot.load().runtime_config))
        });
    let edit = warp::path!("calibration-editor")
        .and(warp::put())
        .and(warp::body::content_length_limit(128 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(save_editor);
    let profiles = warp::path!("calibration-profiles")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            ApiResponse::success(
                snapshot
                    .load()
                    .runtime_config
                    .color_calibration_profiles
                    .clone(),
            )
        });
    let save = warp::path!("calibration-profiles")
        .and(warp::post())
        .and(warp::body::content_length_limit(64 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(save_profile);
    let update = warp::path!("calibration-profiles" / String)
        .and(warp::put())
        .and(warp::body::content_length_limit(64 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_profile);
    let assignments = warp::path!("calibration-assignments")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            ApiResponse::success(
                snapshot
                    .load()
                    .runtime_config
                    .color_calibration_assignments
                    .clone(),
            )
        });
    let assign = warp::path!("calibration-assignments")
        .and(warp::put())
        .and(warp::body::content_length_limit(128 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(assign_profile);
    let start = warp::path!("calibration-sessions" / String)
        .and(warp::post())
        .and(warp::body::content_length_limit(4096))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(|id, preview, handle| preview_session(id, preview, handle, true));
    let preview = warp::path!("calibration-sessions" / String)
        .and(warp::put())
        .and(warp::body::content_length_limit(4096))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(|id, preview, handle| preview_session(id, preview, handle, false));
    let brightness_start = warp::path!("calibration-brightness-sessions" / String)
        .and(warp::post())
        .and(warp::body::content_length_limit(4096))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(|id, preview, handle| brightness_session(id, preview, handle, true));
    let brightness_preview = warp::path!("calibration-brightness-sessions" / String)
        .and(warp::put())
        .and(warp::body::content_length_limit(4096))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(|id, preview, handle| brightness_session(id, preview, handle, false));
    let stop = warp::path!("calibration-sessions" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(stop_session);
    let heartbeat = warp::path!("calibration-sessions" / String / "heartbeat")
        .and(warp::post())
        .and(with_handle(handle))
        .and_then(keep_session);
    editor
        .or(edit)
        .or(profiles)
        .or(save)
        .or(update)
        .or(assignments)
        .or(assign)
        .or(start)
        .or(preview)
        .or(brightness_start)
        .or(brightness_preview)
        .or(stop)
        .or(heartbeat)
}

async fn save_profile(
    profile: ColorCalibrationProfile,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    Ok(persist_profile(profile, handle, StatusCode::CREATED).await)
}

async fn update_profile(
    id: String,
    profile: ColorCalibrationProfile,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    if id != profile.id {
        return Ok(error_response(
            "Calibration profile id does not match the URL",
            StatusCode::BAD_REQUEST,
        ));
    }
    Ok(persist_profile(profile, handle, StatusCode::OK).await)
}

async fn persist_profile(
    profile: ColorCalibrationProfile,
    handle: StateHandle,
    status: StatusCode,
) -> warp::reply::WithStatus<warp::reply::Json> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return actor_unavailable(),
    };
    let saved = profile.clone();
    let result = handle
        .mutate(move |state| Box::pin(async move { state.save_calibration_profile(saved).await }))
        .await;
    match result {
        Ok(Ok(())) => {
            config_write_response(profile, Ok::<(), color_eyre::Report>(()), true, status)
        }
        Ok(Err(error)) => error_response(&error, StatusCode::BAD_REQUEST),
        Err(_) => actor_unavailable(),
    }
}

async fn assign_profile(
    request: AssignRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                state
                    .assign_calibration_profile(request.device_keys, request.profile_id)
                    .await
            })
        })
        .await;
    Ok(match result {
        Ok(Ok(())) => {
            config_write_response((), Ok::<(), color_eyre::Report>(()), true, StatusCode::OK)
        }
        Ok(Err(error)) => error_response(&error, StatusCode::BAD_REQUEST),
        Err(_) => actor_unavailable(),
    })
}

async fn preview_session(
    id: String,
    preview: CalibrationPreview,
    handle: StateHandle,
    start: bool,
) -> Result<impl Reply, warp::Rejection> {
    let session_id = id.clone();
    let result = handle
        .mutate(move |state| {
            Box::pin(async move { state.preview_calibration(session_id, preview, start) })
        })
        .await;
    match result {
        Ok(Ok(())) => {
            if start {
                // Reclaim sessions after a closed/disconnected browser. The UI sends a heartbeat.
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        let id = id.clone();
                        let done = handle
                            .mutate(move |state| {
                                Box::pin(async move { state.expire_calibration_session(&id) })
                            })
                            .await;
                        if !matches!(done, Ok(false)) {
                            break;
                        }
                    }
                });
            }
            Ok(session_response())
        }
        Ok(Err(error)) => Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        Err(_) => Ok(actor_unavailable()),
    }
}

/// A brightness session shares the lifecycle of a color one: the same id, the
/// same heartbeat, the same Cancel/Finish restoration — but it never needs
/// color values, so a dimmer with no color support can use it.
async fn brightness_session(
    id: String,
    preview: BrightnessPreview,
    handle: StateHandle,
    start: bool,
) -> Result<impl Reply, warp::Rejection> {
    let session_id = id.clone();
    let result = handle
        .mutate(move |state| {
            Box::pin(
                async move { state.preview_brightness_calibration(session_id, preview, start) },
            )
        })
        .await;
    match result {
        Ok(Ok(())) => {
            if start {
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        let id = id.clone();
                        let done = handle
                            .mutate(move |state| {
                                Box::pin(async move { state.expire_calibration_session(&id) })
                            })
                            .await;
                        if !matches!(done, Ok(false)) {
                            break;
                        }
                    }
                });
            }
            Ok(session_response())
        }
        Ok(Err(error)) => Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        Err(_) => Ok(actor_unavailable()),
    }
}

async fn stop_session(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.finish_calibration(&id);
            })
        })
        .await;
    Ok(if result.is_ok() {
        session_response()
    } else {
        actor_unavailable()
    })
}

async fn keep_session(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                if let Some(session) = state.calibration_sessions.get_mut(&id) {
                    session.touched = std::time::Instant::now();
                    true
                } else {
                    false
                }
            })
        })
        .await;
    Ok(match result {
        Ok(true) => session_response(),
        Ok(false) => error_response(
            "Calibration session expired; start again",
            StatusCode::NOT_FOUND,
        ),
        Err(_) => actor_unavailable(),
    })
}

fn session_response() -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(&serde_json::json!({"success":true,"data":null})),
        StatusCode::OK,
    )
}

#[cfg(test)]
mod editor_tests {
    use super::*;
    use serde_json::{json, Value};

    #[tokio::test]
    async fn calibration_editor_rejects_stale_or_invalid_writes_without_mutation() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let profile = json!({"id":"test", "name":"Test", "brightness_points":[
            {"logical":0.1,"output":0.2}, {"logical":1,"output":1}
        ]});
        state.runtime_config.color_calibration_profiles =
            serde_json::from_value(json!([profile])).unwrap();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        handle.mutate(|_| Box::pin(async {})).await.unwrap();
        let routes = routes(&snapshot, &handle);
        let response = warp::test::request()
            .path("/calibration-editor")
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let view: Value = serde_json::from_slice(response.body()).unwrap();
        let expected = view["data"]["revision_token"].clone();
        let before = serde_json::to_value(&*snapshot.load().runtime_config).unwrap();
        let write = json!({"expected":"stale", "profile": profile, "profile_id":"test", "device_keys":["dummy/a"]});
        let response = warp::test::request()
            .method("PUT")
            .path("/calibration-editor")
            .json(&write)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let conflict: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(conflict["current"], view["data"]);
        let mut write = write;
        write["expected"] = expected;
        write["profile_id"] = json!("different");
        let response = warp::test::request()
            .method("PUT")
            .path("/calibration-editor")
            .json(&write)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(String::from_utf8_lossy(response.body()).contains("must match"));
        write["profile_id"] = json!("test");
        let response = warp::test::request()
            .method("PUT")
            .path("/calibration-editor")
            .json(&write)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(String::from_utf8_lossy(response.body()).contains("no longer available"));
        assert_eq!(
            serde_json::to_value(&*snapshot.load().runtime_config).unwrap(),
            before
        );

        handle
            .mutate(|state| {
                Box::pin(async move {
                    state.runtime_config.color_calibration_profiles[0].name =
                        "Changed elsewhere".into();
                })
            })
            .await
            .unwrap();
        let response = warp::test::request()
            .method("PUT")
            .path("/calibration-editor")
            .json(&write)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}
