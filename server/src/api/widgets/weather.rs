use crate::core::snapshot::SnapshotHandle;
use cached::proc_macro::cached;
use serde::Deserialize;
use serde_json::{json, Value};
use warp::{
    filters::BoxedFilter,
    http::StatusCode,
    reply::{self, Response},
    Filter, Reply,
};

use super::{widget_setting_string_or_env, Fetched, API_URL_FIELD, WEATHER_SETTING_KEY};

/// Keep in sync with `ttl_secs` on [`fetch_weather`].
const TTL: std::time::Duration = std::time::Duration::from_secs(3600);

pub fn route(snapshot: SnapshotHandle, http: reqwest::Client) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "weather")
        .and(warp::get())
        .and(warp::query::<WeatherQuery>())
        .and_then(move |query: WeatherQuery| {
            let snapshot = snapshot.clone();
            let http = http.clone();
            async move { Ok::<_, warp::Rejection>(handle(query, snapshot, http).await) }
        })
        .boxed()
}

#[derive(Debug, Default, Deserialize)]
struct WeatherQuery {
    url: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn handle(query: WeatherQuery, snapshot: SnapshotHandle, http: reqwest::Client) -> Response {
    let url = match non_empty(query.url).or_else(|| {
        widget_setting_string_or_env(
            &snapshot.load().runtime_config.widget_settings,
            WEATHER_SETTING_KEY,
            API_URL_FIELD,
            "WEATHER_API_URL",
        )
    }) {
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
        Ok(fetched) => fetched.reply(TTL, reply::json(&fetched.value).into_response()),
        Err(err) => {
            log::error!("Error fetching weather: {err}");
            error(StatusCode::BAD_GATEWAY, "Failed to fetch weather data")
        }
    }
}

#[cached(
    ttl_secs = 3600,
    key = "String",
    convert = r#"{ url.clone() }"#,
    result_fallback = true
)]
async fn fetch_weather(url: String, http: reqwest::Client) -> Result<Fetched<Value>, String> {
    log::info!("Fetching weather data...");
    let res = http.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to fetch weather: {}", res.status()));
    }
    res.json::<Value>()
        .await
        .map(Fetched::now)
        .map_err(|e| e.to_string())
}

fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}
