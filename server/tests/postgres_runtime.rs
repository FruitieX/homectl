mod common;

use common::{TestServer, TestServerConfig};
use homectl_server::core::simulate::prepare_simulation_config;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::Value;
use sqlx::migrate::MigrateDatabase;
use sqlx::postgres::PgPoolOptions;
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};
use testcontainers::core::IntoContainerPort;
use testcontainers::runners::SyncRunner;
use testcontainers::ImageExt;
use testcontainers_modules::postgres::Postgres;

fn get_json(base_url: &str, path: &str) -> Value {
    reqwest::blocking::get(format!("{base_url}{path}"))
        .unwrap_or_else(|e| panic!("GET {path} failed: {e}"))
        .json()
        .unwrap_or_else(|e| panic!("GET {path} response parse failed: {e}"))
}

fn post_json(base_url: &str, path: &str, body: &Value) -> reqwest::blocking::Response {
    Client::new()
        .post(format!("{base_url}{path}"))
        .json(body)
        .send()
        .unwrap_or_else(|e| panic!("POST {path} failed: {e}"))
}

fn wait_for(description: &str, timeout: Duration, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;

    loop {
        if condition() {
            return;
        }

        if Instant::now() >= deadline {
            panic!("Timed out waiting for {description}");
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn reserve_host_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("should reserve a local TCP port");
    let port = listener
        .local_addr()
        .expect("reserved socket should have a local address")
        .port();
    drop(listener);
    port
}

fn floorplan_exists_in_postgres(database_url: &str, floorplan_id: &str) -> bool {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should start");

    runtime.block_on(async {
        let pool = PgPoolOptions::new()
            .connect(database_url)
            .await
            .expect("should connect to postgres");

        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM floorplans WHERE id = $1)")
                .bind(floorplan_id)
                .fetch_one(&pool)
                .await
                .expect("should query floorplans from postgres");

        pool.close().await;
        exists
    })
}

fn database_exists(database_url: &str) -> bool {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should start");

    runtime.block_on(async {
        sqlx::Postgres::database_exists(database_url)
            .await
            .expect("should check postgres database existence")
    })
}

#[test]
fn postgres_runtime_creates_missing_database_automatically() {
    let container = Postgres::default().start().expect("postgres should start");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should be mapped");
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{port}/homectl");

    assert!(!database_exists(&database_url));

    let server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url.clone()),
        ..Default::default()
    })
    .expect("failed to start postgres-backed server with missing database");

    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], true);
    assert_eq!(runtime_status["data"]["memory_only_mode"], false);
    assert!(database_exists(&database_url));
}

#[test]
fn postgres_runtime_persists_config_across_restarts() {
    let container = Postgres::default().start().expect("postgres should start");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should be mapped");
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let mut server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url.clone()),
        ..Default::default()
    })
    .expect("failed to start postgres-backed server");

    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], true);
    assert_eq!(runtime_status["data"]["memory_only_mode"], false);

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &serde_json::json!({
            "id": "persisted-postgres",
            "name": "Persisted Postgres"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    server.stop();

    let server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url),
        ..Default::default()
    })
    .expect("failed to restart postgres-backed server");

    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], true);

    let floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(floorplans["success"], true);
    assert!(floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "persisted-postgres" && floorplan["name"] == "Persisted Postgres"
        }));
}

#[test]
fn postgres_runtime_reconnects_and_backfills_memory_state() {
    let host_port = reserve_host_port();
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{host_port}/postgres");

    let mut server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url.clone()),
        ..Default::default()
    })
    .expect("failed to start server with unavailable postgres configured");

    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], false);
    assert_eq!(runtime_status["data"]["memory_only_mode"], true);

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &serde_json::json!({
            "id": "late-postgres",
            "name": "Late Postgres"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    let _container = Postgres::default()
        .with_mapped_port(host_port, 5432.tcp())
        .start()
        .expect("postgres should start on reserved host port");

    wait_for(
        "background postgres reconnect",
        Duration::from_secs(20),
        || {
            let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
            runtime_status["success"] == true
                && runtime_status["data"]["persistence_available"] == true
                && runtime_status["data"]["memory_only_mode"] == false
        },
    );

    let live_floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert!(live_floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "late-postgres" && floorplan["name"] == "Late Postgres"
        }));

    wait_for(
        "memory snapshot backfill into postgres",
        Duration::from_secs(20),
        || floorplan_exists_in_postgres(&database_url, "late-postgres"),
    );

    server.stop();

    let server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url),
        ..Default::default()
    })
    .expect("failed to restart postgres-backed server after reconnect");

    let floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(floorplans["success"], true);
    assert!(floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "late-postgres" && floorplan["name"] == "Late Postgres"
        }));
}

#[test]
fn postgres_runtime_ignores_external_config_changes_while_running() {
    let container = Postgres::default().start().expect("postgres should start");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should be mapped");
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url.clone()),
        ..Default::default()
    })
    .expect("failed to start postgres-backed server");

    let initial_response = get_json(&server.base_url, "/api/v1/config/core");
    assert_eq!(initial_response["success"], true);
    let initial_warmup_time = initial_response["data"]["warmup_time_seconds"]
        .as_i64()
        .expect("warmup time should be an integer");

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should start");
    runtime.block_on(async {
        let pool = PgPoolOptions::new()
            .connect(&database_url)
            .await
            .expect("should connect to postgres");

        sqlx::query(
            "UPDATE core_config SET warmup_time_seconds = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        )
        .bind(42_i32)
        .execute(&pool)
        .await
        .expect("should update core config directly in postgres");
    });

    thread::sleep(Duration::from_secs(3));

    let response = get_json(&server.base_url, "/api/v1/config/core");
    assert_eq!(response["success"], true);
    assert_eq!(
        response["data"]["warmup_time_seconds"].as_i64(),
        Some(initial_warmup_time)
    );
    assert_ne!(response["data"]["warmup_time_seconds"].as_i64(), Some(42));
}

#[test]
fn simulation_prepare_config_accepts_postgres_source_database() {
    let container = Postgres::default().start().expect("postgres should start");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should be mapped");
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let mut server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url.clone()),
        ..Default::default()
    })
    .expect("failed to start postgres-backed server for simulation export");

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/integrations",
        &serde_json::json!({
            "id": "dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {
                "devices": {}
            }
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    server.stop();

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should start");
    let config = runtime
        .block_on(async { prepare_simulation_config(Some(&database_url), None).await })
        .expect("simulation config export from postgres should succeed");

    assert!(!config.integrations.is_empty());
    assert!(config
        .integrations
        .iter()
        .any(|integration| integration.id == "dummy"));
}
