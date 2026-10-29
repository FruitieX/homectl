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
    influx, widget_setting_string_or_env, Fetched, INFLUXDB_SETTING_KEY, TOKEN_FIELD, URL_FIELD,
};

/// Keep in sync with `ttl_secs` on [`fetch_spot_prices`].
const TTL: std::time::Duration = std::time::Duration::from_secs(60);

const QUERY: &str = r#"
          import "date"
          import "timezone"

          option location = timezone.location(name: "Europe/Helsinki")

          from(bucket: "nordpool")
            |> range(start: date.truncate(t: now(), unit: 1d), stop: 48h)
            |> filter(fn: (r) => r["_measurement"] == "price")
        "#;

pub fn route(snapshot: SnapshotHandle, http: reqwest::Client) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "influxdb" / "spot-prices")
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

    let result = fetch_spot_prices(url, token, http).await;

    match result {
        Ok(fetched) => fetched.reply(TTL, reply::json(&fetched.value).into_response()),
        Err(err) => {
            log::error!("Error fetching spot prices: {err}");
            error(StatusCode::BAD_GATEWAY, "Failed to fetch spot price data")
        }
    }
}

#[cached(
    ttl_secs = 60,
    key = "String",
    convert = r#"{ url.clone() }"#,
    result_fallback = true
)]
async fn fetch_spot_prices(
    url: String,
    token: String,
    http: reqwest::Client,
) -> Result<Fetched<Value>, String> {
    let rows = influx::query(&http, &url, &token, QUERY).await?;
    Ok(Fetched::now(Value::Array(rows)))
}

fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}
