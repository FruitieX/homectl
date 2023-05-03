use std::sync::Arc;

use crate::core::state::AppState;
use crate::types::{action::Action, event::Message};
use warp::Filter;

use super::with_state;

pub fn actions(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("actions").and(
        post_action(app_state).or(warp::get()
            // TODO: why is this needed
            .and(warp::path("asdasdasdasd"))
            .map(|| Ok(warp::reply::json(&())))),
    )
}

fn post_action(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("trigger")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .map(|action: Action, app_state: Arc<AppState>| {
            let sender = app_state.sender.clone();
            sender.send(Message::Action(action));

            Ok(warp::reply::json(&()))
        })
}
