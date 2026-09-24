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
use std::time::{SystemTime, UNIX_EPOCH};

struct MockResponse {
    status: u16,
    content_type: &'static str,
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
            }],
            "usage": {
                "prompt_tokens": 42,
                "completion_tokens": 7,
                "total_tokens": 49
            }
        })
        .to_string();
        Self {
            status: 200,
            content_type: "application/json",
            body,
        }
    }

    /// OpenAI-compatible SSE completion: the content arrives in two deltas and
    /// the usage chunk closes the stream.
    fn completion_stream(content: &str) -> Self {
        let split = content
            .char_indices()
            .map(|(index, _)| index)
            .find(|index| *index >= content.len() / 2)
            .unwrap_or(content.len());
        let body = format!(
            "data: {}\n\ndata: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices": [{"index": 0, "delta": {"content": &content[..split]}}]}),
            json!({"choices": [{"index": 0, "delta": {"content": &content[split..]}}]}),
            json!({
                "choices": [],
                "usage": {"prompt_tokens": 42, "completion_tokens": 7, "total_tokens": 49}
            }),
        );
        Self {
            status: 200,
            content_type: "text/event-stream",
            body,
        }
    }

    fn error(status: u16, message: &str) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: json!({ "error": { "message": message } }).to_string(),
        }
    }
}

struct MockProvider {
    base_url: String,
    requests: Arc<AtomicUsize>,
    request_headers: Arc<Mutex<Vec<String>>>,
    request_bodies: Arc<Mutex<Vec<String>>>,
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
        let request_bodies = Arc::new(Mutex::new(Vec::new()));
        let bodies_sink = request_bodies.clone();

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

                if let Some(position) = header_end {
                    let body = buffer
                        .get(position + 4..position + 4 + content_length)
                        .unwrap_or_default();
                    bodies_sink
                        .lock()
                        .unwrap()
                        .push(String::from_utf8_lossy(body).to_string());
                }

                let reply = format!(
                    "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.content_type,
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
            request_bodies,
        }
    }

    fn request_headers(&self) -> Vec<String> {
        self.request_headers.lock().unwrap().clone()
    }

    fn request_bodies(&self) -> Vec<String> {
        self.request_bodies.lock().unwrap().clone()
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
    config["integrations"] = json!([
        {
            "id": "dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {"devices": {
                "lamp": {"name": "Hallway lamp", "init_state": lamp},
                "motion": {"name": "Hallway motion", "init_state": {"Sensor": {"value": false}}}
            }}
        },
        {
            "id": "mqtt_main",
            "plugin": "mqtt",
            "enabled": false,
            "config": {"host": "mqtt.local", "port": 1883, "password": "hunter2"}
        }
    ]);
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
    // One response per allowed attempt: the draft path is capped at three.
    let provider = MockProvider::start(vec![
        MockResponse::completion(&invalid_draft()),
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
    assert_eq!(provider.requests.load(Ordering::SeqCst), 3);
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
    assert!(data["createdAtMs"].as_i64().unwrap() > 0);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 1);

    // The plan is retrievable for as long as the server runs.
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
fn assistant_plan_stays_reviewable_without_a_timer() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_plan())]);
    let server = start_server_with_env(Some(&provider), vec![]);
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({"prompt": "rename the hallway group to hallway lights"}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    let plan_id = body["data"]["planId"].as_str().unwrap().to_string();

    // Proposals do not expire: the plan stays applicable until it is applied,
    // discarded, or the server process restarts.
    thread::sleep(std::time::Duration::from_millis(50));
    let stored = get_plan(&server.base_url, &client, &plan_id);
    assert_eq!(stored.status(), StatusCode::OK);
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

    let integrations: Value = search(base, &client, "kind=integration&q=mqtt")
        .json()
        .unwrap();
    assert_eq!(integrations["data"][0]["id"], "mqtt_main");
    assert!(integrations["data"][0]["summary"]
        .as_str()
        .unwrap()
        .contains("mqtt"));

    let devices: Value = search(base, &client, "kind=device&q=lamp").json().unwrap();
    assert_eq!(devices["data"][0]["id"], "dummy/lamp");

    let floorplans: Value = search(base, &client, "kind=floorplan&q=default")
        .json()
        .unwrap();
    assert_eq!(floorplans["data"][0]["id"], "default");

    let response = search(base, &client, "kind=bogus&q=hall");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ============================================================================
// Configuration assistant plan apply
// ============================================================================

fn apply_plan(
    base_url: &str,
    client: &Client,
    plan_id: &str,
    accepted: &[&str],
) -> reqwest::blocking::Response {
    client
        .post(format!(
            "{base_url}/api/v1/config/assistant/plans/{plan_id}/apply"
        ))
        .json(&json!({ "acceptedOperationIds": accepted }))
        .send()
        .unwrap()
}

fn create_plan(base_url: &str, client: &Client, body: Value) -> (String, Value) {
    let response = plan(base_url, client, body);
    assert_eq!(response.status(), StatusCode::OK);
    let data = response.json::<Value>().unwrap()["data"].clone();
    let plan_id = data["planId"].as_str().unwrap().to_string();
    (plan_id, data)
}

fn stored_config(base_url: &str, client: &Client) -> Value {
    client
        .get(format!("{base_url}/api/v1/config/export"))
        .send()
        .unwrap()
        .json::<Value>()
        .unwrap()["data"]
        .clone()
}

fn v2_routine_definition() -> Value {
    json!({
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
    })
}

#[test]
fn assistant_plan_apply_executes_operations_in_dependency_order() {
    let content = json!({
        "summary": "Apply a mixed plan",
        "operations": [
            {
                "op": "create",
                "kind": "routine",
                "label": "Create morning routine",
                "after": {
                    "id": "morning",
                    "name": "Morning",
                    "enabled": true,
                    "semantics_version": 2,
                    "definition_v2": v2_routine_definition()
                }
            },
            {
                "op": "delete",
                "kind": "group",
                "target_id": "hallway",
                "label": "Delete hallway"
            },
            {
                "op": "update",
                "kind": "scene",
                "target_id": "evening",
                "label": "Rename evening",
                "after": {"name": "Evening Lights"}
            },
            {
                "op": "update",
                "kind": "device",
                "target_id": "dummy/lamp",
                "label": "Rename lamp",
                "after": {"display_name": "Hallway Lamp"}
            },
            {
                "op": "create",
                "kind": "helper",
                "label": "Create night mode helper",
                "after": {
                    "id": "night_mode",
                    "name": "Night mode",
                    "kind": {"kind": "boolean"},
                    "initial_value": false
                }
            }
        ]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let (plan_id, data) = create_plan(
        base,
        &client,
        json!({"prompt": "set up a morning routine and tidy the hallway"}),
    );
    let op_ids: Vec<&str> = data["operations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|operation| operation["opId"].as_str().unwrap())
        .collect();
    assert_eq!(op_ids, ["op-1", "op-2", "op-3", "op-4", "op-5"]);

    let response = apply_plan(base, &client, &plan_id, &op_ids);
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    let results = body["data"]["results"].as_array().unwrap();
    assert_eq!(results.len(), 5);
    assert!(
        results.iter().all(|result| result["ok"] == true),
        "{results:?}"
    );
    // Creates run first (helper before routine), then updates, then deletes.
    let result_order: Vec<&str> = results
        .iter()
        .map(|result| result["opId"].as_str().unwrap())
        .collect();
    assert_eq!(result_order, ["op-5", "op-1", "op-4", "op-3", "op-2"]);

    let config = stored_config(base, &client);
    assert!(config["routines"]
        .as_array()
        .unwrap()
        .iter()
        .any(|routine| routine["id"] == "morning" && routine["enabled"] == true));
    assert!(config["helpers"]
        .as_array()
        .unwrap()
        .iter()
        .any(|helper| helper["id"] == "night_mode"));
    assert!(config["scenes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|scene| scene["id"] == "evening" && scene["name"] == "Evening Lights"));
    assert!(!config["groups"]
        .as_array()
        .unwrap()
        .iter()
        .any(|group| group["id"] == "hallway"));
    assert!(config["device_display_overrides"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["device_key"] == "dummy/lamp" && row["display_name"] == "Hallway Lamp"));

    // The plan stays in the store, so the same proposal can be applied again.
    let replayed = get_plan(base, &client, &plan_id);
    assert_eq!(replayed.status(), StatusCode::OK);
    assert_eq!(replayed.json::<Value>().unwrap()["data"]["planId"], plan_id);
}

#[test]
fn assistant_plan_apply_skips_unaccepted_operations() {
    let content = json!({
        "summary": "Delete a group and rename a scene",
        "operations": [
            {
                "op": "delete",
                "kind": "group",
                "target_id": "hallway",
                "label": "Delete hallway"
            },
            {
                "op": "update",
                "kind": "scene",
                "target_id": "evening",
                "label": "Rename evening",
                "after": {"name": "Dusk"}
            }
        ]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let (plan_id, _) = create_plan(
        base,
        &client,
        json!({"prompt": "delete the hallway group and rename the evening scene"}),
    );

    // Only the scene update is accepted; the group delete is rejected by
    // omission and must leave state untouched.
    let response = apply_plan(base, &client, &plan_id, &["op-2"]);
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    let results = body["data"]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["opId"], "op-2");
    assert_eq!(results[0]["ok"], true);

    let config = stored_config(base, &client);
    assert!(config["groups"]
        .as_array()
        .unwrap()
        .iter()
        .any(|group| group["id"] == "hallway"));
    assert!(config["scenes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|scene| scene["id"] == "evening" && scene["name"] == "Dusk"));

    // Applying does not consume the plan, even when only some operations were
    // accepted: the same proposal can be applied again.
    assert_eq!(get_plan(base, &client, &plan_id).status(), StatusCode::OK);
}

#[test]
fn assistant_plan_apply_reports_revalidation_failures_per_operation() {
    let content = json!({
        "summary": "Delete the hallway group",
        "operations": [{
            "op": "delete",
            "kind": "group",
            "target_id": "hallway",
            "label": "Delete hallway"
        }]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let (plan_id, _) = create_plan(base, &client, json!({"prompt": "delete the hallway group"}));

    // The target disappears between review and apply.
    let deleted = client
        .delete(format!("{base}/api/v1/config/groups/hallway"))
        .send()
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);

    let response = apply_plan(base, &client, &plan_id, &["op-1"]);
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    let results = body["data"]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["ok"], false);
    assert!(results[0]["error"]
        .as_str()
        .unwrap()
        .contains("unknown group target"));
}

#[test]
fn assistant_plan_apply_rejects_empty_acceptance() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_plan())]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let (plan_id, _) = create_plan(base, &client, json!({"prompt": "rename the group"}));

    let response = apply_plan(base, &client, &plan_id, &[]);
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // The request was rejected before execution, so the plan is still there.
    assert_eq!(get_plan(base, &client, &plan_id).status(), StatusCode::OK);
}

#[test]
fn assistant_plan_apply_is_not_found_for_unknown_plans() {
    let server = start_server(None);
    let client = Client::new();

    let response = apply_plan(&server.base_url, &client, "plan-ghost", &["op-1"]);
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

fn discard_plan(base_url: &str, client: &Client, plan_id: &str) -> reqwest::blocking::Response {
    client
        .delete(format!(
            "{base_url}/api/v1/config/assistant/plans/{plan_id}"
        ))
        .send()
        .unwrap()
}

#[test]
fn assistant_plan_discard_removes_the_plan() {
    let provider = MockProvider::start(vec![MockResponse::completion(&valid_plan())]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let (plan_id, _) = create_plan(base, &client, json!({"prompt": "rename the hallway group"}));

    let response = discard_plan(base, &client, &plan_id);
    assert_eq!(response.status(), StatusCode::OK);

    assert_eq!(
        get_plan(base, &client, &plan_id).status(),
        StatusCode::NOT_FOUND
    );
    // Discarding is idempotent: a second call is a clean not-found.
    assert_eq!(
        discard_plan(base, &client, &plan_id).status(),
        StatusCode::NOT_FOUND
    );
    // A discarded plan can no longer be applied.
    assert_eq!(
        apply_plan(base, &client, &plan_id, &["op-1"]).status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn assistant_plan_masks_integration_secrets_and_keeps_them_on_apply() {
    let content = json!({
        "summary": "Point the broker elsewhere",
        "operations": [{
            "op": "update",
            "kind": "integration",
            "target_id": "mqtt_main",
            "label": "Update MQTT",
            "after": {"config": {"host": "mqtt.example.org"}}
        }]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();
    let base = &server.base_url;

    let (plan_id, data) = create_plan(
        base,
        &client,
        json!({
            "prompt": "point the mqtt broker at mqtt.example.org",
            "attachments": [{"kind": "integration", "id": "mqtt_main"}]
        }),
    );

    let operation = &data["operations"][0];
    assert!(operation["before"]["config"].get("password").is_none());
    assert!(operation["after"]["config"].get("password").is_none());
    assert_eq!(operation["after"]["config"]["host"], "mqtt.example.org");
    assert_eq!(operation["after"]["config"]["port"], 1883);
    assert!(!data.to_string().contains("hunter2"));

    // The provider prompt context must not carry the secret either.
    let provider_bodies = provider.request_bodies().join("\n");
    assert!(provider_bodies.contains("mqtt_main"));
    assert!(provider_bodies.contains("mqtt.local"));
    assert!(!provider_bodies.contains("hunter2"));

    // Applying the reviewed body keeps the stored secret it omitted.
    let response = apply_plan(base, &client, &plan_id, &["op-1"]);
    assert_eq!(response.status(), StatusCode::OK);
    let text = response.text().unwrap();
    assert!(!text.contains("hunter2"), "{text}");

    let integration: Value = client
        .get(format!("{base}/api/v1/config/integrations/mqtt_main"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(integration["data"]["config"]["password"], "hunter2");
    assert_eq!(integration["data"]["config"]["host"], "mqtt.example.org");
    assert_eq!(integration["data"]["config"]["port"], 1883);
}

#[test]
fn assistant_plan_repairs_invalid_output() {
    let invalid = json!({
        "summary": "Delete a routine",
        "operations": [{
            "op": "delete",
            "kind": "routine",
            "target_id": "ghost",
            "label": "Ghost"
        }]
    })
    .to_string();
    let provider = MockProvider::start(vec![
        MockResponse::completion(&invalid),
        MockResponse::completion(&valid_plan()),
    ]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = plan(
        &server.base_url,
        &client,
        json!({"prompt": "rename the hallway group"}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["operations"][0]["op"], "update");
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

// ============================================================================
// Unified streaming chat
// ============================================================================

fn chat(base_url: &str, client: &Client, body: Value) -> reqwest::blocking::Response {
    client
        .post(format!("{base_url}/api/v1/config/assistant/chat"))
        .json(&body)
        .send()
        .unwrap()
}

/// Extract the JSON payload of the first SSE event with the given name.
fn sse_event_data(body: &str, event: &str) -> Option<Value> {
    sse_event_datas(body, event).into_iter().next()
}

/// Extract the JSON payloads of every SSE event with the given name.
fn sse_event_datas(body: &str, event: &str) -> Vec<Value> {
    let mut payloads = Vec::new();
    let mut lines = body.lines();
    while let Some(line) = lines.next() {
        if line == format!("event: {event}") {
            let Some(data) = lines.next() else { break };
            let data = data.strip_prefix("data: ").unwrap_or(data);
            if let Ok(value) = serde_json::from_str(data) {
                payloads.push(value);
            }
        }
    }
    payloads
}

fn messages_from_request(body: &str) -> Vec<Value> {
    let parsed: Value = serde_json::from_str(body).expect("provider request body");
    parsed["messages"].as_array().cloned().unwrap_or_default()
}

#[test]
fn assistant_chat_streams_deltas_and_returns_a_plan() {
    let provider = MockProvider::start(vec![MockResponse::completion_stream(&valid_plan())]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "rename the hallway group to hallway lights"}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .contains("text/event-stream"));
    let body = response.text().unwrap();

    assert_eq!(sse_event_data(&body, "status").unwrap()["phase"], "context");
    // The provider content arrived in deltas that only parse once reassembled.
    let deltas = sse_event_datas(&body, "delta");
    assert!(deltas.len() >= 2);
    let streamed: String = deltas
        .iter()
        .filter_map(|delta| delta["text"].as_str())
        .collect();
    let streamed: Value = serde_json::from_str(&streamed).expect("streamed JSON");
    assert_eq!(streamed["summary"], "Rename the hallway group");
    let usage = sse_event_data(&body, "usage").unwrap();
    assert_eq!(usage["promptTokens"], 42);
    assert_eq!(usage["totalTokens"], 49);
    assert_eq!(usage["approximate"], false);
    assert!(usage["contextWindow"].as_u64().unwrap() > 0);

    let plan = sse_event_data(&body, "plan").unwrap();
    assert!(plan["planId"].as_str().unwrap().starts_with("plan-"));
    assert_eq!(plan["operations"][0]["op"], "update");
    assert!(!body.contains("event: action"));
}

#[test]
fn assistant_chat_routes_light_state_requests_to_a_stored_action() {
    let content = json!({
        "kind": "action",
        "summary": "Dim the hallway lamp",
        "changes": [{"device_key": "dummy/lamp", "power": true, "brightness": 0.2}]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion_stream(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "dim the hallway lamp to 20%"}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.text().unwrap();
    let action = sse_event_data(&body, "action").expect("action event");
    let action_id = action["actionId"].as_str().unwrap().to_string();
    assert_eq!(action["changes"][0]["deviceKey"], "dummy/lamp");
    assert_eq!(action["changes"][0]["name"], "Hallway lamp");
    assert!(action["createdAtMs"].as_i64().unwrap() > 0);

    // Nothing is written before the user applies the stored action.
    let lamp = device_state(&server.base_url, &client, "dummy", "lamp");
    assert_eq!(lamp["data"]["Controllable"]["state"]["power"], false);

    let applied: Value = client
        .post(format!(
            "{}/api/v1/config/assistant/actions/{action_id}/apply",
            server.base_url
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(applied["success"], true);
    assert_eq!(applied["data"]["appliedCount"], 1);
    assert_eq!(applied["data"]["results"][0]["ok"], true);

    let lamp = device_state(&server.base_url, &client, "dummy", "lamp");
    let state = &lamp["data"]["Controllable"]["state"];
    assert_eq!(state["power"], true);
    assert!((state["brightness"].as_f64().unwrap() - 0.2).abs() < 0.01);
    // Manual changes carry a short transition instead of inheriting the
    // transition of whatever scene the device was in.
    assert!((state["transition"].as_f64().unwrap() - 0.4).abs() < 0.001);

    // Applying the same proposal again is supported.
    let again: Value = client
        .post(format!(
            "{}/api/v1/config/assistant/actions/{action_id}/apply",
            server.base_url
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(again["success"], true);
    assert_eq!(again["data"]["appliedCount"], 1);

    let unknown = client
        .post(format!(
            "{}/api/v1/config/assistant/actions/action-unknown/apply",
            server.base_url
        ))
        .send()
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
}

#[test]
fn assistant_chat_discards_stored_actions_and_enforces_scope() {
    let content = json!({
        "kind": "action",
        "summary": "scope escape",
        "changes": [{"device_key": "dummy/lamp", "power": true}]
    })
    .to_string();
    let provider = MockProvider::start(vec![MockResponse::completion_stream(&content)]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    // The model may only address devices inside the requested scope.
    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "turn on everything", "deviceKeys": ["dummy/motion"]}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.text().unwrap();
    assert!(sse_event_data(&body, "action").is_none());
    let error = sse_event_data(&body, "error").expect("error event");
    assert!(error["message"]
        .as_str()
        .unwrap()
        .contains("unknown device key"));

    let lamp = device_state(&server.base_url, &client, "dummy", "lamp");
    assert_eq!(lamp["data"]["Controllable"]["state"]["power"], false);
}

#[test]
fn assistant_chat_and_plan_forward_history() {
    let provider = MockProvider::start(vec![
        MockResponse::completion_stream(&valid_plan()),
        MockResponse::completion(&valid_plan()),
    ]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let history = json!([
        {"role": "user", "content": "add a movie night scene"},
        {"role": "assistant", "content": "Plan: 1 proposed operation"},
        {"role": "user", "content": ""}
    ]);

    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "now also dim the hallway lamp", "history": history}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let _ = response.text().unwrap();
    let messages = messages_from_request(&provider.request_bodies().pop().unwrap());
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[1]["role"], "user");
    assert_eq!(messages[1]["content"], "add a movie night scene");
    assert_eq!(messages[2]["role"], "assistant");
    assert_eq!(messages[2]["content"], "Plan: 1 proposed operation");
    assert_eq!(messages[3]["role"], "user");
    assert_eq!(messages[3]["content"], "now also dim the hallway lamp");

    let response = plan(
        &server.base_url,
        &client,
        json!({
            "prompt": "make it two scenes",
            "history": [{"role": "assistant", "content": "Plan: 1 proposed operation"}]
        }),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let messages = messages_from_request(&provider.request_bodies().pop().unwrap());
    assert_eq!(messages[1]["role"], "assistant");
    assert_eq!(messages[1]["content"], "Plan: 1 proposed operation");
    assert_eq!(messages[2]["role"], "user");
}

#[test]
fn assistant_chat_caps_history_server_side() {
    let provider = MockProvider::start(vec![MockResponse::completion_stream(&valid_plan())]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let history: Vec<Value> = (0..40)
        .map(|index| json!({"role": "user", "content": format!("turn {index}")}))
        .collect();
    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "continue", "history": history}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let _ = response.text().unwrap();

    // system + at most 16 capped turns + the current prompt.
    let messages = messages_from_request(&provider.request_bodies().pop().unwrap());
    assert!(
        messages.len() <= 18,
        "unexpected message count: {}",
        messages.len()
    );
    let first_history = messages[1]["content"].as_str().unwrap();
    assert!(first_history.starts_with("turn "), "{first_history}");
    assert_eq!(messages.last().unwrap()["content"], "continue");
}

#[test]
fn assistant_chat_is_disabled_without_configuration() {
    let server = start_server(None);
    let client = Client::new();

    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "turn on the lamp"}),
    );
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn assistant_chat_falls_back_when_the_provider_rejects_streaming() {
    let provider = MockProvider::start(vec![
        MockResponse::error(400, "stream not supported"),
        MockResponse::completion(&valid_plan()),
    ]);
    let server = start_server(Some(&provider));
    let client = Client::new();

    let response = chat(
        &server.base_url,
        &client,
        json!({"prompt": "rename the hallway group"}),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.text().unwrap();
    assert!(!body.contains("event: delta"));
    let plan = sse_event_data(&body, "plan").expect("plan event after fallback");
    assert_eq!(plan["operations"][0]["op"], "update");
    let usage = sse_event_data(&body, "usage").unwrap();
    assert_eq!(usage["approximate"], false);
    assert_eq!(provider.requests.load(Ordering::SeqCst), 2);
}

// ============================================================================
// Persisted conversation threads
// ============================================================================

#[test]
fn assistant_chat_persists_threads_for_continue_and_delete() {
    let provider = MockProvider::start(vec![
        MockResponse::completion_stream(&valid_plan()),
        MockResponse::completion_stream(&valid_plan()),
    ]);
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_assistant_threads_{}_{}",
        std::process::id(),
        unique_id
    ));
    std::fs::create_dir_all(&temp_dir).expect("thread test dir");
    let mut server = TestServer::with_config(TestServerConfig {
        config_content: Some(assistant_config().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        database_url: Some(format!(
            "sqlite://{}",
            temp_dir.join("threads.db").display()
        )),
        extra_env: vec![
            (
                "HOMECTL_ASSISTANT_BASE_URL".to_string(),
                provider.base_url.clone(),
            ),
            (
                "HOMECTL_ASSISTANT_MODEL".to_string(),
                "mock-model".to_string(),
            ),
            (
                "HOMECTL_ASSISTANT_API_KEY".to_string(),
                "test-key".to_string(),
            ),
        ],
        ..Default::default()
    })
    .expect("start test server");
    let client = Client::new();

    let body = chat(
        &server.base_url,
        &client,
        json!({"prompt": "rename the hallway group to hallway lights"}),
    )
    .text()
    .unwrap();
    let announced = sse_event_data(&body, "thread").expect("thread event");
    let thread_id = announced["id"].as_str().expect("thread id").to_string();
    assert_eq!(
        announced["name"],
        "rename the hallway group to hallway lights"
    );

    let listed: Value = client
        .get(format!(
            "{}/api/v1/config/assistant/threads",
            server.base_url
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(listed["success"], true);
    let threads = listed["data"].as_array().expect("thread list");
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0]["id"], thread_id.as_str());
    assert_eq!(threads[0]["messageCount"], 2);

    // Continuing the thread replays the stored history to the provider.
    let body = chat(
        &server.base_url,
        &client,
        json!({"prompt": "also turn it off at night", "threadId": thread_id}),
    )
    .text()
    .unwrap();
    assert_eq!(
        sse_event_data(&body, "thread").unwrap()["id"],
        thread_id.as_str()
    );
    let bodies = provider.request_bodies();
    let messages = messages_from_request(&bodies[1]);
    assert!(messages.iter().any(|message| {
        message["content"].as_str() == Some("rename the hallway group to hallway lights")
    }));

    let fetched: Value = client
        .get(format!(
            "{}/api/v1/config/assistant/threads/{}",
            server.base_url, thread_id
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let stored = fetched["data"]["messages"]
        .as_array()
        .expect("stored messages");
    assert_eq!(stored.len(), 4);
    assert_eq!(stored[0]["role"], "user");
    assert_eq!(
        stored[0]["content"],
        "rename the hallway group to hallway lights"
    );

    let deleted: Value = client
        .delete(format!(
            "{}/api/v1/config/assistant/threads/{}",
            server.base_url, thread_id
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(deleted["success"], true);
    let listed: Value = client
        .get(format!(
            "{}/api/v1/config/assistant/threads",
            server.base_url
        ))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert!(listed["data"].as_array().expect("thread list").is_empty());
    let missing = client
        .get(format!(
            "{}/api/v1/config/assistant/threads/{}",
            server.base_url, thread_id
        ))
        .send()
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    server.stop();
    let _ = std::fs::remove_dir_all(&temp_dir);
}
