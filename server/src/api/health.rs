use std::sync::Arc;

use crate::{core::state::AppState, db::is_db_available};
use serde::Serialize;
use tokio::sync::RwLock;
use warp::{http::StatusCode, Filter};

use super::with_state;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    details: Option<serde_json::Value>,
}

pub fn health(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("health").and(live().or(ready(app_state)))
}

fn live() -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("live").and(warp::get()).map(|| {
        let body = HealthResponse {
            status: "ok",
            details: None,
        };
        let reply = warp::reply::json(&body);
        warp::reply::with_status(reply, StatusCode::OK)
    })
}

fn ready(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("ready")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(ready_impl)
}

async fn ready_impl(
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl warp::Reply, std::convert::Infallible> {
    let state = app_state.read().await;

    // Not ready while warming up
    if state.warming_up {
        let body = HealthResponse {
            status: "warming_up",
            details: None,
        };
        let reply = warp::reply::json(&body);
        return Ok(warp::reply::with_status(
            reply,
            StatusCode::SERVICE_UNAVAILABLE,
        ));
    }

    let details = serde_json::json!({
        "db": if is_db_available() { "available" } else { "unavailable" }
    });

    let body = HealthResponse {
        status: "ready",
        details: Some(details),
    };
    let reply = warp::reply::json(&body);
    Ok(warp::reply::with_status(reply, StatusCode::OK))
}
