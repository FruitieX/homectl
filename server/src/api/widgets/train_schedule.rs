use std::sync::Arc;

use crate::core::state::AppState;
use cached::proc_macro::cached;
use chrono::{Local, Timelike};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::RwLock;
use warp::{
    filters::BoxedFilter,
    http::StatusCode,
    reply::{self, Response},
    Filter, Reply,
};

use super::{widget_setting_string_or_env, API_URL_FIELD, TRAIN_SCHEDULE_SETTING_KEY};
const GRAPHQL_QUERY: &str = r#"
{
  stop(id: "HSL:2131551") {
    name
    stoptimesWithoutPatterns {
      scheduledDeparture
      realtimeDeparture
      realtime
      realtimeState
      serviceDay
      headsign
      trip {
        routeShortName
      }
    }
  }
}
"#;

pub fn route(app_state: Arc<RwLock<AppState>>, http: reqwest::Client) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "train-schedule")
        .and(warp::get())
        .and_then(move || {
            let app_state = app_state.clone();
            let http = http.clone();
            async move { Ok::<_, warp::Rejection>(handle(app_state, http).await) }
        })
        .boxed()
}

async fn handle(app_state: Arc<RwLock<AppState>>, http: reqwest::Client) -> Response {
    let url = match widget_setting_string_or_env(
        &app_state.read().await.get_runtime_config().widget_settings,
        TRAIN_SCHEDULE_SETTING_KEY,
        API_URL_FIELD,
        "TRAIN_API_URL",
    ) {
        Some(url) => url,
        None => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Train API URL not configured",
            )
        }
    };

    let result = fetch_train_schedule(url, http).await;

    match result {
        Ok(value) => reply::json(&value).into_response(),
        Err(err) => {
            log::error!("Error fetching train schedule: {err}");
            error(StatusCode::BAD_GATEWAY, "Failed to fetch train schedule")
        }
    }
}

#[cached(
    result = true,
    time = 60,
    key = "String",
    convert = r#"{ url.clone() }"#,
    sync_writes = "by_key"
)]
async fn fetch_train_schedule(url: String, http: reqwest::Client) -> Result<Value, String> {
    let res = http
        .post(&url)
        .header("Content-Type", "application/graphql")
        .body(GRAPHQL_QUERY)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Failed to fetch train schedule: {}", res.status()));
    }

    let parsed: HslResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(transform(parsed))
}

fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}

#[derive(Debug, Deserialize)]
struct HslResponse {
    data: HslData,
}

#[derive(Debug, Deserialize)]
struct HslData {
    stop: HslStop,
}

#[derive(Debug, Deserialize)]
struct HslStop {
    #[serde(rename = "stoptimesWithoutPatterns")]
    stoptimes_without_patterns: Vec<HslStopTime>,
}

#[derive(Debug, Deserialize)]
struct HslStopTime {
    #[serde(rename = "realtimeDeparture")]
    realtime_departure: i64,
    realtime: bool,
    #[serde(rename = "realtimeState")]
    realtime_state: String,
    trip: HslTrip,
}

#[derive(Debug, Deserialize)]
struct HslTrip {
    #[serde(rename = "routeShortName")]
    route_short_name: String,
}

fn transform(response: HslResponse) -> Value {
    const SUGGESTED_MIN_UNTIL_DEPARTURE: i64 = 12;
    let now = Local::now();
    let sec_since_midnight = (now.hour() * 3600 + now.minute() * 60 + now.second()) as i64;

    let mut trains: Vec<Value> = Vec::new();
    for st in response.data.stop.stoptimes_without_patterns {
        let sec_until_departure = st.realtime_departure - sec_since_midnight;
        let min_until_departure = sec_until_departure / 60;
        let min_until_home_departure = min_until_departure - SUGGESTED_MIN_UNTIL_DEPARTURE;

        if min_until_home_departure < -5 {
            continue;
        }

        let total_seconds = st.realtime_departure.rem_euclid(24 * 3600);
        let hours = total_seconds / 3600;
        let minutes = (total_seconds % 3600) / 60;
        let departure_formatted = format!("{hours:02}:{minutes:02}");

        trains.push(json!({
            "minUntilHomeDeparture": min_until_home_departure,
            "name": st.trip.route_short_name,
            "departureFormatted": departure_formatted,
            "realtime": st.realtime,
            "realtimeState": st.realtime_state,
        }));

        if trains.len() == 5 {
            break;
        }
    }

    Value::Array(trains)
}
