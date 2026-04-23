use crate::core::snapshot::SnapshotHandle;
use serde::Serialize;
use warp::{http::StatusCode, Filter};

use super::with_snapshot;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    details: Option<serde_json::Value>,
}

pub fn health(
    snapshot: &SnapshotHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("health").and(live().or(ready(snapshot)))
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
    snapshot: &SnapshotHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("ready")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(ready_impl)
}

async fn ready_impl(
    snapshot: SnapshotHandle,
) -> Result<impl warp::Reply, std::convert::Infallible> {
    // Not ready while warming up
    if snapshot.load().warming_up {
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

    let body = HealthResponse {
        status: "ready",
        details: None,
    };
    let reply = warp::reply::json(&body);
    Ok(warp::reply::with_status(reply, StatusCode::OK))
}
