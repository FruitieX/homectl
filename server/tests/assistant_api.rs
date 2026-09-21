//! Integration tests for the opt-in assistant drafting endpoints.
//!
//! The tests spawn a tiny OpenAI-compatible mock provider on loopback and
//! point the server at it through the documented environment variables.

mod common;

use common::{TestServer, TestServerConfig};
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

struct MockResponse {
    status: u16,
    body: String,
}

impl MockResponse {
    fn completion(content: &str) -> Self {
        let body = json!({
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": { "role": "assistant", "content": content },
                "finish_reason": "stop"
            }]
        })
        .to_string();
        Self { status: 200, body }
    }

    fn error(status: u16, message: &str) -> Self {
        Self {
            status,
            body: json!({ "error": { "message": message } }).to_string(),
        }
    }
}

struct MockProvider {
    base_url: String,
    requests: Arc<AtomicUsize>,
}

impl MockProvider {
    fn start(responses: Vec<MockResponse>) -> Self {
        assert!(!responses.is_empty(), "mock provider needs a response");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = requests.clone();

        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let index = counter.fetch_add(1, Ordering::SeqCst);
                let response = responses
                    .get(index)
                    .or_else(|| responses.last())
                    .expect("response");

                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                while let Ok(read) = stream.read(&mut chunk) {
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    if let Some(header_end) = find_header_end(&buffer) {
                        let headers = String::from_utf8_lossy(&buffer[..header_end]);
                        let content_length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                            .unwrap_or(0);
                        if buffer.len() >= header_end + 4 + content_length {
                            break;
                        }
                    }
                }

                let reply = format!(
                    "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.body.len(),
                    response.body
                );
                let _ = stream.write_all(reply.as_bytes());
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}/v1"),
            requests,
        }
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn assistant_config() -> Value {
    let mut config = blank_backup_config();
    let lamp = json!({"Controllable": {
        "scene_id": null,
        "state_source": null,
        "capabilities": {"hs": true, "brightness": true},
        "state": {"power": false, "brightness": 0.5, "color": null, "transition": null},
        "managed": "Full"
    }});
    config["integrations"] = json!([{
        "id": "dummy",
        "plugin": "dummy",
        "enabled": true,
        "config": {"devices": {
            "lamp": {"name": "Hallway lamp", "init_state": lamp},
            "motion": {"name": "Hallway motion", "init_state": {"Sensor": {"value": false}}}
        }}
    }]);
    config
}

fn blank_backup_config() -> Value {
    json!({
        "version": 1,
        "core": { "warmup_time_seconds": 0 },
        "integrations": [],
        "groups": [],
        "scenes": [],
        "routines": [],
        "helpers": [],
        "helper_values": [],
        "sources": [],
        "floorplan": null,
        "floorplans": [],
        "group_positions": [],
        "device_display_overrides": [],
        "device_color_calibrations": [],
        "color_calibration_profiles": [],
        "color_calibration_assignments": [],
        "device_sensor_configs": [],
        "dashboard_layouts": [],
        "dashboard_widgets": [],
        "widget_settings": []
    })
}

fn start_server(provider: Option<&MockProvider>) -> TestServer {
    let mut extra_env = Vec::new();
    if let Some(provider) = provider {
        extra_env.push((
            "HOMECTL_ASSISTANT_BASE_URL".to_string(),
            provider.base_url.clone(),
        ));
        extra_env.push((
            "HOMECTL_ASSISTANT_MODEL".to_string(),
            "mock-model".to_string(),
        ));
        extra_env.push((
            "HOMECTL_ASSISTANT_API_KEY".to_string(),
            "test-key".to_string(),
        ));
        extra_env.push((
            "HOMECTL_ASSISTANT_TIMEOUT_MS".to_string(),
            "5000".to_string(),
        ));
    }

    TestServer::with_config(TestServerConfig {
        config_content: Some(assistant_config().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        extra_env,
        ..Default::default()
    })
    .expect("start test server")
}

fn valid_draft() -> String {
    json!({
        "name": "Hallway motion light",
        "definition": {
            "triggers": [{
                "kind": "state_change",
                "id": "t1",
                "device": {"integration_id": "dummy", "device_id": "motion"},
                "mode": "transition"
            }],
            "program": {
                "kind": "native",
                "steps": [{
                    "action": "set_power",
                    "id": "a1",
                    "device": {"integration_id": "dummy", "device_id": "lamp"},
                    "power": true
                }]
            }
        }
    })
    .to_string()
}

fn invalid_draft() -> String {
    json!({
        "name": "Broken",
        "definition": {
            "triggers": [{
                "kind": "state_change",
                "id": "t1",
                "device": {"integration_id": "dummy", "device_id": "missing"},
                "mode": "transition"
            }],
            "program": {"kind": "native", "steps": []}
        }
    })
    .to_string()
}

fn draft(base_url: &str, client: &Client, prompt: &str) -> reqwest::blocking::Response {
    client
        .post(format!("{base_url}/api/v1/config/assistant/draft"))
        .json(&json!({ "prompt": prompt }))
        .send()
        .unwrap()
}

#[test]
fn assistant_is_disabled_without_configuration() {
    let server = start_server(None);
    let client = Client::new();
    let base = &server.base_url;

    let status: Value = client
        .get(format!("{base}/api/v1/config/assistant/status"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(status["success"], true);
    assert_eq!(status["data"]["enabled"], false);

    let response = draft(base, &client, "Turn on the lamp when motion is detected");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

    let empty = client
        .post(format!("{base}/api/v1/config/assistant/draft"))
        .json(&json!({ "prompt": "   " }))
        .send()
        .unwrap();
    assert_eq!(empty.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn assistant_drafts_a_validated_definition() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_draft())]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let status: Value = client
        .get(format!("{base}/api/v1/config/assistant/status"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(status["data"]["enabled"], true);
    assert_eq!(status["data"]["model"], "mock-model");

    let response = draft(base, &client, "Turn on the lamp when motion is detected");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["name"], "Hallway motion light");
    assert_eq!(body["data"]["attempts"], 1);
    assert_eq!(
        body["data"]["definition"]["program"]["steps"][0]["action"],
        "set_power"
    );
    assert_eq!(provider.requests.load(Ordering::SeqCst), 1);
}

#[test]
fn assistant_repairs_an_invalid_draft() {
    let provider = MockProvider::start(vec![
        MockResponse::completion(&invalid_draft()),
        MockResponse::completion(&valid_draft()),
    ]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = draft(&server.base_url, &client, "Hallway light on motion");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["data"]["attempts"], 2);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 2);
}

#[test]
fn assistant_fails_after_exhausting_repairs() {
    let provider = MockProvider::start(vec![
        MockResponse::completion(&invalid_draft()),
        MockResponse::completion(&invalid_draft()),
    ]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = draft(&server.base_url, &client, "Hallway light on motion");
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body: Value = response.json().unwrap();
    assert_eq!(body["success"], false);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("could not produce a valid definition"));
    assert_eq!(provider.requests.load(Ordering::SeqCst), 2);
}

#[test]
fn assistant_retries_without_json_mode_when_rejected() {
    let provider = MockProvider::start(vec![
        MockResponse::error(400, "response_format is not supported"),
        MockResponse::completion(&valid_draft()),
    ]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = draft(&server.base_url, &client, "Hallway light on motion");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["data"]["attempts"], 1);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 2);
}

#[test]
fn assistant_rejects_an_empty_prompt_when_enabled() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_draft())]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = draft(&server.base_url, &client, "   ");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 0);
}

#[test]
fn assistant_reports_provider_failures() {
    let provider = MockProvider::start(vec![MockResponse::error(500, "boom")]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = draft(&server.base_url, &client, "Hallway light on motion");
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 1);
}
