//! Dashboard data-feed endpoints.
//!
//! These routes proxy/transform data from external services (weather, HSL
//! trains, Google Calendar ICS, InfluxDB) for the dashboard cards. Each
//! response is cached briefly in-process to keep upstream calls down.

mod calendar;
mod influx;
mod spot_prices;
mod temp_sensors;
mod train_schedule;
mod weather;

use std::env;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::core::snapshot::SnapshotHandle;
use crate::db::config_queries::WidgetSettingRow;
use once_cell::sync::Lazy;
use warp::{filters::BoxedFilter, reply::Response, Filter, Reply};

pub(crate) const WEATHER_SETTING_KEY: &str = "weather";
pub(crate) const TRAIN_SCHEDULE_SETTING_KEY: &str = "train_schedule";
pub(crate) const CALENDAR_SETTING_KEY: &str = "calendar";
pub(crate) const INFLUXDB_SETTING_KEY: &str = "influxdb";
pub(crate) const SENSOR_CATALOG_SETTING_KEY: &str = "sensor_catalog";

pub(crate) const API_URL_FIELD: &str = "apiUrl";
pub(crate) const URL_FIELD: &str = "url";
pub(crate) const TOKEN_FIELD: &str = "token";
pub(crate) const ICS_URL_FIELD: &str = "icsUrl";

/// Resolve a saved widget's options on the server so its credentials never
/// need to travel through browser responses or URL query strings.
pub(crate) fn saved_widget_options(
    snapshot: &SnapshotHandle,
    id: i32,
    kind: &str,
) -> Result<serde_json::Value, &'static str> {
    let snap = snapshot.load();
    let widget = snap
        .runtime_config
        .dashboard_widgets
        .iter()
        .find(|widget| widget.id == id && widget.widget_type == kind)
        .ok_or("Widget not found or has a different type")?;
    Ok(crate::api::config::dashboard::options(widget).clone())
}

pub(crate) fn option_string(options: &serde_json::Value, key: &str) -> Option<String> {
    options
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

// Widget sources (InfluxDB, weather, calendar, trains) must not hang a
// dashboard: with no timeout one stuck upstream request held every widget
// request behind it until the display's own 10 s timeout. A failed refresh
// serves the last good value instead (`result_fallback` on each fetcher).
static HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("homectl/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .expect("failed to build reqwest client")
});

/// Allowance on top of a cache's TTL before a value counts as stale.
const STALE_GRACE: Duration = Duration::from_secs(15);

/// A fetched widget source value and when it was fetched. The fetchers use
/// `result_fallback`, so after a failed refresh they serve an older value;
/// [`Fetched::reply`] marks those replies so the dashboard can say so.
#[derive(Clone)]
pub(crate) struct Fetched<T> {
    pub value: T,
    pub at: SystemTime,
}

impl<T> Fetched<T> {
    pub fn now(value: T) -> Self {
        Self {
            value,
            at: SystemTime::now(),
        }
    }

    /// Adds `x-homectl-stale-since` (Unix ms of the fetch) when the value is
    /// older than the cache TTL, i.e. its refresh failed.
    pub fn reply(&self, ttl: Duration, mut response: Response) -> Response {
        let expired = self.at.elapsed().is_ok_and(|age| age > ttl + STALE_GRACE);
        if let (true, Ok(since)) = (expired, self.at.duration_since(UNIX_EPOCH)) {
            response.headers_mut().insert(
                STALE_SINCE_HEADER,
                warp::http::HeaderValue::from(since.as_millis() as u64),
            );
        }
        response
    }
}

pub(crate) const STALE_SINCE_HEADER: &str = "x-homectl-stale-since";

pub(crate) fn widget_setting_string_or_env(
    settings: &[WidgetSettingRow],
    key: &str,
    field: &str,
    env_name: &str,
) -> Option<String> {
    // An explicitly empty saved field disables the value. Only omission uses
    // the deployment fallback; otherwise clearing a credential would revive it.
    if let Some(value) = settings
        .iter()
        .find(|row| row.key == key)
        .and_then(|row| row.config.get(field))
    {
        return value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
    }
    env::var(env_name).ok().filter(|value| !value.is_empty())
}

pub fn widgets(snapshot: SnapshotHandle) -> BoxedFilter<(Response,)> {
    let http = HTTP.clone();

    weather::route(snapshot.clone(), http.clone())
        .or(calendar::route(snapshot.clone(), http.clone()))
        .unify()
        .or(train_schedule::route(snapshot.clone(), http.clone()))
        .unify()
        .or(spot_prices::route(snapshot.clone(), http.clone()))
        .unify()
        .or(temp_sensors::route(snapshot, http))
        .unify()
        .map(Reply::into_response)
        .boxed()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_values_past_their_ttl_are_marked_stale() {
        let ttl = Duration::from_secs(60);
        let reply = || warp::reply().into_response();

        let fresh = Fetched::now(());
        assert!(fresh
            .reply(ttl, reply())
            .headers()
            .get(STALE_SINCE_HEADER)
            .is_none());

        // Within the grace period: a refresh may just be in flight.
        let at = SystemTime::now() - ttl - STALE_GRACE + Duration::from_secs(5);
        let recent = Fetched { value: (), at };
        assert!(recent
            .reply(ttl, reply())
            .headers()
            .get(STALE_SINCE_HEADER)
            .is_none());

        let at = SystemTime::now() - ttl - STALE_GRACE - Duration::from_secs(30);
        let stale = Fetched { value: (), at };
        let since = at
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string();
        assert_eq!(
            stale
                .reply(ttl, reply())
                .headers()
                .get(STALE_SINCE_HEADER)
                .unwrap(),
            since.as_str()
        );
    }
    #[test]
    fn widget_source_explicit_empty_suppresses_environment_fallback() {
        // PATH is an existing non-secret value: no process environment mutation.
        let fallback = env::var("PATH").ok().filter(|value| !value.is_empty());
        assert!(fallback.is_some());
        assert_eq!(
            widget_setting_string_or_env(&[], "source", "field", "PATH"),
            fallback
        );
        let mut settings = vec![WidgetSettingRow {
            key: "source".into(),
            config: serde_json::json!({"other":true}),
        }];
        assert_eq!(
            widget_setting_string_or_env(&settings, "source", "field", "PATH"),
            fallback
        );
        settings[0].config["field"] = serde_json::json!("");
        assert_eq!(
            widget_setting_string_or_env(&settings, "source", "field", "PATH"),
            None
        );
        settings[0].config["field"] = serde_json::json!("saved-value");
        assert_eq!(
            widget_setting_string_or_env(&settings, "source", "field", "PATH"),
            Some("saved-value".into())
        );
    }
}
