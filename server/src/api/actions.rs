use crate::types::{
    action::Action,
    event::{Event, TxEventChannel},
};
use serde_json::json;
use warp::http::StatusCode;
use warp::Filter;

use super::config::validate_action_rollout;

pub fn actions(
    event_tx: TxEventChannel,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("actions").and(post_action(event_tx).or(warp::get().map(|| warp::reply::json(&()))))
}

fn post_action(
    event_tx: TxEventChannel,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("trigger")
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::any().map(move || event_tx.clone()))
        .and_then(post_action_impl)
}

async fn post_action_impl(
    action: Action,
    event_tx: TxEventChannel,
) -> Result<impl warp::Reply, warp::Rejection> {
    if let Err(error) = validate_action_rollout(&action) {
        return Ok(warp::reply::with_status(
            warp::reply::json(&json!({
                "success": false,
                "data": null,
                "error": error,
            })),
            StatusCode::BAD_REQUEST,
        ));
    }

    event_tx.send(Event::Action(action));

    Ok(warp::reply::with_status(
        warp::reply::json(&()),
        StatusCode::OK,
    ))
}
