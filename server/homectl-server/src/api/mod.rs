use std::sync::Arc;

use crate::AppState;

mod actions;
mod devices;
mod ws;

use actions::*;
use devices::*;

use anyhow::Result;
use warp::Filter;

use self::ws::ws;

pub fn with_state(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (Arc<AppState>,), Error = std::convert::Infallible> + Clone {
    let app_state = app_state.clone();
    warp::any().map(move || app_state.clone())
}

// Example of warp usage: https://github.com/seanmonstar/warp/blob/master/examples/todos.rs
pub fn init_api(app_state: &Arc<AppState>) -> Result<()> {
    let api = warp::path("api")
        .and(warp::path("v1"))
        .and(devices(app_state).or(actions(app_state)));

    let ws = ws(app_state);

    tokio::spawn(async move {
        warp::serve(ws.or(api)).run(([0, 0, 0, 0], 45289)).await;
    });

    Ok(())
}
