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

use crate::core::snapshot::SnapshotHandle;
use crate::db::config_queries::WidgetSettingRow;
use once_cell::sync::Lazy;
use warp::{filters::BoxedFilter, reply::Response, Filter, Reply};

pub(crate) const WEATHER_SETTING_KEY: &str = "weather";
pub(crate) const TRAIN_SCHEDULE_SETTING_KEY: &str = "train_schedule";
pub(crate) const CALENDAR_SETTING_KEY: &str = "calendar";
pub(crate) const INFLUXDB_SETTING_KEY: &str = "influxdb";

pub(crate) const API_URL_FIELD: &str = "apiUrl";
pub(crate) const URL_FIELD: &str = "url";
pub(crate) const TOKEN_FIELD: &str = "token";
pub(crate) const ICS_URL_FIELD: &str = "icsUrl";

static HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("homectl/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("failed to build reqwest client")
});

pub(crate) fn widget_setting_string(
    settings: &[WidgetSettingRow],
    key: &str,
    field: &str,
) -> Option<String> {
    settings
        .iter()
        .find(|setting| setting.key == key)
        .and_then(|setting| setting.config.get(field))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

pub(crate) fn widget_setting_string_or_env(
    settings: &[WidgetSettingRow],
    key: &str,
    field: &str,
    env_name: &str,
) -> Option<String> {
    widget_setting_string(settings, key, field)
        .or_else(|| env::var(env_name).ok().filter(|value| !value.is_empty()))
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
