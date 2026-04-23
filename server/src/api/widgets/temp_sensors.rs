use crate::core::snapshot::SnapshotHandle;
use cached::proc_macro::cached;
use serde_json::{json, Value};
use warp::{
    filters::BoxedFilter,
    http::StatusCode,
    reply::{self, Response},
    Filter, Reply,
};

use super::{
    influx, widget_setting_string_or_env, INFLUXDB_SETTING_KEY, TOKEN_FIELD, URL_FIELD,
};

/// Known temperature/humidity sensor device IDs. The Flux query needs the
/// explicit list so InfluxDB can filter on them server-side (mirrors what the
/// previous Next.js handler did).
const DEVICE_IDS: &[&str] = &[
    "D83431306571",
    "C76A05062842",
    "D83535301C43",
    "D7353530520F",
    "D63534385106",
    "D7353530665A",
    "CE2A82463674",
    "D9353438450D",
    "D4343037362D",
    "C76A0246647E",
    "D83534387029",
    "C76A03460A73",
];

pub fn route(
    snapshot: SnapshotHandle,
    http: reqwest::Client,
) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "influxdb" / "temp-sensors")
        .and(warp::get())
        .and_then(move || {
            let snapshot = snapshot.clone();
            let http = http.clone();
            async move { Ok::<_, warp::Rejection>(handle(snapshot, http).await) }
        })
        .boxed()
}

async fn handle(snapshot: SnapshotHandle, http: reqwest::Client) -> Response {
    let (url, token) = match (
        widget_setting_string_or_env(
            &snapshot.load().runtime_config.widget_settings,
            INFLUXDB_SETTING_KEY,
            URL_FIELD,
            "INFLUX_URL",
        ),
        widget_setting_string_or_env(
            &snapshot.load().runtime_config.widget_settings,
            INFLUXDB_SETTING_KEY,
            TOKEN_FIELD,
            "INFLUX_TOKEN",
        ),
    ) {
        (Some(url), Some(token)) => (url, token),
        _ => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "InfluxDB URL or token not configured",
            )
        }
    };

    let result = fetch_temp_sensors(url, token, http).await;

    match result {
        Ok(value) => reply::json(&value).into_response(),
        Err(err) => {
            log::error!("Error fetching temperature/humidity sensors: {err}");
            error(StatusCode::BAD_GATEWAY, "Failed to fetch sensor data")
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
async fn fetch_temp_sensors(
    url: String,
    token: String,
    http: reqwest::Client,
) -> Result<Value, String> {
    let rows = influx::query(&http, &url, &token, &build_query()).await?;
    Ok(Value::Array(rows))
}

fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}

fn build_query() -> String {
    let filters = DEVICE_IDS
        .iter()
        .map(|id| format!("(r[\"device_id\"] == \"{id}\")"))
        .collect::<Vec<_>>()
        .join(" or ");

    format!(
        r#"
          from(bucket: "home")
            |> range(start: -6h)
            |> filter(fn: (r) => {filters})
            |> filter(fn: (r) => r["_field"] == "tempc" or r["_field"] == "hum")
            |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
            |> yield(name: "mean")
        "#
    )
}
