//! TimescaleDB source for the sensor history and spot price widgets.
//!
//! When `TSDB_URL` (a PostgreSQL connection URL, read-only role) is set,
//! `/api/influxdb/temp-sensors` and `/api/influxdb/spot-prices` read the
//! `mqtt_consumer` and `nordpool_price` tables instead of running Flux against
//! InfluxDB. The tables use Telegraf's `outputs.postgresql` layout (a `time`
//! column, one text column per tag, one column per field).
//!
//! The replies reproduce the InfluxDB rows the dashboards already parse:
//! `_start`, `_stop`, `_time`, `_field`, `_measurement`, the series' tags and
//! `_value`, all as strings (the Flux client never asked for type
//! annotations), in InfluxDB's order (series key, then field, then time).
//!
//! Once InfluxDB is gone, delete `influx.rs` and the InfluxDB branches in
//! `temp_sensors.rs`/`spot_prices.rs`.

use std::cmp::Ordering;
use std::str::FromStr;
use std::time::Duration;

use chrono::{DateTime, Months, TimeZone, Utc};
use chrono_tz::Europe::Helsinki;
use once_cell::sync::Lazy;
use serde_json::{Map, Value};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::Row;

pub(crate) const TSDB_URL_ENV: &str = "TSDB_URL";

/// Same budget as the InfluxDB requests (`HTTP` in `mod.rs`).
const QUERY_TIMEOUT: Duration = Duration::from_secs(6);

/// Tag columns of `mqtt_consumer` (Telegraf tags of the MQTT topics).
const MQTT_TAGS: [&str; 12] = [
    "brand",
    "device_id",
    "entity",
    "integration_id",
    "kind",
    "mac",
    "model",
    "model_id",
    "name",
    "sensor_id",
    "topic",
    "type",
];

const SENSOR_FIELDS: [&str; 2] = ["hum", "tempc"];

static POOL: Lazy<Option<PgPool>> = Lazy::new(|| {
    let url = std::env::var(TSDB_URL_ENV)
        .ok()
        .filter(|value| !value.is_empty())?;
    let options = match PgConnectOptions::from_str(&url) {
        Ok(options) => options,
        Err(err) => {
            log::error!("Ignoring invalid {TSDB_URL_ENV}: {err}");
            return None;
        }
    };
    // UTC so that day/week/month arithmetic matches Flux's (no location set).
    let options = options
        .application_name("homectl")
        .options([("timezone", "UTC"), ("statement_timeout", "10s")]);
    Some(
        PgPoolOptions::new()
            .max_connections(4)
            .acquire_timeout(Duration::from_secs(3))
            .idle_timeout(Duration::from_secs(300))
            .connect_lazy_with(options),
    )
});

/// The TimescaleDB pool, when `TSDB_URL` is configured.
pub(crate) fn pool() -> Option<&'static PgPool> {
    POOL.as_ref()
}

/// A Flux duration literal (`-6h`, `10m`, `1h30m`, `-7d`, `1mo`): months and
/// microseconds, applied in that order like Flux does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FluxDuration {
    pub months: i64,
    pub micros: i64,
}

impl FluxDuration {
    pub fn parse(value: &str) -> Option<Self> {
        let (negative, mut rest) = match value.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, value),
        };
        if rest.is_empty() {
            return None;
        }
        let (mut months, mut micros) = (0i64, 0i64);
        while !rest.is_empty() {
            let digits = rest.find(|ch: char| !ch.is_ascii_digit())?;
            if digits == 0 {
                return None;
            }
            let amount: i64 = rest[..digits].parse().ok()?;
            rest = &rest[digits..];
            let unit_len = rest
                .find(|ch: char| ch.is_ascii_digit())
                .unwrap_or(rest.len());
            let unit = &rest[..unit_len];
            rest = &rest[unit_len..];
            let micros_per = match unit {
                "y" => {
                    months = months.checked_add(amount.checked_mul(12)?)?;
                    continue;
                }
                "mo" => {
                    months = months.checked_add(amount)?;
                    continue;
                }
                "w" => 7 * 86_400_000_000,
                "d" => 86_400_000_000,
                "h" => 3_600_000_000,
                "m" => 60_000_000,
                "s" => 1_000_000,
                "ms" => 1_000,
                "us" | "µs" => 1,
                "ns" => {
                    micros = micros.checked_add(amount / 1_000)?;
                    continue;
                }
                _ => return None,
            };
            micros = micros.checked_add(amount.checked_mul(micros_per)?)?;
        }
        Some(if negative {
            Self {
                months: -months,
                micros: -micros,
            }
        } else {
            Self { months, micros }
        })
    }

    fn add_to(self, time: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let months = u32::try_from(self.months.unsigned_abs()).ok()?;
        let time = match self.months.cmp(&0) {
            Ordering::Greater => time.checked_add_months(Months::new(months))?,
            Ordering::Less => time.checked_sub_months(Months::new(months))?,
            Ordering::Equal => time,
        };
        time.checked_add_signed(chrono::Duration::microseconds(self.micros))
    }
}

/// Current time at the database's precision.
pub(crate) fn now() -> DateTime<Utc> {
    let now = Utc::now();
    DateTime::from_timestamp_micros(now.timestamp_micros()).unwrap_or(now)
}

/// RFC 3339 in UTC with trailing fractional zeros removed, as InfluxDB
/// prints times (`2026-10-31T09:10:00Z`, `2026-10-31T15:08:33.333667Z`).
pub(crate) fn format_time(time: DateTime<Utc>) -> String {
    let base = time.format("%Y-%m-%dT%H:%M:%S").to_string();
    let nanos = time.timestamp_subsec_nanos();
    if nanos == 0 {
        return format!("{base}Z");
    }
    let fraction = format!("{nanos:09}");
    format!("{base}.{}Z", fraction.trim_end_matches('0'))
}

fn micros_to_time(micros: i64) -> Result<DateTime<Utc>, String> {
    DateTime::from_timestamp_micros(micros).ok_or_else(|| format!("time out of range: {micros}"))
}

/// InfluxDB's float formatting (Go `FormatFloat(v, 'f', -1, 64)`): the
/// shortest decimal that round-trips, never in exponent form.
fn format_value(value: f64) -> String {
    value.to_string()
}

/// Series key as InfluxDB sorts it: measurement, then `,tag=value` in tag
/// order, with commas, equals signs and spaces escaped.
fn series_key(measurement: &str, tags: &[(&str, String)]) -> String {
    let escape = |value: &str| {
        value
            .replace('\\', "\\\\")
            .replace(',', "\\,")
            .replace('=', "\\=")
            .replace(' ', "\\ ")
    };
    let mut key = measurement.to_string();
    for (tag, value) in tags {
        key.push(',');
        key.push_str(tag);
        key.push('=');
        key.push_str(&escape(value));
    }
    key
}

async fn with_timeout<T>(
    future: impl std::future::Future<Output = Result<T, sqlx::Error>>,
) -> Result<T, String> {
    match tokio::time::timeout(QUERY_TIMEOUT, future).await {
        Ok(result) => result.map_err(|err| format!("TimescaleDB query failed: {err}")),
        Err(_) => Err("TimescaleDB query timed out".to_string()),
    }
}

const SENSOR_SQL: &str = r#"
SELECT brand, device_id, entity, integration_id, kind, mac, model, model_id,
       name, sensor_id, topic, type,
       (extract(epoch FROM date_bin($3 * interval '1 microsecond', time, 'epoch'::timestamptz))
         * 1000000)::bigint AS window_start,
       avg(hum ORDER BY time) AS hum,
       avg(tempc ORDER BY time) AS tempc
FROM mqtt_consumer
WHERE time >= 'epoch'::timestamptz + $1 * interval '1 microsecond'
  AND time < 'epoch'::timestamptz + $2 * interval '1 microsecond'
  AND (tempc IS NOT NULL OR hum IS NOT NULL)
  AND (cardinality($4::text[]) = 0 OR device_id = ANY($4))
GROUP BY brand, device_id, entity, integration_id, kind, mac, model, model_id,
         name, sensor_id, topic, type, window_start
"#;

/// The Flux query
///
/// ```text
/// from(bucket: "home") |> range(start: <range>)
///   |> filter(fn: (r) => r.device_id == ... or ...)
///   |> filter(fn: (r) => r._field == "tempc" or r._field == "hum")
///   |> aggregateWindow(every: <window>, fn: mean, createEmpty: false)
/// ```
///
/// over `mqtt_consumer`. Windows are aligned to the Unix epoch; a window's
/// `_time` is its end, cut to the range's stop.
pub(crate) async fn temp_sensors(
    pool: &PgPool,
    device_ids: &[String],
    range: FluxDuration,
    window: FluxDuration,
    stop: DateTime<Utc>,
) -> Result<Vec<Value>, String> {
    if window.months != 0 || window.micros <= 0 {
        return Err("window must be a positive fixed duration".to_string());
    }
    let start = range
        .add_to(stop)
        .ok_or_else(|| "range out of bounds".to_string())?;
    if start >= stop {
        return Ok(Vec::new());
    }

    let rows = with_timeout(
        sqlx::query(SENSOR_SQL)
            .bind(start.timestamp_micros())
            .bind(stop.timestamp_micros())
            .bind(window.micros)
            .bind(device_ids)
            .fetch_all(pool),
    )
    .await?;

    let (start_text, stop_text) = (format_time(start), format_time(stop));
    let mut out: Vec<(String, &str, i64, Value)> = Vec::new();
    for row in rows {
        let mut tags: Vec<(&str, String)> = Vec::new();
        for tag in MQTT_TAGS {
            let value: Option<String> = row.try_get(tag).map_err(|e| e.to_string())?;
            if let Some(value) = value {
                tags.push((tag, value));
            }
        }
        let key = series_key("mqtt_consumer", &tags);
        let window_start: i64 = row.try_get("window_start").map_err(|e| e.to_string())?;
        let time = micros_to_time(window_start.saturating_add(window.micros))?.min(stop);
        for field in SENSOR_FIELDS {
            let Some(mean) = row
                .try_get::<Option<f64>, _>(field)
                .map_err(|e| e.to_string())?
            else {
                continue;
            };
            let mut obj = Map::new();
            for (tag, value) in &tags {
                obj.insert((*tag).to_string(), Value::String(value.clone()));
            }
            obj.insert("_field".into(), Value::String(field.into()));
            obj.insert("_measurement".into(), Value::String("mqtt_consumer".into()));
            obj.insert("_start".into(), Value::String(start_text.clone()));
            obj.insert("_stop".into(), Value::String(stop_text.clone()));
            obj.insert("_time".into(), Value::String(format_time(time)));
            obj.insert("_value".into(), Value::String(format_value(mean)));
            out.push((key.clone(), field, window_start, Value::Object(obj)));
        }
    }
    out.sort_by(|a, b| (&a.0, a.1, a.2).cmp(&(&b.0, b.1, b.2)));
    Ok(out.into_iter().map(|(_, _, _, row)| row).collect())
}

const SPOT_PRICE_SQL: &str = r#"
SELECT id, (extract(epoch FROM time) * 1000000)::bigint AS time_us, price
FROM nordpool_price
WHERE time >= 'epoch'::timestamptz + $1 * interval '1 microsecond'
  AND time < 'epoch'::timestamptz + $2 * interval '1 microsecond'
  AND price IS NOT NULL
ORDER BY id, time
"#;

/// The Flux query
///
/// ```text
/// option location = timezone.location(name: "Europe/Helsinki")
/// from(bucket: "nordpool")
///   |> range(start: date.truncate(t: now(), unit: 1d), stop: 48h)
///   |> filter(fn: (r) => r._measurement == "price")
/// ```
///
/// over `nordpool_price`: today's and tomorrow's prices from Helsinki
/// midnight until 48 hours from now.
pub(crate) async fn spot_prices(pool: &PgPool, now: DateTime<Utc>) -> Result<Vec<Value>, String> {
    let midnight = now
        .with_timezone(&Helsinki)
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|local| Helsinki.from_local_datetime(&local).earliest())
        .ok_or_else(|| "no Helsinki midnight today".to_string())?
        .with_timezone(&Utc);
    let stop = now + chrono::Duration::hours(48);

    let rows = with_timeout(
        sqlx::query(SPOT_PRICE_SQL)
            .bind(midnight.timestamp_micros())
            .bind(stop.timestamp_micros())
            .fetch_all(pool),
    )
    .await?;

    let (start_text, stop_text) = (format_time(midnight), format_time(stop));
    rows.into_iter()
        .map(|row| {
            let id: String = row.try_get("id").map_err(|e| e.to_string())?;
            let time: i64 = row.try_get("time_us").map_err(|e| e.to_string())?;
            let price: f64 = row.try_get("price").map_err(|e| e.to_string())?;
            let mut obj = Map::new();
            obj.insert("_field".into(), Value::String("price".into()));
            obj.insert("_measurement".into(), Value::String("price".into()));
            obj.insert("_start".into(), Value::String(start_text.clone()));
            obj.insert("_stop".into(), Value::String(stop_text.clone()));
            obj.insert(
                "_time".into(),
                Value::String(format_time(micros_to_time(time)?)),
            );
            obj.insert("_value".into(), Value::String(format_value(price)));
            obj.insert("id".into(), Value::String(id));
            Ok(Value::Object(obj))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flux_durations() {
        let d = |months, micros| Some(FluxDuration { months, micros });
        assert_eq!(FluxDuration::parse("-6h"), d(0, -6 * 3_600_000_000));
        assert_eq!(FluxDuration::parse("10m"), d(0, 600_000_000));
        assert_eq!(FluxDuration::parse("-7d"), d(0, -7 * 86_400_000_000));
        assert_eq!(FluxDuration::parse("1h30m"), d(0, 5_400_000_000));
        assert_eq!(FluxDuration::parse("-1mo2w"), d(-1, -14 * 86_400_000_000));
        assert_eq!(FluxDuration::parse("1y"), d(12, 0));
        assert_eq!(FluxDuration::parse("1500ms"), d(0, 1_500_000));
        for bad in ["", "-", "h", "6", "6x", "6h-", "--6h", "6 h", "abc"] {
            assert_eq!(FluxDuration::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn formats_times_like_influxdb() {
        let t = |s: &str| DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc);
        assert_eq!(
            format_time(t("2026-10-31T09:10:00Z")),
            "2026-10-31T09:10:00Z"
        );
        assert_eq!(
            format_time(t("2026-10-31T15:08:33.333667Z")),
            "2026-10-31T15:08:33.333667Z"
        );
        assert_eq!(
            format_time(t("2026-10-31T15:08:33.5Z")),
            "2026-10-31T15:08:33.5Z"
        );
    }

    #[test]
    fn formats_values_like_influxdb() {
        assert_eq!(format_value(33.0), "33");
        assert_eq!(format_value(21.45), "21.45");
        assert_eq!(format_value(-2.5), "-2.5");
        assert_eq!(format_value(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(format_value(1e-7), "0.0000001");
    }

    #[test]
    fn series_keys_sort_like_influxdb() {
        let a = series_key(
            "mqtt_consumer",
            &[
                ("brand", "SwitchBot".into()),
                ("model", "Outdoor Meter".into()),
            ],
        );
        assert_eq!(a, "mqtt_consumer,brand=SwitchBot,model=Outdoor\\ Meter");
        let b = series_key("mqtt_consumer", &[("brand", "Xiaomi".into())]);
        let c = series_key("mqtt_consumer", &[("device_id", "A".into())]);
        assert!(a < b && b < c);
    }

    #[test]
    fn range_arithmetic_uses_utc_calendar() {
        let stop = DateTime::parse_from_rfc3339("2026-03-31T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let start = FluxDuration::parse("-1mo").unwrap().add_to(stop).unwrap();
        assert_eq!(format_time(start), "2026-02-28T12:00:00Z");
        let start = FluxDuration::parse("-7d").unwrap().add_to(stop).unwrap();
        assert_eq!(format_time(start), "2026-03-24T12:00:00Z");
    }
}
