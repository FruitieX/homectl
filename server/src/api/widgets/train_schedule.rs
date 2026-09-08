use crate::core::snapshot::SnapshotHandle;
use cached::proc_macro::cached;
use chrono::Utc;
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
    stoptimesWithoutPatterns(numberOfDepartures: 100, timeRange: 86400) {{
      scheduledDeparture
      realtimeDeparture
      realtime
      realtimeState
      serviceDay
      headsign
      trip {{
        routeShortName
        directionId
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
    destination: Option<String>,
    direction_id: Option<u8>,
    overdue_minutes: Option<i64>,
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
    let walk_minutes = query
        .walk_minutes
        .unwrap_or(DEFAULT_WALK_MINUTES)
        .clamp(0, 240);
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 20);
    let overdue_minutes = query.overdue_minutes.unwrap_or(3).clamp(0, 60);
    if query.direction_id.is_some_and(|direction| direction > 1) {
        return error(StatusCode::BAD_REQUEST, "Direction must be 0 or 1");
    }
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

    let result = fetch_train_schedule(url, station_id, http).await;

    match result {
        Ok(value) => reply::json(&transform(
            value,
            walk_minutes,
            limit,
            non_empty(query.destination).as_deref(),
            query.direction_id,
            overdue_minutes,
            Utc::now().timestamp(),
        ))
        .into_response(),
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
    convert = r#"{ format!("{url}|{station_id}") }"#,
    sync_writes = "by_key"
)]
async fn fetch_train_schedule(
    url: String,
    station_id: String,
    http: reqwest::Client,
) -> Result<HslResponse, String> {
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
    Ok(parsed)
}

fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}

#[derive(Clone, Debug, Deserialize)]
struct HslResponse {
    data: HslData,
}

#[derive(Clone, Debug, Deserialize)]
struct HslData {
    stop: HslStop,
}

#[derive(Clone, Debug, Deserialize)]
struct HslStop {
    #[serde(rename = "stoptimesWithoutPatterns")]
    stoptimes_without_patterns: Vec<HslStopTime>,
}

#[derive(Clone, Debug, Deserialize)]
struct HslStopTime {
    #[serde(rename = "serviceDay")]
    service_day: i64,
    #[serde(rename = "scheduledDeparture")]
    scheduled_departure: i64,
    headsign: Option<String>,
    #[serde(rename = "realtimeDeparture")]
    realtime_departure: i64,
    realtime: bool,
    #[serde(rename = "realtimeState")]
    realtime_state: String,
    trip: HslTrip,
}

#[derive(Clone, Debug, Deserialize)]
struct HslTrip {
    #[serde(rename = "routeShortName")]
    route_short_name: String,
    #[serde(rename = "directionId")]
    direction_id: Option<String>,
}

impl HslStopTime {
    fn departure_seconds(&self) -> i64 {
        if self.realtime && self.realtime_departure >= 0 && self.realtime_state != "CANCELED" {
            self.realtime_departure
        } else {
            self.scheduled_departure
        }
    }
}

fn transform(
    response: HslResponse,
    walk_minutes: i64,
    limit: usize,
    destination: Option<&str>,
    direction_id: Option<u8>,
    overdue_minutes: i64,
    now: i64,
) -> Value {
    let destination = destination.map(str::to_lowercase);
    let mut departures = response.data.stop.stoptimes_without_patterns;
    departures.sort_by_key(|st| st.service_day + st.departure_seconds());

    let mut trains: Vec<Value> = Vec::new();
    for st in departures {
        if destination.as_ref().is_some_and(|filter| {
            !st.headsign
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .contains(filter)
        }) || direction_id.is_some_and(|filter| {
            st.trip
                .direction_id
                .as_deref()
                .and_then(|id| id.parse::<u8>().ok())
                != Some(filter)
        }) {
            continue;
        }
        let seconds = st.departure_seconds();
        let departure_at = st.service_day + seconds;
        let sec_until_departure = departure_at - now;
        let min_until_departure = sec_until_departure.div_euclid(60);
        let min_until_home_departure = min_until_departure - walk_minutes;

        if min_until_home_departure < -overdue_minutes {
            continue;
        }

        let total_seconds = seconds.rem_euclid(24 * 3600);
        let hours = total_seconds / 3600;
        let minutes = (total_seconds % 3600) / 60;
        let departure_formatted = format!("{hours:02}:{minutes:02}");

        trains.push(json!({
            "minUntilHomeDeparture": min_until_home_departure,
            "name": st.trip.route_short_name,
            "destination": st.headsign,
            "directionId": st.trip.direction_id,
            "departureAt": departure_at,
            "leaveAt": departure_at - walk_minutes * 60,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn departure(day: i64, seconds: i64, destination: &str, direction: &str) -> Value {
        json!({"serviceDay": day, "scheduledDeparture": seconds, "realtimeDeparture": seconds + 60,
            "realtime": false, "realtimeState": "SCHEDULED", "headsign": destination,
            "trip": {"routeShortName": "U", "directionId": direction}})
    }

    fn response(rows: Vec<Value>) -> HslResponse {
        serde_json::from_value(json!({"data":{"stop":{"stoptimesWithoutPatterns":rows}}})).unwrap()
    }

    #[test]
    fn service_day_handles_midnight_and_scheduled_departures() {
        let result = transform(
            response(vec![departure(0, 86520, "Helsinki", "0")]),
            12,
            5,
            None,
            None,
            9,
            86340,
        );
        assert_eq!(result[0]["departureAt"], 86520);
        assert_eq!(result[0]["departureFormatted"], "00:02");
        assert_eq!(result[0]["leaveAt"], 85800);
        assert_eq!(result[0]["minUntilHomeDeparture"], -9);
    }

    #[test]
    fn overdue_limit_uses_leave_home_countdown_before_limiting_results() {
        let result = transform(
            response(vec![
                departure(0, 1480, "Helsinki", "0"),
                departure(0, 1540, "Helsinki", "0"),
                departure(0, 1720, "Helsinki", "0"),
            ]),
            12,
            1,
            None,
            None,
            3,
            1000,
        );
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["minUntilHomeDeparture"], -3);
        assert_eq!(result[0]["departureAt"], 1540);
    }

    #[test]
    fn filters_and_sorts_before_limiting() {
        let result = transform(
            response(vec![
                departure(0, 500, "Helsinki", "0"),
                departure(0, 100, "Kirkkonummi", "1"),
                departure(0, 300, "Helsinki via Espoo", "0"),
            ]),
            0,
            1,
            Some("HELSINKI"),
            Some(0),
            0,
            0,
        );
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["departureAt"], 300);
        assert_eq!(result[0]["destination"], "Helsinki via Espoo");
    }

    #[test]
    fn cached_response_recalculates_and_preserves_cancellations() {
        let mut cancelled = departure(0, 300, "Helsinki", "0");
        cancelled["realtimeState"] = json!("CANCELED");
        cancelled["realtime"] = json!(true);
        cancelled["realtimeDeparture"] = json!(-1);
        let data = response(vec![departure(0, 100, "Helsinki", "0"), cancelled]);
        let result = transform(data.clone(), 0, 5, None, None, 0, 200);
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["realtimeState"], "CANCELED");
        assert!(transform(data, 0, 5, None, None, 0, 400)
            .as_array()
            .unwrap()
            .is_empty());
    }
}
