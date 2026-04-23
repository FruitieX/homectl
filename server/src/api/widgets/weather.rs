use crate::core::snapshot::SnapshotHandle;
use cached::proc_macro::cached;
use serde_json::{json, Value};
use warp::{
    filters::BoxedFilter,
    http::StatusCode,
    reply::{self, Response},
    Filter, Reply,
};

use super::{widget_setting_string_or_env, API_URL_FIELD, WEATHER_SETTING_KEY};

pub fn route(snapshot: SnapshotHandle, http: reqwest::Client) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "weather")
        .and(warp::get())
        .and_then(move || {
            let snapshot = snapshot.clone();
            let http = http.clone();
            async move { Ok::<_, warp::Rejection>(handle(snapshot, http).await) }
        })
        .boxed()
}

async fn handle(snapshot: SnapshotHandle, http: reqwest::Client) -> Response {
    let url = match widget_setting_string_or_env(
        &snapshot.load().runtime_config.widget_settings,
        WEATHER_SETTING_KEY,
        API_URL_FIELD,
        "WEATHER_API_URL",
    ) {
        Some(url) => url,
        None => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Weather API URL not configured",
            )
        }
    };

    let result = fetch_weather(url, http).await;

    match result {
        Ok(value) => reply::json(&value).into_response(),
        Err(err) => {
            log::error!("Error fetching weather: {err}");
            error(StatusCode::BAD_GATEWAY, "Failed to fetch weather data")
        }
    }
}

#[cached(
    result = true,
    time = 3600,
    key = "String",
    convert = r#"{ url.clone() }"#,
    sync_writes = "by_key"
)]
async fn fetch_weather(url: String, http: reqwest::Client) -> Result<Value, String> {
    log::info!("Fetching weather data...");
    let res = http.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to fetch weather: {}", res.status()));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
}

fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}
