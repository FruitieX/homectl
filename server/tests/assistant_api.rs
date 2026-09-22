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
use std::sync::{Arc, Mutex};
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
    request_headers: Arc<Mutex<Vec<String>>>,
}

impl MockProvider {
    fn start(responses: Vec<MockResponse>) -> Self {
        assert!(!responses.is_empty(), "mock provider needs a response");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = requests.clone();
        let request_headers = Arc::new(Mutex::new(Vec::new()));
        let headers_sink = request_headers.clone();

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
                let mut header_end = None;
                let mut content_length = 0usize;
                while let Ok(read) = stream.read(&mut chunk) {
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    if header_end.is_none() {
                        if let Some(position) = find_header_end(&buffer) {
                            let headers = String::from_utf8_lossy(&buffer[..position]);
                            headers_sink.lock().unwrap().push(headers.to_string());
                            content_length = headers
                                .lines()
                                .find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    name.eq_ignore_ascii_case("content-length")
                                        .then(|| value.trim().parse::<usize>().ok())
                                        .flatten()
                                })
                                .unwrap_or(0);
                            header_end = Some(position);
                        }
                    }
                    if let Some(position) = header_end {
                        if buffer.len() >= position + 4 + content_length {
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
            request_headers,
        }
    }

    fn request_headers(&self) -> Vec<String> {
        self.request_headers.lock().unwrap().clone()
    }

    fn header_value(&self, name: &str) -> Option<String> {
        self.request_headers().iter().find_map(|headers| {
            headers.lines().find_map(|line| {
                let (header, value) = line.split_once(':')?;
                header
                    .eq_ignore_ascii_case(name)
                    .then(|| value.trim().to_string())
            })
        })
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
    config["groups"] = json!([{
        "id": "hallway",
        "name": "Hallway",
        "hidden": false,
        "devices": [{"integration_id": "dummy", "device_id": "lamp"}],
        "linked_groups": []
    }]);
    config["scenes"] = json!([{
        "id": "evening",
        "name": "Evening",
        "hidden": false,
        "script": null,
        "device_states": {"dummy/lamp": {"power": true, "brightness": 0.4}},
        "group_states": {"hallway": {"power": true}},
        "group_state_order": ["hallway"]
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
    start_server_with_env(provider, Vec::new())
}

fn start_server_with_env(
    provider: Option<&MockProvider>,
    mut extra: Vec<(String, String)>,
) -> TestServer {
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

    extra_env.append(&mut extra);

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
    assert!(provider
        .header_value("user-agent")
        .unwrap()
        .starts_with("homectl-assistant/"));
    assert!(provider
        .header_value("x-opencode-session")
        .unwrap()
        .starts_with("homectl-"));
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

    let sessions: Vec<String> = provider
        .request_headers()
        .iter()
        .filter_map(|headers| {
            headers.lines().find_map(|line| {
                let (header, value) = line.split_once(':')?;
                header
                    .eq_ignore_ascii_case("x-opencode-session")
                    .then(|| value.trim().to_string())
            })
        })
        .collect();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0], sessions[1]);
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
fn assistant_drops_reasoning_effort_when_rejected() {
    let provider = MockProvider::start(vec![
        MockResponse::error(400, "unknown parameter: reasoning_effort"),
        MockResponse::error(400, "unknown parameter: reasoning_effort"),
        MockResponse::completion(&valid_draft()),
    ]);
    let server = start_server_with_env(
        Some(&provider),
        vec![(
            "HOMECTL_ASSISTANT_REASONING_EFFORT".to_string(),
            "high".to_string(),
        )],
    );
    let client = Client::new();

    let response = draft(&server.base_url, &client, "Hallway light on motion");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["data"]["attempts"], 1);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 3);
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

#[test]
fn assistant_settings_round_trip_masks_api_key() {
    let server = start_server(None);
    let client = Client::new();
    let base = &server.base_url;
    let settings_url = format!("{base}/api/v1/config/assistant/settings");

    let initial: Value = client.get(&settings_url).send().unwrap().json().unwrap();
    assert_eq!(initial["data"]["enabled"], false);
    assert_eq!(initial["data"]["apiKeySet"], false);
    assert_eq!(initial["data"]["maxTokens"], 2048);
    assert_eq!(initial["data"]["timeoutMs"], 60000);

    let updated: Value = client
        .put(&settings_url)
        .json(&json!({
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "mock-model",
            "apiKey": "sk-secret",
            "reasoningEffort": "high",
            "maxTokens": 4096,
            "timeoutMs": 30000,
            "timezone": "UTC"
        }))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(updated["success"], true);
    assert_eq!(updated["data"]["enabled"], true);
    assert_eq!(updated["data"]["apiKeySet"], true);
    assert_eq!(updated["data"]["reasoningEffort"], "high");
    assert_eq!(updated["data"]["maxTokens"], 4096);
    assert!(!updated.to_string().contains("sk-secret"));
    assert!(updated["data"].get("apiKey").is_none());

    let status: Value = client
        .get(format!("{base}/api/v1/config/assistant/status"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(status["data"]["enabled"], true);
    assert_eq!(status["data"]["model"], "mock-model");

    // Default exports redact the key; secret-inclusive backups carry it.
    let exported: Value = client
        .get(format!("{base}/api/v1/config/export"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let row = exported["data"]["widget_settings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["key"] == "assistant")
        .expect("assistant settings exported");
    assert!(row["config"].get("api_key").is_none());
    assert!(!exported.to_string().contains("sk-secret"));

    let backup: Value = client
        .get(format!("{base}/api/v1/config/export?include_secrets=true"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let row = backup["data"]["widget_settings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["key"] == "assistant")
        .expect("assistant settings exported");
    assert_eq!(row["config"]["api_key"], "sk-secret");

    // Importing a redacted export keeps the stored key.
    client
        .post(format!("{base}/api/v1/config/import"))
        .json(&exported["data"])
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let after: Value = client.get(&settings_url).send().unwrap().json().unwrap();
    assert_eq!(after["data"]["apiKeySet"], true);

    // An explicit empty key clears it.
    let cleared: Value = client
        .put(&settings_url)
        .json(&json!({ "apiKey": "" }))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(cleared["data"]["apiKeySet"], false);
    assert_eq!(cleared["data"]["enabled"], true);
}

#[test]
fn assistant_rejects_invalid_settings() {
    let server = start_server(None);
    let client = Client::new();
    let settings_url = format!("{}/api/v1/config/assistant/settings", server.base_url);

    for patch in [
        json!({ "reasoningEffort": "extreme" }),
        json!({ "timezone": "Mars/Olympus" }),
        json!({ "timeoutMs": 10 }),
        json!({ "maxTokens": 10_000_000 }),
    ] {
        let response = client.put(&settings_url).json(&patch).send().unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

#[test]
fn assistant_stored_settings_override_environment() {
    let env_provider = MockProvider::start(vec![MockResponse::completion(&valid_draft())]);
    let stored_provider = MockProvider::start(vec![MockResponse::completion(&valid_draft())]);
    let server = start_server(Some(&env_provider));
    let client = Client::new();

    client
        .put(format!(
            "{}/api/v1/config/assistant/settings",
            server.base_url
        ))
        .json(&json!({
            "baseUrl": stored_provider.base_url,
            "model": "stored-model"
        }))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();

    let status: Value = client
        .get(format!(
            "{}/api/v1/config/assistant/status",
            server.base_url
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(status["data"]["model"], "stored-model");

    let response = draft(&server.base_url, &client, "Hallway light on motion");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(env_provider.requests.load(Ordering::SeqCst), 0);
    assert_eq!(stored_provider.requests.load(Ordering::SeqCst), 1);
}

fn apply(
    base_url: &str,
    client: &Client,
    prompt: &str,
    device_keys: Option<Vec<&str>>,
) -> reqwest::blocking::Response {
    let mut body = json!({ "prompt": prompt });
    if let Some(keys) = device_keys {
        body["deviceKeys"] = json!(keys);
    }
    client
        .post(format!("{base_url}/api/v1/config/assistant/apply"))
        .json(&body)
        .send()
        .unwrap()
}

fn device_state(base_url: &str, client: &Client, integration_id: &str, device_id: &str) -> Value {
    let devices: Value = client
        .get(format!("{base_url}/api/v1/devices"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    devices["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|device| device["integration_id"] == integration_id && device["id"] == device_id)
        .cloned()
        .expect("device")
}

#[test]
fn assistant_applies_light_state_changes() {
    let content = json!({
        "summary": "Living room lamp set to tropical",
        "changes": [{
            "device_key": "dummy/lamp",
            "power": true,
            "brightness": 0.4,
            "color": {"h": 320, "s": 0.8}
        }]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = apply(
        &server.base_url,
        &client,
        "make the hallway lamp tropical",
        None,
    );
    assert_eq!(response.status(), StatusCode::OK);
    let result: Value = response.json().unwrap();
    assert_eq!(result["data"]["applied_count"], 1);
    assert_eq!(result["data"]["applied"][0]["device_key"], "dummy/lamp");
    assert_eq!(result["data"]["applied"][0]["ok"], true);
    assert_eq!(result["data"]["model"], "mock-model");

    let lamp = device_state(&server.base_url, &client, "dummy", "lamp");
    let state = &lamp["data"]["Controllable"]["state"];
    assert_eq!(state["power"], true);
    assert!((state["brightness"].as_f64().unwrap() - 0.4).abs() < 0.01);
    assert_eq!(state["color"]["h"], 320);
}

#[test]
fn assistant_apply_rejects_unknown_devices_and_reports_them() {
    let content = json!({
        "summary": "tried",
        "changes": [{"device_key": "dummy/ghost", "power": true}]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = apply(&server.base_url, &client, "turn on the ghost", None);
    assert_eq!(response.status(), StatusCode::OK);
    let result: Value = response.json().unwrap();
    assert_eq!(result["data"]["applied_count"], 0);
    assert_eq!(result["data"]["applied"][0]["ok"], false);
    assert_eq!(result["data"]["applied"][0]["error"], "Unknown device");

    let lamp = device_state(&server.base_url, &client, "dummy", "lamp");
    assert_eq!(lamp["data"]["Controllable"]["state"]["power"], false);
}

#[test]
fn assistant_apply_respects_the_requested_scope() {
    let content = json!({
        "summary": "scope escape",
        "changes": [{"device_key": "dummy/lamp", "power": true}]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = apply(
        &server.base_url,
        &client,
        "turn on the motion sensor",
        Some(vec!["dummy/motion"]),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let result: Value = response.json().unwrap();
    assert_eq!(result["data"]["applied"][0]["ok"], false);
    assert_eq!(result["data"]["applied"][0]["error"], "Unknown device");

    let lamp = device_state(&server.base_url, &client, "dummy", "lamp");
    assert_eq!(lamp["data"]["Controllable"]["state"]["power"], false);
}

#[test]
fn assistant_apply_rejects_invalid_provider_output() {
    let provider = MockProvider::start(vec![MockResponse::completion("not json at all")]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = apply(&server.base_url, &client, "do something", None);
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[test]
fn assistant_apply_is_disabled_without_configuration() {
    let server = start_server(None);
    let client = Client::new();

    let response = apply(&server.base_url, &client, "turn on the lamp", None);
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

// ============================================================================
// Configuration assistant plans
// ============================================================================

fn plan(base_url: &str, client: &Client, body: Value) -> reqwest::blocking::Response {
    client
        .post(format!("{base_url}/api/v1/config/assistant/plan"))
        .json(&body)
        .send()
        .unwrap()
}

fn get_plan(base_url: &str, client: &Client, plan_id: &str) -> reqwest::blocking::Response {
    client
        .get(format!(
            "{base_url}/api/v1/config/assistant/plans/{plan_id}"
        ))
        .send()
        .unwrap()
}

fn search(base_url: &str, client: &Client, query: &str) -> reqwest::blocking::Response {
    client
        .get(format!("{base_url}/api/v1/config/assistant/search?{query}"))
        .send()
        .unwrap()
}

fn valid_plan() -> String {
    json!({
        "summary": "Rename the hallway group",
        "operations": [{
            "op": "update",
            "kind": "group",
            "target_id": "hallway",
            "label": "Rename Hallway",
            "after": {"name": "Hallway Lights"}
        }]
    })
    .to_string()
}

#[test]
fn assistant_plan_produces_a_validated_plan() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_plan())]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({
            "prompt": "rename the hallway group to hallway lights",
            "attachments": [{"kind": "group", "id": "hallway", "label": "Hallway"}]
        }),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["success"], true);
    let data = &body["data"];
    assert!(data["planId"].as_str().unwrap().starts_with("plan-"));
    assert_eq!(data["summary"], "Rename the hallway group");
    assert_eq!(data["operations"][0]["opId"], "op-1");
    assert_eq!(data["operations"][0]["op"], "update");
    assert_eq!(data["operations"][0]["kind"], "group");
    assert_eq!(data["operations"][0]["targetId"], "hallway");
    assert_eq!(data["operations"][0]["after"]["name"], "Hallway Lights");
    // Updates carry the masked snapshot and the merged final state.
    assert_eq!(data["operations"][0]["before"]["name"], "Hallway");
    assert_eq!(
        data["operations"][0]["after"]["devices"][0]["device_id"],
        "lamp"
    );
    assert!(data["expiresAtMs"].as_i64().unwrap() > data["createdAtMs"].as_i64().unwrap());
    assert_eq!(provider.requests.load(Ordering::SeqCst), 1);

    // The plan is retrievable until it expires.
    let plan_id = data["planId"].as_str().unwrap();
    let stored = get_plan(&server.base_url, &client, plan_id);
    assert_eq!(stored.status(), StatusCode::OK);
    let stored: Value = stored.json().unwrap();
    assert_eq!(stored["data"]["planId"], plan_id);
}

#[test]
fn assistant_plan_rejects_unknown_targets() {
    let content = json!({
        "summary": "Delete a routine",
        "operations": [{
            "op": "delete",
            "kind": "routine",
            "target_id": "ghost",
            "label": "Ghost"
        }]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({"prompt": "delete the ghost routine"}),
    );
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body: Value = response.json().unwrap();
    assert_eq!(body["success"], false);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("unknown routine target 'ghost'"));
}

#[test]
fn assistant_plan_rejects_unknown_attachments_without_calling_the_provider() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_plan())]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({
            "prompt": "rename it",
            "attachments": [{"kind": "group", "id": "ghost"}]
        }),
    );
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body: Value = response.json().unwrap();
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("attached group 'ghost' was not found"));
    assert_eq!(provider.requests.load(Ordering::SeqCst), 0);
}

#[test]
fn assistant_plan_rejects_malformed_provider_output() {
    let provider = MockProvider::start(vec![MockResponse::completion("not json at all")]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = plan(&server.base_url, &client, json!({"prompt": "do something"}));
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body: Value = response.json().unwrap();
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("did not contain a JSON object"));
}

#[test]
fn assistant_plan_expires_from_the_store() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_plan())]);
    let server = start_server_with_env(
        Some(&provider),
        vec![("HOMECTL_ASSISTANT_PLAN_TTL_MS".to_string(), "1".to_string())],
    );
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({"prompt": "rename the hallway group to hallway lights"}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    let plan_id = body["data"]["planId"].as_str().unwrap().to_string();

    thread::sleep(std::time::Duration::from_millis(50));
    let expired = get_plan(&server.base_url, &client, &plan_id);
    assert_eq!(expired.status(), StatusCode::NOT_FOUND);
}

#[test]
fn assistant_plan_is_disabled_without_configuration() {
    let server = start_server(None);
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({"prompt": "create a morning routine"}),
    );
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn assistant_search_ranks_configured_entities() {
    let server = start_server(None);
    let client = Client::new();
    let base = &server.base_url;

    let groups: Value = search(base, &client, "kind=group&q=hall").json().unwrap();
    assert_eq!(groups["success"], true);
    assert_eq!(groups["data"][0]["kind"], "group");
    assert_eq!(groups["data"][0]["id"], "hallway");
    assert_eq!(groups["data"][0]["label"], "Hallway");
    assert!(groups["data"][0]["summary"]
        .as_str()
        .unwrap()
        .contains("group"));

    let scenes: Value = search(base, &client, "kind=scene&q=eve").json().unwrap();
    assert_eq!(scenes["data"][0]["id"], "evening");

    let all: Value = search(base, &client, "q=hall").json().unwrap();
    assert!(all["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|result| result["id"] == "hallway"));

    let none: Value = search(base, &client, "kind=routine&q=zzz").json().unwrap();
    assert_eq!(none["data"], json!([]));

    let response = search(base, &client, "kind=bogus&q=hall");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
