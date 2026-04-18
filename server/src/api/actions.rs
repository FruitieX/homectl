use std::sync::Arc;

use crate::core::state::AppState;
use crate::types::{action::Action, event::Event};
use serde_json::json;
use tokio::sync::RwLock;
use warp::http::StatusCode;
use warp::Filter;

use super::{config::validate_action_rollout, with_state};

pub fn actions(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("actions").and(post_action(app_state).or(warp::get().map(|| warp::reply::json(&()))))
}

fn post_action(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("trigger")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(post_action_impl)
}

async fn post_action_impl(
    action: Action,
    app_state: Arc<RwLock<AppState>>,
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

    let app_state = app_state.read().await;
    let sender = app_state.event_tx.clone();
    sender.send(Event::Action(action));

    Ok(warp::reply::with_status(
        warp::reply::json(&()),
        StatusCode::OK,
    ))
}
