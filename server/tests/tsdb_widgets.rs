//! The sensor history and spot price widgets read TimescaleDB when `TSDB_URL`
//! is set. Plain PostgreSQL stands in for it: the queries only use core SQL
//! (`date_bin`, ordered aggregates) on tables in Telegraf's layout.

mod common;
mod postgres_container;

use common::{TestServer, TestServerConfig};
use serde_json::Value;
use sqlx::{Connection, PgConnection, Row};
use testcontainers::runners::SyncRunner;

fn get_json(base_url: &str, path: &str) -> Value {
    let response = reqwest::blocking::get(format!("{base_url}{path}"))
        .unwrap_or_else(|e| panic!("GET {path} failed: {e}"));
    assert!(
        response.status().is_success(),
        "GET {path}: {}",
        response.status()
    );
    response
        .json()
        .unwrap_or_else(|e| panic!("GET {path} response parse failed: {e}"))
}

/// Times the fixture used, as InfluxDB formats them.
struct Fixture {
    /// End of the 10-minute window holding the sensor points.
    window_end: String,
    /// Helsinki midnight today.
    midnight: String,
    first_hour: String,
}

const SEED: &str = r#"
CREATE TABLE mqtt_consumer (
  time timestamptz NOT NULL, kind text, integration_id text, device_id text, topic text,
  name text, entity text, mac text, brand text, model text, model_id text, type text,
  sensor_id text, tempc double precision, hum double precision, batt bigint);
CREATE TABLE nordpool_price (time timestamptz NOT NULL, id text NOT NULL, price double precision);

CREATE TEMP TABLE t AS
  SELECT date_bin('10 minutes', now() - interval '2 hours', 'epoch'::timestamptz) AS w,
         date_trunc('day', now(), 'Europe/Helsinki') AS midnight;

INSERT INTO mqtt_consumer (time, kind, integration_id, device_id, brand, model, tempc, hum, batt)
SELECT w + o, 'sensors', i, d, b, m, tc, h, bt FROM t, (VALUES
  (interval '1 minute', 'ble3', 'AA', 'SwitchBot', 'Outdoor Meter', 20.0, 40.0, NULL::bigint),
  (interval '2 minutes', 'ble3', 'AA', 'SwitchBot', 'Outdoor Meter', 21.0, NULL, NULL),
  (interval '3 minutes', 'ble3', 'AA', 'SwitchBot', 'Outdoor Meter', NULL, 43.0, NULL),
  (interval '4 minutes', 'ble3', 'AA', 'SwitchBot', 'Outdoor Meter', NULL, NULL, 90),
  (interval '1 minute', 'ble4', 'AA', 'SwitchBot', 'Outdoor Meter', 19.25, NULL, NULL),
  (interval '1 minute', 'ble3', 'CC', 'Xiaomi', NULL, 0.1, NULL, NULL),
  (interval '2 minutes', 'ble3', 'CC', 'Xiaomi', NULL, 0.2, NULL, NULL),
  (interval '1 minute', 'ble3', 'BB', NULL, NULL, 18.0, NULL, NULL),
  (interval '-4 hours -20 minutes', 'ble3', 'BB', NULL, NULL, 5.0, NULL, NULL)
) AS v (o, i, d, b, m, tc, h, bt);

INSERT INTO nordpool_price (time, id, price)
SELECT midnight + o, 'price', p FROM t, LATERAL (VALUES
  (interval '-1 hour', 9.0), (interval '0 hours', 10.5), (interval '1 hour', -0.25),
  (now() - midnight + interval '49 hours', 99.0)
) AS v (o, p);
"#;

fn seed(database_url: &str) -> Fixture {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should start");
    runtime.block_on(async {
        let mut db = PgConnection::connect(database_url)
            .await
            .expect("should connect to postgres");
        sqlx::raw_sql(SEED)
            .execute(&mut db)
            .await
            .expect("should seed tables");
        let row = sqlx::query(
            "SELECT to_char((w + interval '10 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
                    to_char(midnight AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
                    to_char((midnight + interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             FROM t",
        )
        .fetch_one(&mut db)
        .await
        .expect("should read fixture times");
        Fixture {
            window_end: row.get(0),
            midnight: row.get(1),
            first_hour: row.get(2),
        }
    })
}

/// (device_id, integration_id, _field, _time, _value) of each row, in order.
fn summary(rows: &Value) -> Vec<(String, String, String, String, String)> {
    rows.as_array()
        .expect("rows should be an array")
        .iter()
        .map(|row| {
            let s = |key: &str| row[key].as_str().unwrap_or_default().to_string();
            (
                s("device_id"),
                s("integration_id"),
                s("_field"),
                s("_time"),
                s("_value"),
            )
        })
        .collect()
}

#[test]
fn widgets_read_timescaledb_when_configured() {
    let container = postgres_container::postgres()
        .start()
        .expect("postgres should start");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should be mapped");
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let fixture = seed(&database_url);

    let server = TestServer::with_config(TestServerConfig {
        extra_env: vec![("TSDB_URL".into(), database_url)],
        ..Default::default()
    })
    .expect("failed to start server");

    // aggregateWindow(every: 10m, fn: mean) over the last 6 hours: rows in
    // InfluxDB's series key order (tags sorted by key, then field).
    let rows = get_json(&server.base_url, "/api/influxdb/temp-sensors");
    let w = fixture.window_end.clone();
    let row = |d: &str, i: &str, f: &str, v: &str| {
        (d.into(), i.into(), f.into(), w.clone(), v.to_string())
    };
    assert_eq!(
        summary(&rows),
        vec![
            row("AA", "ble3", "hum", "41.5"),
            row("AA", "ble3", "tempc", "20.5"),
            row("AA", "ble4", "tempc", "19.25"),
            row("CC", "ble3", "tempc", "0.15000000000000002"),
            row("BB", "ble3", "tempc", "18"),
        ]
    );
    let first = &rows[0];
    assert_eq!(first["_measurement"], "mqtt_consumer");
    assert_eq!(first["brand"], "SwitchBot");
    assert_eq!(first["model"], "Outdoor Meter");
    assert_eq!(first["kind"], "sensors");
    assert!(first.get("name").is_none(), "absent tags are omitted");
    assert!(first.get("batt").is_none());
    let start = first["_start"].as_str().unwrap();
    let stop = first["_stop"].as_str().unwrap();
    assert!(
        start < w.as_str() && w.as_str() < stop,
        "{start} {w} {stop}"
    );

    let rows = get_json(
        &server.base_url,
        "/api/influxdb/temp-sensors?device_ids=BB&range=-7h&window=1h",
    );
    let values: Vec<_> = summary(&rows).into_iter().map(|row| row.4).collect();
    assert_eq!(values, vec!["5", "18"]);

    let response = reqwest::blocking::get(format!(
        "{}/api/influxdb/temp-sensors?window=1mo",
        server.base_url
    ))
    .expect("request should complete");
    assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);

    // Today's and tomorrow's prices from Helsinki midnight.
    let rows = get_json(&server.base_url, "/api/influxdb/spot-prices");
    let prices: Vec<_> = rows
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            assert_eq!(row["_start"], fixture.midnight.as_str());
            assert_eq!(row["_field"], "price");
            assert_eq!(row["_measurement"], "price");
            assert_eq!(row["id"], "price");
            (
                row["_time"].as_str().unwrap().to_string(),
                row["_value"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(
        prices,
        vec![
            (fixture.midnight.clone(), "10.5".to_string()),
            (fixture.first_hour.clone(), "-0.25".to_string()),
        ]
    );
}
