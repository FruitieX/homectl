use crate::core::snapshot::SnapshotHandle;
use cached::proc_macro::cached;
use chrono::{Local, Timelike};
use serde::Deserialize;
use serde_json::{json, Value};
use warp::{
    filters::BoxedFilter,
    http::StatusCode,
    reply::{self, Response},
    Filter, Reply,
};

use super::{widget_setting_string_or_env, API_URL_FIELD, TRAIN_SCHEDULE_SETTING_KEY};

const DEFAULT_STATION_ID: &str = "HSL:2131551";
const DEFAULT_WALK_MINUTES: i64 = 12;
const DEFAULT_LIMIT: usize = 5;

fn build_graphql_query(station_id: &str) -> String {
    let escaped_station_id = station_id.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        r#"
{{
  stop(id: "{escaped_station_id}") {{
    name
    stoptimesWithoutPatterns {{
      scheduledDeparture
      realtimeDeparture
      realtime
      realtimeState
      serviceDay
      headsign
      trip {{
        routeShortName
      }}
    }}
  }}
}}
"#,
    )
}

pub fn route(snapshot: SnapshotHandle, http: reqwest::Client) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "train-schedule")
        .and(warp::get())
        .and(warp::query::<TrainScheduleQuery>())
        .and_then(move |query: TrainScheduleQuery| {
            let snapshot = snapshot.clone();
            let http = http.clone();
            async move { Ok::<_, warp::Rejection>(handle(query, snapshot, http).await) }
        })
        .boxed()
}

#[derive(Debug, Default, Deserialize)]
struct TrainScheduleQuery {
    url: Option<String>,
    station_id: Option<String>,
    walk_minutes: Option<i64>,
    limit: Option<usize>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn handle(
    query: TrainScheduleQuery,
    snapshot: SnapshotHandle,
    http: reqwest::Client,
) -> Response {
    let station_id = non_empty(query.station_id).unwrap_or_else(|| DEFAULT_STATION_ID.to_string());
    let walk_minutes = query.walk_minutes.unwrap_or(DEFAULT_WALK_MINUTES).max(0);
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 20);
    let url = match non_empty(query.url).or_else(|| {
        widget_setting_string_or_env(
            &snapshot.load().runtime_config.widget_settings,
            TRAIN_SCHEDULE_SETTING_KEY,
            API_URL_FIELD,
            "TRAIN_API_URL",
        )
    }) {
        Some(url) => url,
        None => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Train API URL not configured",
            )
        }
    };

    let result = fetch_train_schedule(url, station_id, walk_minutes, limit, http).await;

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
    convert = r#"{ format!("{url}|{station_id}|{walk_minutes}|{limit}") }"#,
    sync_writes = "by_key"
)]
async fn fetch_train_schedule(
    url: String,
    station_id: String,
    walk_minutes: i64,
    limit: usize,
    http: reqwest::Client,
) -> Result<Value, String> {
    let res = http
        .post(&url)
        .header("Content-Type", "application/graphql")
        .body(build_graphql_query(&station_id))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Failed to fetch train schedule: {}", res.status()));
    }

    let parsed: HslResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(transform(parsed, walk_minutes, limit))
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

fn transform(response: HslResponse, walk_minutes: i64, limit: usize) -> Value {
    let now = Local::now();
    let sec_since_midnight = (now.hour() * 3600 + now.minute() * 60 + now.second()) as i64;

    let mut trains: Vec<Value> = Vec::new();
    for st in response.data.stop.stoptimes_without_patterns {
        let sec_until_departure = st.realtime_departure - sec_since_midnight;
        let min_until_departure = sec_until_departure / 60;
        let min_until_home_departure = min_until_departure - walk_minutes;

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

        if trains.len() == limit {
            break;
        }
    }

    Value::Array(trains)
}
