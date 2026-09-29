use super::*;
use crate::{core::user_timers as timers, types::user_timer::*};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimerUpdate {
    timers: Vec<UserTimerDefinition>,
    expected: Vec<UserTimerDefinition>,
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path!("timers")
        .and(warp::get()).and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| match timers::read(&snapshot.load().runtime_config.widget_settings) {
            Ok(value) => warp::reply::with_status(warp::reply::json(&serde_json::json!({"success":true, "data":value, "storage_available": db::is_db_connected()})), StatusCode::OK),
            Err(error) => error_response(&format!("Could not load timers: {error}"), StatusCode::INTERNAL_SERVER_ERROR),
        });
    let put = warp::path!("timers")
        .and(warp::put())
        .and(warp::body::content_length_limit(256 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update);
    let stop = warp::path!("timers" / String / "stop")
        .and(warp::post())
        .and(with_handle(handle))
        .and_then(stop);
    let cancel = warp::path!("timers" / String / "cancel")
        .and(warp::post())
        .and(with_handle(handle))
        .and_then(cancel);
    get.or(put).or(stop).or(cancel)
}
async fn update(request: TimerUpdate, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let _guard = match timers::lock(&handle).await {
        Ok(g) => g,
        Err(_) => return Ok(actor_unavailable()),
    };
    let current = match timers::read(&handle.snapshot.load().runtime_config.widget_settings) {
        Ok(value) => value,
        Err(error) => {
            return Ok(error_response(
                &error.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            ))
        }
    };
    let current_definitions: Vec<_> = current
        .timers
        .iter()
        .map(|entry| entry.definition.clone())
        .collect();
    if current_definitions != request.expected {
        return Ok(warp::reply::with_status(
            warp::reply::json(
                &serde_json::json!({"success":false,"error":"Timers changed elsewhere.","current":{"timers":current_definitions}}),
            ),
            StatusCode::CONFLICT,
        ));
    }
    if !db::is_db_connected() {
        return Ok(error_response(
            "Timer storage is unavailable. No schedules were changed.",
            StatusCode::SERVICE_UNAVAILABLE,
        ));
    }
    match timers::update(
        &handle,
        request.timers,
        request.expected,
        chrono::Utc::now(),
    )
    .await
    {
        Ok(value) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"success":true,"data":value})),
            StatusCode::OK,
        )),
        Err(error) => Ok(error_response(&error.to_string(), StatusCode::BAD_REQUEST)),
    }
}
async fn stop(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    match timers::stop(&handle, &id).await {
        Ok(value) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"success":true,"data":value})),
            StatusCode::OK,
        )),
        Err(error) => Ok(error_response(
            &format!("Timer was not stopped: {error}"),
            StatusCode::BAD_REQUEST,
        )),
    }
}

async fn cancel(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    match timers::cancel_actions(&handle, &id).await {
        Ok(value) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"success":true,"data":value})),
            StatusCode::OK,
        )),
        Err(error) => Ok(error_response(
            &format!("Actions were not cancelled: {error}"),
            StatusCode::BAD_REQUEST,
        )),
    }
}
