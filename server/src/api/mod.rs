use std::{env, path::PathBuf, sync::Arc};

use crate::core::state::AppState;
use crate::db::config_queries::WidgetSettingRow;
use serde::Serialize;

mod actions;
pub mod config;
mod devices;
mod health;
mod widgets;
mod ws;

use actions::*;
use config::*;
use devices::*;
use health::health;
use widgets::{
    widget_setting_string_or_env, API_URL_FIELD, CALENDAR_SETTING_KEY, ICS_URL_FIELD,
    INFLUXDB_SETTING_KEY, TOKEN_FIELD, TRAIN_SCHEDULE_SETTING_KEY, URL_FIELD, WEATHER_SETTING_KEY,
};

use color_eyre::Result;
use tokio::sync::RwLock;
use warp::{filters::BoxedFilter, path::FullPath, reply::Response, Filter, Rejection, Reply};

use self::ws::ws;

const DEFAULT_UI_DIST_CANDIDATES: [&str; 2] = ["ui/dist", "../ui/dist"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiConfigResponse {
    ws_endpoint: String,
    api_endpoint: String,
    weather_api_url: String,
    train_api_url: String,
    influx_url: String,
    influx_token: String,
    calendar_api_url: String,
    calendar_ics_url: String,
}

impl UiConfigResponse {
    fn from_request(
        host: Option<&str>,
        forwarded_proto: Option<&str>,
        widget_settings: &[WidgetSettingRow],
    ) -> Self {
        Self {
            ws_endpoint: env_var("WS_ENDPOINT")
                .unwrap_or_else(|| default_ws_endpoint(host, forwarded_proto)),
            api_endpoint: env_var("API_ENDPOINT").unwrap_or_default(),
            weather_api_url: widget_setting_string_or_env(
                widget_settings,
                WEATHER_SETTING_KEY,
                API_URL_FIELD,
                "WEATHER_API_URL",
            )
            .unwrap_or_default(),
            train_api_url: widget_setting_string_or_env(
                widget_settings,
                TRAIN_SCHEDULE_SETTING_KEY,
                API_URL_FIELD,
                "TRAIN_API_URL",
            )
            .unwrap_or_default(),
            influx_url: widget_setting_string_or_env(
                widget_settings,
                INFLUXDB_SETTING_KEY,
                URL_FIELD,
                "INFLUX_URL",
            )
            .unwrap_or_default(),
            influx_token: widget_setting_string_or_env(
                widget_settings,
                INFLUXDB_SETTING_KEY,
                TOKEN_FIELD,
                "INFLUX_TOKEN",
            )
            .unwrap_or_default(),
            calendar_api_url: env_var("CALENDAR_API_URL")
                .unwrap_or_else(|| "/api/calendar".to_string()),
            calendar_ics_url: widget_setting_string_or_env(
                widget_settings,
                CALENDAR_SETTING_KEY,
                ICS_URL_FIELD,
                "GOOGLE_CALENDAR_ICS_URL",
            )
            .unwrap_or_default(),
        }
    }
}

pub fn with_state(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (Arc<RwLock<AppState>>,), Error = std::convert::Infallible> + Clone {
    let app_state = app_state.clone();
    warp::any().map(move || app_state.clone())
}

// Example of warp usage: https://github.com/seanmonstar/warp/blob/master/examples/todos.rs
pub fn init_api(app_state: &Arc<RwLock<AppState>>, port: u16) -> Result<()> {
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        .allow_headers(vec!["Content-Type"]);

    let api = warp::path("api")
        .and(warp::path("v1"))
        .and(
            devices(app_state)
                .or(actions(app_state))
                .or(config(app_state)),
        )
        .map(Reply::into_response)
        .boxed();

    let ws = ws(app_state).map(Reply::into_response).boxed();
    let health = health(app_state).map(Reply::into_response).boxed();
    let ui_config = ui_config_route(app_state);
    let widgets = widgets::widgets(app_state);

    let mut routes = ws
        .or(api)
        .unify()
        .or(health)
        .unify()
        .or(ui_config)
        .unify()
        .or(widgets)
        .unify()
        .boxed();

    if let Some(ui_routes) = bundled_ui_routes() {
        routes = routes.or(ui_routes).unify().boxed();
    }

    info!("Starting API server on port {}", port);
    tokio::spawn(async move {
        warp::serve(routes.with(cors))
            .run(([0, 0, 0, 0], port))
            .await;
    });

    Ok(())
}

fn env_var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

fn default_ws_endpoint(host: Option<&str>, forwarded_proto: Option<&str>) -> String {
    let host = host.unwrap_or("localhost:45289");
    let ws_scheme = match forwarded_proto.unwrap_or("http") {
        "https" | "wss" => "wss",
        _ => "ws",
    };

    format!("{ws_scheme}://{host}/ws")
}

fn ui_config_route(app_state: &Arc<RwLock<AppState>>) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "config")
        .and(warp::get())
        .and(warp::header::optional::<String>("host"))
        .and(warp::header::optional::<String>("x-forwarded-proto"))
        .and(with_state(app_state))
        .and_then(
            |host: Option<String>,
             forwarded_proto: Option<String>,
             app_state: Arc<RwLock<AppState>>| async move {
                let state = app_state.read().await;
                let widget_settings = state.get_runtime_config().widget_settings.clone();

                Ok::<_, warp::Rejection>(
                    warp::reply::json(&UiConfigResponse::from_request(
                        host.as_deref(),
                        forwarded_proto.as_deref(),
                        &widget_settings,
                    ))
                    .into_response(),
                )
            },
        )
        .boxed()
}

fn bundled_ui_routes() -> Option<BoxedFilter<(Response,)>> {
    let dist_dir = resolve_ui_dist_dir()?;
    let index_file = dist_dir.join("index.html");

    info!("Serving bundled UI assets from {}", dist_dir.display());

    let static_assets = warp::get()
        .and(warp::fs::dir(dist_dir))
        .map(Reply::into_response);

    let spa_fallback = warp::get()
        .and(warp::path::full())
        .and_then(move |full_path: FullPath| serve_spa_index(full_path, index_file.clone()));

    Some(static_assets.or(spa_fallback).unify().boxed())
}

fn resolve_ui_dist_dir() -> Option<PathBuf> {
    if let Some(configured_path) = env_var("HOMECTL_UI_DIST_DIR") {
        let configured_path = PathBuf::from(configured_path);
        if configured_path.join("index.html").exists() {
            return Some(configured_path);
        }

        warn!(
            "Ignoring HOMECTL_UI_DIST_DIR because index.html was not found in {}",
            configured_path.display()
        );
    }

    for candidate in DEFAULT_UI_DIST_CANDIDATES {
        let candidate = PathBuf::from(candidate);
        if candidate.join("index.html").exists() {
            return Some(candidate);
        }
    }

    info!("No bundled UI assets found; skipping static UI routes");
    None
}

async fn serve_spa_index(full_path: FullPath, index_file: PathBuf) -> Result<Response, Rejection> {
    let request_path = full_path.as_str();
    if is_reserved_server_path(request_path)
        || request_path
            .rsplit('/')
            .next()
            .is_some_and(|segment| segment.contains('.'))
    {
        return Err(warp::reject::not_found());
    }

    let html = tokio::fs::read_to_string(&index_file)
        .await
        .map_err(|error| {
            warn!(
                "Failed to read bundled UI index from {}: {error}",
                index_file.display()
            );
            warp::reject::not_found()
        })?;

    Ok(warp::reply::html(html).into_response())
}

fn is_reserved_server_path(path: &str) -> bool {
    path == "/api"
        || path.starts_with("/api/")
        || path == "/ws"
        || path == "/health"
        || path.starts_with("/health/")
}
