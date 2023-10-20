use std::sync::Arc;

use crate::core::state::AppState;
use crate::types::{action::Action, event::Message};
use warp::Filter;

use super::with_state;

pub fn actions(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("actions")
        .and(post_action(app_state).or(warp::get().map(|| warp::reply::json(&()))))
}

fn post_action(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("trigger")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .map(|action: Action, app_state: Arc<AppState>| {
            let sender = app_state.event_tx.clone();
            sender.send(Message::Action(action));

            warp::reply::json(&())
        })
}
