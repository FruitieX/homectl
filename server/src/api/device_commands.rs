use super::with_handle;
use crate::{
    core::state::StateHandle,
    types::device_command::{DeviceCommand, DeviceCommandResult},
};
use warp::{http::StatusCode, Filter, Reply};

pub async fn dispatch(command: DeviceCommand, handle: &StateHandle) -> DeviceCommandResult {
    let request_id = command.request_id.clone();
    match handle.control_device(command).await {
        Ok(result) => result,
        Err(error) => DeviceCommandResult {
            request_id,
            applied: false,
            error: Some(error.to_string()),
        },
    }
}

pub fn commands(
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    warp::path!("commands" / "device")
        .and(warp::post())
        .and(warp::body::content_length_limit(16 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(|command: DeviceCommand, handle: StateHandle| async move {
            let result = dispatch(command, &handle).await;
            let status = if result.applied {
                StatusCode::OK
            } else {
                StatusCode::BAD_REQUEST
            };
            Ok::<_, std::convert::Infallible>(warp::reply::with_status(
                warp::reply::json(&result),
                status,
            ))
        })
}
