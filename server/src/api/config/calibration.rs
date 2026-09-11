use super::*;
use crate::core::{
    calibration_session::CalibrationPreview, color_calibration::ColorCalibrationProfile,
};

#[derive(Deserialize)]
struct AssignRequest {
    device_keys: Vec<String>,
    profile_id: Option<String>,
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
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
    let stop = warp::path!("calibration-sessions" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(stop_session);
    let heartbeat = warp::path!("calibration-sessions" / String / "heartbeat")
        .and(warp::post())
        .and(with_handle(handle))
        .and_then(keep_session);
    profiles
        .or(save)
        .or(update)
        .or(assignments)
        .or(assign)
        .or(start)
        .or(preview)
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
