use super::with_handle;
use crate::{
    core::state::StateHandle,
    types::scene_command::{SceneCommand, SceneCommandResult},
};
use warp::{http::StatusCode, Filter, Reply};

pub async fn dispatch(
    command: SceneCommand,
    handle: &StateHandle,
) -> Result<SceneCommandResult, SceneCommandResult> {
    let request_id = command.request_id.clone();
    handle
        .activate_scene(command)
        .await
        .map_err(|_| SceneCommandResult {
            request_id,
            applied: false,
            affected_devices: vec![],
            error: Some("State actor unavailable".into()),
        })
}

pub fn commands(
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    warp::path!("commands" / "scene")
        .and(warp::post())
        .and(warp::body::content_length_limit(64 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(|command: SceneCommand, handle: StateHandle| async move {
            let (result, status) = match dispatch(command, &handle).await {
                Ok(result) => {
                    let status = if result.applied {
                        StatusCode::OK
                    } else {
                        StatusCode::BAD_REQUEST
                    };
                    (result, status)
                }
                Err(result) => (result, StatusCode::SERVICE_UNAVAILABLE),
            };
            Ok::<_, std::convert::Infallible>(warp::reply::with_status(
                warp::reply::json(&result),
                status,
            ))
        })
}
