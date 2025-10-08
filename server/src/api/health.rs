use std::sync::Arc;

use crate::{core::state::AppState, db::get_db_connection};
use serde::Serialize;
use tokio::sync::RwLock;
use warp::{http::StatusCode, Filter};

use super::with_state;

#[derive(Serialize)]
struct HealthResponse<'a> {
    status: &'a str,
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

    // If DB is configured, ensure connection is available. If not configured, we consider ready.
    let db_configured = std::env::var("DATABASE_URL").is_ok();
    if db_configured {
        match get_db_connection().await {
            Ok(_pool) => {
                let body = HealthResponse {
                    status: "ready",
                    details: None,
                };
                let reply = warp::reply::json(&body);
                Ok(warp::reply::with_status(reply, StatusCode::OK))
            }
            Err(e) => {
                let body = HealthResponse {
                    status: "db_unavailable",
                    details: Some(serde_json::json!({ "error": e.to_string() })),
                };
                let reply = warp::reply::json(&body);
                Ok(warp::reply::with_status(
                    reply,
                    StatusCode::SERVICE_UNAVAILABLE,
                ))
            }
        }
    } else {
        let body = HealthResponse {
            status: "ready",
            details: None,
        };
        let reply = warp::reply::json(&body);
        Ok(warp::reply::with_status(reply, StatusCode::OK))
    }
}
