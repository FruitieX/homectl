//! Opt-in natural-language routine drafting (UI plan phase 5).
//!
//! The assistant is a drafting aid: it maps a prompt to a v2 definition and
//! validates the result with the same pure compiler used for stored routines.
//! Drafts are never persisted or enabled by the server; the client loads them
//! into the editor for review.
//!
//! Provider configuration lives in a reserved `assistant` widget setting so it
//! is editable from the settings UI and persisted in the database. The API key
//! never leaves the server: it is masked in responses and dropped from exports
//! unless a secret-inclusive backup is requested. The `HOMECTL_ASSISTANT_*`
//! deployment environment variables remain as a fallback used only while no
//! stored settings exist:
//! - `HOMECTL_ASSISTANT_BASE_URL` (OpenAI-compatible base, e.g.
//!   `http://ollama.lan:11434/v1` or `https://api.openai.com/v1`)
//! - `HOMECTL_ASSISTANT_MODEL`
//! - `HOMECTL_ASSISTANT_API_KEY` (optional; local endpoints usually omit it)
//! - `HOMECTL_ASSISTANT_TIMEOUT_MS` (optional, default 60000)
//! - `HOMECTL_ASSISTANT_MAX_TOKENS` (optional, default 2048)
//! - `HOMECTL_ASSISTANT_REASONING_EFFORT` (optional; sent as `reasoning_effort`
//!   for thinking models, e.g. `high`)
//! - `HOMECTL_ASSISTANT_TIMEZONE` (optional IANA zone for drafted schedules;
//!   inferred from existing routines when unset)

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::*;
use crate::core::automation::{self, ConfigCatalog};
use crate::core::snapshot::RuntimeSnapshot;
use crate::types::device::{DeviceData, DeviceRef};

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_MAX_TOKENS: u32 = 2_048;
const MAX_PROMPT_CHARS: usize = 2_000;
const MAX_ATTEMPTS: usize = 2;
const MAX_CATALOG_DEVICES: usize = 250;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
const MAX_MAX_TOKENS: u64 = 1_000_000;
const REASONING_EFFORTS: [&str; 3] = ["low", "medium", "high"];

/// Reserved `widget_settings` key holding assistant provider configuration.
///
/// The assistant is a server feature rather than a dashboard widget, but
/// storing it as a widget setting lets it share the existing secret
/// redaction/export rules.
pub(super) const ASSISTANT_SETTING_KEY: &str = "assistant";

#[derive(Clone, Debug)]
struct AssistantConfig {
    base_url: String,
    api_key: Option<String>,
    model: String,
    timeout_ms: u64,
    max_tokens: u32,
    reasoning_effort: Option<String>,
    timezone: Option<String>,
}

/// Where assistant settings are read from: stored database settings once they
/// exist, deployment environment only until then.
enum SettingSource<'a> {
    Stored(&'a serde_json::Map<String, Value>),
    Environment,
}

impl SettingSource<'_> {
    fn string(&self, field: &str, env_name: &str) -> Option<String> {
        match self {
            Self::Stored(stored) => stored
                .get(field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            Self::Environment => env_string(env_name),
        }
    }

    fn u64(&self, field: &str, env_name: &str) -> Option<u64> {
        match self {
            Self::Stored(stored) => stored.get(field).and_then(Value::as_u64),
            Self::Environment => env_string(env_name).and_then(|value| value.parse().ok()),
        }
    }
}

fn setting_source(settings: &[config_queries::WidgetSettingRow]) -> SettingSource<'_> {
    match settings
        .iter()
        .find(|row| row.key == ASSISTANT_SETTING_KEY)
        .and_then(|row| row.config.as_object())
    {
        Some(stored) => SettingSource::Stored(stored),
        None => SettingSource::Environment,
    }
}

impl AssistantConfig {
    fn from_settings(settings: &[config_queries::WidgetSettingRow]) -> Option<Self> {
        let source = setting_source(settings);
        let base_url = source.string("base_url", "HOMECTL_ASSISTANT_BASE_URL")?;
        let model = source.string("model", "HOMECTL_ASSISTANT_MODEL")?;
        Some(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: source.string("api_key", "HOMECTL_ASSISTANT_API_KEY"),
            model,
            timeout_ms: source
                .u64("timeout_ms", "HOMECTL_ASSISTANT_TIMEOUT_MS")
                .filter(|value| *value > 0)
                .unwrap_or(DEFAULT_TIMEOUT_MS),
            max_tokens: source
                .u64("max_tokens", "HOMECTL_ASSISTANT_MAX_TOKENS")
                .filter(|value| *value > 0)
                .map(|value| value as u32)
                .unwrap_or(DEFAULT_MAX_TOKENS),
            reasoning_effort: source
                .string("reasoning_effort", "HOMECTL_ASSISTANT_REASONING_EFFORT"),
            timezone: source.string("timezone", "HOMECTL_ASSISTANT_TIMEZONE"),
        })
    }

    fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }
}

/// Browser-safe view of the effective assistant settings. The API key is never
/// included, only whether one is set.
fn assistant_settings_view(settings: &[config_queries::WidgetSettingRow]) -> Value {
    let source = setting_source(settings);
    let base_url = source.string("base_url", "HOMECTL_ASSISTANT_BASE_URL");
    let model = source.string("model", "HOMECTL_ASSISTANT_MODEL");
    json!({
        "enabled": base_url.is_some() && model.is_some(),
        "baseUrl": base_url,
        "model": model,
        "apiKeySet": source
            .string("api_key", "HOMECTL_ASSISTANT_API_KEY")
            .is_some(),
        "reasoningEffort": source.string(
            "reasoning_effort",
            "HOMECTL_ASSISTANT_REASONING_EFFORT",
        ),
        "maxTokens": source
            .u64("max_tokens", "HOMECTL_ASSISTANT_MAX_TOKENS")
            .filter(|value| *value > 0)
            .map(|value| value as u32)
            .unwrap_or(DEFAULT_MAX_TOKENS),
        "timeoutMs": source
            .u64("timeout_ms", "HOMECTL_ASSISTANT_TIMEOUT_MS")
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_TIMEOUT_MS),
        "timezone": source.string("timezone", "HOMECTL_ASSISTANT_TIMEZONE"),
    })
}

/// Settings update from the settings form. An absent field keeps its stored
/// value; an empty string (or zero) clears it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistantSettingsPatch {
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    max_tokens: Option<u64>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    timezone: Option<String>,
}

fn apply_assistant_settings_patch(
    mut stored: serde_json::Map<String, Value>,
    patch: AssistantSettingsPatch,
) -> Result<serde_json::Map<String, Value>, String> {
    if let Some(value) = patch.base_url {
        set_stored_string(&mut stored, "base_url", &value);
    }
    if let Some(value) = patch.model {
        set_stored_string(&mut stored, "model", &value);
    }
    if let Some(value) = patch.api_key {
        set_stored_string(&mut stored, "api_key", &value);
    }
    if let Some(value) = patch.reasoning_effort {
        let value = value.trim().to_lowercase();
        if value.is_empty() {
            stored.remove("reasoning_effort");
        } else if REASONING_EFFORTS.contains(&value.as_str()) {
            stored.insert("reasoning_effort".to_string(), json!(value));
        } else {
            return Err(format!(
                "reasoningEffort must be one of {}",
                REASONING_EFFORTS.join(", ")
            ));
        }
    }
    if let Some(value) = patch.timezone {
        let value = value.trim();
        if value.is_empty() {
            stored.remove("timezone");
        } else if value.parse::<chrono_tz::Tz>().is_err() {
            return Err(format!("unknown timezone: {value}"));
        } else {
            stored.insert("timezone".to_string(), json!(value));
        }
    }
    if let Some(value) = patch.max_tokens {
        set_stored_u64(
            &mut stored,
            "max_tokens",
            value,
            1,
            MAX_MAX_TOKENS,
            "maxTokens",
        )?;
    }
    if let Some(value) = patch.timeout_ms {
        set_stored_u64(
            &mut stored,
            "timeout_ms",
            value,
            MIN_TIMEOUT_MS,
            MAX_TIMEOUT_MS,
            "timeoutMs",
        )?;
    }
    Ok(stored)
}

fn set_stored_string(stored: &mut serde_json::Map<String, Value>, field: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        stored.remove(field);
    } else {
        stored.insert(field.to_string(), json!(value));
    }
}

fn set_stored_u64(
    stored: &mut serde_json::Map<String, Value>,
    field: &str,
    value: u64,
    min: u64,
    max: u64,
    label: &str,
) -> Result<(), String> {
    if value == 0 {
        stored.remove(field);
        return Ok(());
    }
    if value < min || value > max {
        return Err(format!("{label} must be between {min} and {max}"));
    }
    stored.insert(field.to_string(), json!(value));
    Ok(())
}

fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftRequest {
    prompt: String,
    #[serde(default)]
    focus: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DraftEnvelope {
    #[serde(default)]
    name: Option<String>,
    definition: Value,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug)]
struct ValidatedDraft {
    name: Option<String>,
    definition: Value,
    notes: Option<String>,
}

#[derive(Debug)]
enum ProviderError {
    Status(u16, String),
    Transport(String),
}

pub(super) fn assistant_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let status = warp::path!("assistant" / "status")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(assistant_status);

    let settings_get = warp::path!("assistant" / "settings")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_assistant_settings);

    let settings_put = warp::path!("assistant" / "settings")
        .and(warp::path::end())
        .and(warp::put())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(update_assistant_settings);

    let draft = warp::path!("assistant" / "draft")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and_then(draft_routine);

    status.or(settings_get).or(settings_put).or(draft)
}

async fn assistant_status(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snapshot = snapshot.load();
    let settings = &snapshot.runtime_config.widget_settings;
    let data = match AssistantConfig::from_settings(settings) {
        Some(config) => json!({ "enabled": true, "model": config.model }),
        None => json!({ "enabled": false }),
    };
    Ok(ApiResponse::success(data))
}

async fn get_assistant_settings(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snapshot = snapshot.load();
    Ok(ApiResponse::success(assistant_settings_view(
        &snapshot.runtime_config.widget_settings,
    )))
}

async fn update_assistant_settings(
    patch: AssistantSettingsPatch,
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let stored = snapshot
        .load()
        .runtime_config
        .widget_settings
        .iter()
        .find(|row| row.key == ASSISTANT_SETTING_KEY)
        .and_then(|row| row.config.as_object().cloned())
        .unwrap_or_default();
    let updated = match apply_assistant_settings_patch(stored, patch) {
        Ok(updated) => updated,
        Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    };
    let setting = config_queries::WidgetSettingRow {
        key: ASSISTANT_SETTING_KEY.to_string(),
        config: Value::Object(updated),
    };
    let persistence_setting = setting.clone();

    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_widget_setting(setting);
                assistant_settings_view(&state.runtime_config.widget_settings)
            })
        })
        .await;
    let response = match result {
        Ok(response) => response,
        Err(_) => return Ok(actor_unavailable()),
    };

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_widget_setting(&persistence_setting).await;
    Ok(config_write_response(
        response,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

async fn draft_routine(
    request: DraftRequest,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snapshot = snapshot.load();
    let Some(config) = AssistantConfig::from_settings(&snapshot.runtime_config.widget_settings)
    else {
        return Ok(error_response(
            "Assistant is not configured. Set the provider base URL and model in Settings.",
            StatusCode::SERVICE_UNAVAILABLE,
        ));
    };

    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Ok(error_response(
            "prompt is required",
            StatusCode::BAD_REQUEST,
        ));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Ok(error_response(
            &format!("prompt must be at most {MAX_PROMPT_CHARS} characters"),
            StatusCode::BAD_REQUEST,
        ));
    }

    let catalog = build_catalog(&snapshot, config.timezone.as_deref());
    let catalog_json = serde_json::to_string(&catalog.value).unwrap_or_else(|_| "{}".to_string());
    let compile_catalog = catalog_from_snapshot_export(&snapshot);

    let mut messages = vec![
        json!({ "role": "system", "content": system_prompt(&catalog_json) }),
        json!({ "role": "user", "content": user_prompt(prompt, request.focus.as_deref()) }),
    ];

    let mut options = ChatOptions {
        json_mode: true,
        reasoning_effort: config.reasoning_effort.is_some(),
    };
    // One conversation per draft, including repair attempts, so gateways can
    // route and cache consistently (OpenCode Go asks for a stable session id).
    let session_id = new_session_id();
    let mut last_errors = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        let content = match chat(&config, &messages, &mut options, &session_id).await {
            Ok(content) => content,
            Err(error) => return Ok(provider_error_response(error)),
        };

        match parse_and_validate(&content, &compile_catalog) {
            Ok(draft) => {
                let mut warnings = catalog.warnings;
                if let Some(notes) = draft.notes.as_deref().map(str::trim) {
                    if !notes.is_empty() {
                        warnings.push(notes.to_string());
                    }
                }
                if let Some(warning) = program_warning(&draft.definition) {
                    warnings.push(warning);
                }

                return Ok(ApiResponse::success(json!({
                    "name": draft.name,
                    "definition": draft.definition,
                    "warnings": warnings,
                    "attempts": attempt,
                    "model": config.model,
                })));
            }
            Err(errors) => {
                last_errors = errors;
                if attempt < MAX_ATTEMPTS {
                    messages.push(json!({ "role": "assistant", "content": content }));
                    messages.push(json!({
                        "role": "user",
                        "content": format!(
                            "That draft failed validation:\n{last_errors}\nReturn a corrected JSON object with the same contract."
                        ),
                    }));
                }
            }
        }
    }

    Ok(error_response(
        &format!("Assistant could not produce a valid definition: {last_errors}"),
        StatusCode::UNPROCESSABLE_ENTITY,
    ))
}

fn provider_error_response(error: ProviderError) -> warp::reply::WithStatus<warp::reply::Json> {
    match error {
        ProviderError::Status(status, body) => {
            log::warn!("Assistant provider returned {status}: {body}");
            error_response(
                &format!("Assistant provider returned HTTP {status}"),
                StatusCode::BAD_GATEWAY,
            )
        }
        ProviderError::Transport(message) => {
            log::warn!("Assistant provider request failed: {message}");
            error_response("Assistant provider request failed", StatusCode::BAD_GATEWAY)
        }
    }
}

/// Optional request features that are dropped one at a time when a provider
/// rejects them with HTTP 400.
#[derive(Clone, Copy, Debug)]
struct ChatOptions {
    json_mode: bool,
    reasoning_effort: bool,
}

fn new_session_id() -> String {
    let first: u64 = rand::random();
    let second: u64 = rand::random();
    format!("homectl-{first:016x}{second:016x}")
}

fn user_agent() -> String {
    format!("homectl-assistant/{}", env!("CARGO_PKG_VERSION"))
}

async fn chat(
    config: &AssistantConfig,
    messages: &[Value],
    options: &mut ChatOptions,
    session_id: &str,
) -> Result<String, ProviderError> {
    loop {
        match post_chat(config, messages, *options, session_id).await {
            Ok(content) => return Ok(content),
            Err(ProviderError::Status(400, body)) if options.json_mode => {
                log::warn!(
                    "Assistant provider rejected response_format, retrying without it: {body}"
                );
                options.json_mode = false;
            }
            Err(ProviderError::Status(400, body)) if options.reasoning_effort => {
                log::warn!(
                    "Assistant provider rejected reasoning_effort, retrying without it: {body}"
                );
                options.reasoning_effort = false;
            }
            Err(error) => return Err(error),
        }
    }
}

fn chat_request_body(config: &AssistantConfig, messages: &[Value], options: ChatOptions) -> Value {
    let mut body = json!({
        "model": config.model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": config.max_tokens,
    });
    if options.json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    if options.reasoning_effort {
        if let Some(effort) = &config.reasoning_effort {
            body["reasoning_effort"] = json!(effort);
        }
    }
    body
}

async fn post_chat(
    config: &AssistantConfig,
    messages: &[Value],
    options: ChatOptions,
    session_id: &str,
) -> Result<String, ProviderError> {
    let body = chat_request_body(config, messages, options);

    let mut request = http_client()
        .post(config.chat_completions_url())
        .header(reqwest::header::USER_AGENT, user_agent())
        .header("x-opencode-session", session_id)
        .json(&body);
    if let Some(api_key) = &config.api_key {
        request = request.bearer_auth(api_key);
    }

    let response = tokio::time::timeout(Duration::from_millis(config.timeout_ms), request.send())
        .await
        .map_err(|_| ProviderError::Transport(format!("timed out after {} ms", config.timeout_ms)))?
        .map_err(|error| ProviderError::Transport(error.to_string()))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| ProviderError::Transport(error.to_string()))?;

    if !status.is_success() {
        return Err(ProviderError::Status(status.as_u16(), truncate(&text, 500)));
    }

    let value: Value = serde_json::from_str(&text)
        .map_err(|error| ProviderError::Transport(format!("invalid provider response: {error}")))?;
    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            ProviderError::Transport(
                "provider response had no choices[0].message.content".to_string(),
            )
        })
}

fn http_client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .expect("assistant http client")
        })
        .clone()
}

fn parse_and_validate(content: &str, catalog: &ConfigCatalog) -> Result<ValidatedDraft, String> {
    let value = extract_json_object(content)
        .ok_or_else(|| "response contained no JSON object".to_string())?;
    let envelope: DraftEnvelope = serde_json::from_value(value)
        .map_err(|error| format!("invalid draft envelope: {error}"))?;

    automation::compile_definition_value(&envelope.definition, catalog)
        .map_err(|report| report.summary())?;

    Ok(ValidatedDraft {
        name: envelope
            .name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty()),
        definition: envelope.definition,
        notes: envelope.notes,
    })
}

/// Extract the outermost JSON object from model output, tolerating markdown
/// fences and surrounding prose.
fn extract_json_object(content: &str) -> Option<Value> {
    let trimmed = content.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if value.is_object() {
            return Some(value);
        }
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Value>(&trimmed[start..=end]).ok()
}

fn program_warning(definition: &Value) -> Option<String> {
    match definition.pointer("/program/kind").and_then(Value::as_str) {
        Some("script") => Some(
            "Draft uses a sandboxed script program; review the script body before saving."
                .to_string(),
        ),
        _ => None,
    }
}

struct Catalog {
    value: Value,
    warnings: Vec<String>,
}

fn build_catalog(snapshot: &RuntimeSnapshot, configured_timezone: Option<&str>) -> Catalog {
    let mut warnings = Vec::new();

    let mut devices = Vec::new();
    for (key, device) in snapshot.devices.0.iter().take(MAX_CATALOG_DEVICES) {
        let device_ref = serde_json::to_value(DeviceRef::from(key)).unwrap_or(Value::Null);
        let entry = match &device.data {
            DeviceData::Sensor(sensor) => json!({
                "deviceRef": device_ref,
                "key": key.to_string(),
                "name": device.name,
                "kind": "sensor",
                "state": sensor,
            }),
            DeviceData::Controllable(controllable) => json!({
                "deviceRef": device_ref,
                "key": key.to_string(),
                "name": device.name,
                "kind": "controllable",
                "state": controllable.state,
                "capabilities": controllable.capabilities,
                "sceneId": controllable.scene_id,
            }),
        };
        devices.push(entry);
    }
    if snapshot.devices.0.len() > MAX_CATALOG_DEVICES {
        warnings.push(format!(
            "Catalog was truncated to the first {MAX_CATALOG_DEVICES} devices."
        ));
    }

    let groups: Vec<Value> = snapshot
        .runtime_config
        .groups
        .iter()
        .map(|group| {
            json!({
                "id": group.id,
                "name": group.name,
                "hidden": group.hidden,
            })
        })
        .collect();

    let scenes: Vec<Value> = snapshot
        .runtime_config
        .scenes
        .iter()
        .map(|scene| {
            json!({
                "id": scene.id,
                "name": scene.name,
                "hidden": scene.hidden,
            })
        })
        .collect();

    let helpers: Vec<Value> = snapshot
        .runtime_config
        .helpers
        .iter()
        .map(|helper| {
            json!({
                "id": helper.id,
                "name": helper.name,
                "kind": helper.kind,
                "initialValue": helper.initial_value,
            })
        })
        .collect();

    let sources: Vec<Value> = snapshot
        .runtime_config
        .sources
        .iter()
        .map(|source| {
            json!({
                "id": source.id,
                "name": source.name,
                "enabled": source.enabled,
            })
        })
        .collect();

    let routines: Vec<Value> = snapshot
        .runtime_config
        .routines
        .iter()
        .map(|routine| {
            json!({
                "id": routine.id,
                "name": routine.name,
                "enabled": routine.enabled,
            })
        })
        .collect();

    let timezone = infer_timezone(snapshot, configured_timezone);
    if configured_timezone.is_none() {
        warnings.push(format!(
            "Schedule timezone was inferred as {timezone}; set HOMECTL_ASSISTANT_TIMEZONE to override."
        ));
    }

    Catalog {
        value: json!({
            "timezone": timezone,
            "devices": devices,
            "groups": groups,
            "scenes": scenes,
            "helpers": helpers,
            "sources": sources,
            "routines": routines,
        }),
        warnings,
    }
}

fn infer_timezone(snapshot: &RuntimeSnapshot, configured: Option<&str>) -> String {
    if let Some(configured) = configured {
        return configured.to_string();
    }

    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for routine in &snapshot.runtime_config.routines {
        let Some(definition) = &routine.definition_v2 else {
            continue;
        };
        let Some(triggers) = definition.get("triggers").and_then(Value::as_array) else {
            continue;
        };
        for trigger in triggers {
            if trigger.get("kind").and_then(Value::as_str) != Some("schedule") {
                continue;
            }
            if let Some(timezone) = trigger
                .pointer("/schedule/timezone")
                .and_then(Value::as_str)
            {
                *counts.entry(timezone).or_default() += 1;
            }
        }
    }

    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(timezone, _)| timezone.to_string())
        .unwrap_or_else(|| "UTC".to_string())
}

fn catalog_from_snapshot_export(snapshot: &RuntimeSnapshot) -> ConfigCatalog {
    ConfigCatalog::new(snapshot.devices.0.keys().cloned(), &snapshot.runtime_config)
}

fn user_prompt(prompt: &str, focus: Option<&str>) -> String {
    match focus.map(str::trim).filter(|focus| !focus.is_empty()) {
        Some(focus) => format!("Request: {prompt}\n\nCurrent focus: {focus}"),
        None => format!("Request: {prompt}"),
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated: String = value.chars().take(max_chars).collect();
    truncated.push('…');
    truncated
}

fn system_prompt(catalog_json: &str) -> String {
    format!(
        r#"You are the homectl routine drafting assistant. You translate a plain-language request into one homectl v2 routine definition.

Respond with a single JSON object and nothing else:
{{"name": "<short routine name>", "definition": <RoutineDefinitionV2>, "notes": "<optional assumptions>"}}

Rules:
- Only reference entities that appear in the CATALOG below. Never invent device ids, groups, scenes, helpers, sources, or routine ids. If the request needs an entity that does not exist, pick the closest catalog entity and explain the substitution in "notes".
- Every node id ("id" on triggers, steps, and branches) must be a unique short string within the routine, e.g. "t1", "a1".
- Prefer native programs. Only use a script program when the request cannot be expressed natively.
- Schedules use six-field cron: "second minute hour day-of-month month day-of-week" and should include the timezone from the catalog.
- Conditions are three-valued; prefer explicit comparisons over implicit truthiness.

RoutineDefinitionV2 shape:
{{
  "triggers": [ ... ],              // required, 1..16
  "condition": {{ ... }},             // optional, defaults to {{"kind":"literal","value":true}}
  "program": {{ ... }},               // required
  "execution": {{ ... }}              // optional, defaults to {{"mode":"queued","max_actions":16}}
}}

Trigger kinds (each has "id"):
- {{"kind":"report","id":"t1","device":DEVICE_REF}}                            // fires on every device report pulse
- {{"kind":"state_change","id":"t1","device":DEVICE_REF,"mode":"transition"}}  // "transition" (default) or "level"
- {{"kind":"predicate_transition","id":"t1","predicate":CONDITION}}            // fires when CONDITION turns true
- {{"kind":"predicate_for","id":"t1","predicate":CONDITION,"duration_ms":300000}}
- {{"kind":"schedule","id":"t1","schedule":{{"cron":"0 0 7 * * *","timezone":"Europe/Helsinki"}}}}
- {{"kind":"timer_fired","id":"t1","timer":"TIMER_ID"}}
- {{"kind":"startup","id":"t1"}}                                               // server start seeding
- {{"kind":"manual","id":"t1"}}                                                // only explicit invocation

Condition kinds:
- {{"kind":"literal","value":true}}
- {{"kind":"all","conditions":[CONDITION, ...]}}
- {{"kind":"any","conditions":[CONDITION, ...]}}
- {{"kind":"not","condition":CONDITION}}
- {{"kind":"comparison","source":SOURCE,"operator":"eq","value":true}}
  operators: eq, ne, gt, gte, lt, lte, contains, starts_with, exists, truthy, regex
- {{"kind":"group","group_id":"GROUP_ID","quantifier":"any","power":true}}
  quantifiers: all, any, none, partial; optionally add "scene":"SCENE_ID"

Value sources:
- {{"kind":"device","device":DEVICE_REF,"path":"/value"}}   // sensor value
- {{"kind":"device","device":DEVICE_REF,"path":"/power"}}   // controllable intent
- {{"kind":"helper","helper":"HELPER_ID"}}
- {{"kind":"computed_source","source":"SOURCE_ID","path":"/value"}}

Native steps (each has "id"; program is {{"kind":"native","steps":[...]}}):
- {{"action":"activate_scene","id":"a1","scene_id":"SCENE_ID","targets":TARGETS,"transition_ms":500}}
- {{"action":"cycle_scenes","id":"a1","scenes":[{{"scene_id":"SCENE_ID"}}],"nowrap":false}}
- {{"action":"set_power","id":"a1","device":DEVICE_REF,"power":true}}
- {{"action":"dim","id":"a1","targets":TARGETS,"step":-1.0}}                    // step in -1.0..1.0
- {{"action":"randomize_color","id":"a1","targets":TARGETS,"transition_ms":250}}
- {{"action":"choose","id":"a1","branches":[{{"id":"b1","condition":CONDITION,"steps":[ ... ]}}]}}
- {{"action":"schedule_timer","id":"a1","timer":"TIMER_ID","delay_ms":300000}}
- {{"action":"replace_timer","id":"a1","timer":"TIMER_ID","delay_ms":300000}}
- {{"action":"cancel_timer","id":"a1","timer":"TIMER_ID"}}
- {{"action":"set_helper","id":"a1","helper":"HELPER_ID","value":true}}
- {{"action":"invoke_routine","id":"a1","routine_id":"ROUTINE_ID","mode":"fire_and_forget"}}

TARGETS: {{"devices":[DEVICE_REF, ...],"groups":["GROUP_ID", ...]}}
DEVICE_REF: {{"integration_id":"...","device_id":"..."}}  // copy verbatim from the catalog

Script programs (last resort): {{"kind":"script","spec":{{"api_version":1,"source_body":"return [ ... ]","declarations":[{{"kind":"device","device":DEVICE_REF}}]}}}}

CATALOG:
{catalog_json}"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::config_queries::ConfigExport;
    use crate::types::device::{Device, DeviceId, DeviceKey, DevicesState, SensorDevice};
    use crate::types::integration::IntegrationId;

    fn dummy_key() -> DeviceKey {
        DeviceKey {
            integration_id: IntegrationId::from("dummy".to_string()),
            device_id: DeviceId::new("sensor"),
        }
    }

    fn empty_export() -> ConfigExport {
        ConfigExport {
            version: 1,
            core: Default::default(),
            integrations: Vec::new(),
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: Vec::new(),
            helpers: Vec::new(),
            helper_values: Vec::new(),
            sources: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_color_calibrations: Vec::new(),
            color_calibration_profiles: Vec::new(),
            color_calibration_assignments: Vec::new(),
            device_sensor_configs: Vec::new(),
            widget_settings: Vec::new(),
            dashboard_layouts: Vec::new(),
            dashboard_widgets: Vec::new(),
        }
    }

    fn catalog_with_device() -> ConfigCatalog {
        ConfigCatalog::new([dummy_key()], &empty_export())
    }

    fn valid_definition() -> Value {
        json!({
            "triggers": [{
                "kind": "state_change",
                "id": "t1",
                "device": {"integration_id": "dummy", "device_id": "sensor"},
                "mode": "transition"
            }],
            "program": {
                "kind": "native",
                "steps": [{
                    "action": "set_power",
                    "id": "a1",
                    "device": {"integration_id": "dummy", "device_id": "sensor"},
                    "power": true
                }]
            }
        })
    }

    #[test]
    fn extracts_json_from_fenced_and_prose_wrapped_output() {
        let fenced = "```json\n{\"name\":\"A\",\"definition\":{}}\n```";
        assert_eq!(
            extract_json_object(fenced).unwrap()["name"],
            Value::String("A".to_string())
        );

        let prose = "Sure! Here is the draft: {\"name\":\"B\",\"definition\":{}} Enjoy.";
        assert_eq!(
            extract_json_object(prose).unwrap()["name"],
            Value::String("B".to_string())
        );

        assert!(extract_json_object("no json here").is_none());
    }

    #[test]
    fn accepts_valid_draft_and_rejects_unknown_entities() {
        let envelope = json!({"name": "Test", "definition": valid_definition()});
        let content = serde_json::to_string(&envelope).unwrap();
        let draft = parse_and_validate(&content, &catalog_with_device()).unwrap();
        assert_eq!(draft.name.as_deref(), Some("Test"));

        let mut invalid = valid_definition();
        invalid["program"]["steps"][0]["device"]["device_id"] =
            Value::String("missing".to_string());
        let content = serde_json::to_string(&json!({"definition": invalid})).unwrap();
        let error = parse_and_validate(&content, &catalog_with_device()).unwrap_err();
        assert!(error.contains("missing"), "unexpected error: {error}");
    }

    #[test]
    fn catalog_contains_entities_and_inferred_timezone() {
        let mut export = empty_export();
        export.routines = vec![serde_json::from_value(json!({
            "id": "r1",
            "name": "Morning",
            "enabled": true,
            "semantics_version": 2,
            "definition_v2": {
                "triggers": [{
                    "kind": "schedule",
                    "id": "t1",
                    "schedule": {"cron": "0 0 7 * * *", "timezone": "Europe/Helsinki"}
                }],
                "program": {"kind": "native", "steps": []}
            },
            "rules": {},
            "actions": {}
        }))
        .unwrap()];

        let device = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("sensor"),
            "Test sensor".to_string(),
            DeviceData::Sensor(SensorDevice::Boolean { value: true }),
            None,
        );
        let snapshot = RuntimeSnapshot {
            runtime_config: std::sync::Arc::new(export),
            devices: std::sync::Arc::new(DevicesState(
                [(dummy_key(), device)].into_iter().collect(),
            )),
            flattened_groups: Default::default(),
            flattened_scenes: Default::default(),
            routine_statuses: Default::default(),
            helper_statuses: Default::default(),
            timers: Default::default(),
            ui_state: Default::default(),
            warming_up: false,
        };

        let catalog = build_catalog(&snapshot, None);
        assert_eq!(catalog.value["timezone"], "Europe/Helsinki");
        assert_eq!(catalog.value["devices"][0]["name"], "Test sensor");
        assert_eq!(catalog.value["routines"][0]["id"], "r1");

        let catalog = build_catalog(&snapshot, Some("UTC"));
        assert_eq!(catalog.value["timezone"], "UTC");
    }

    #[test]
    fn system_prompt_documents_the_schema_and_catalog() {
        let prompt = system_prompt("{\"devices\":[]}");
        assert!(prompt.contains("RoutineDefinitionV2"));
        assert!(prompt.contains("predicate_for"));
        assert!(prompt.contains("\"devices\":[]"));
    }

    fn test_config() -> AssistantConfig {
        AssistantConfig {
            base_url: "http://localhost/v1".to_string(),
            api_key: None,
            model: "mock-model".to_string(),
            timeout_ms: 1_000,
            max_tokens: 4_096,
            reasoning_effort: Some("high".to_string()),
            timezone: None,
        }
    }

    #[test]
    fn request_body_includes_reasoning_effort_and_limits() {
        let config = test_config();
        let messages = vec![json!({"role": "user", "content": "hi"})];

        let body = chat_request_body(
            &config,
            &messages,
            ChatOptions {
                json_mode: true,
                reasoning_effort: true,
            },
        );
        assert_eq!(body["model"], "mock-model");
        assert_eq!(body["max_tokens"], 4_096);
        assert_eq!(body["reasoning_effort"], "high");
        assert_eq!(body["response_format"]["type"], "json_object");

        let body = chat_request_body(
            &config,
            &messages,
            ChatOptions {
                json_mode: false,
                reasoning_effort: false,
            },
        );
        assert!(body.get("reasoning_effort").is_none());
        assert!(body.get("response_format").is_none());
    }

    #[test]
    fn flags_script_programs() {
        let script = json!({"program": {"kind": "script", "spec": {"api_version": 1}}});
        assert!(program_warning(&script).is_some());
        let native = json!({"program": {"kind": "native", "steps": []}});
        assert!(program_warning(&native).is_none());
    }

    #[test]
    fn device_ref_serializes_with_integration_and_device_ids() {
        let value = serde_json::to_value(DeviceRef::from(&dummy_key())).unwrap();
        assert_eq!(value["integration_id"], "dummy");
        assert_eq!(value["device_id"], "sensor");
    }

    fn assistant_setting_row(config: Value) -> config_queries::WidgetSettingRow {
        config_queries::WidgetSettingRow {
            key: ASSISTANT_SETTING_KEY.to_string(),
            config,
        }
    }

    fn stored_settings() -> Vec<config_queries::WidgetSettingRow> {
        vec![assistant_setting_row(json!({
            "base_url": "https://opencode.ai/zen/go/v1",
            "model": "deepseek-v4.1-flash",
            "api_key": "sk-secret",
            "reasoning_effort": "high",
            "max_tokens": 8192,
            "timeout_ms": 120000,
            "timezone": "Europe/Helsinki"
        }))]
    }

    #[test]
    fn settings_view_masks_api_key() {
        let view = assistant_settings_view(&stored_settings());
        assert_eq!(view["enabled"], true);
        assert_eq!(view["baseUrl"], "https://opencode.ai/zen/go/v1");
        assert_eq!(view["model"], "deepseek-v4.1-flash");
        assert_eq!(view["apiKeySet"], true);
        assert_eq!(view["reasoningEffort"], "high");
        assert_eq!(view["maxTokens"], 8192);
        assert_eq!(view["timeoutMs"], 120000);
        assert_eq!(view["timezone"], "Europe/Helsinki");
        assert!(view.get("apiKey").is_none());
        assert!(!view.to_string().contains("sk-secret"));
    }

    #[test]
    fn config_prefers_stored_settings() {
        let config = AssistantConfig::from_settings(&stored_settings()).unwrap();
        assert_eq!(config.base_url, "https://opencode.ai/zen/go/v1");
        assert_eq!(config.model, "deepseek-v4.1-flash");
        assert_eq!(config.api_key.as_deref(), Some("sk-secret"));
        assert_eq!(config.max_tokens, 8192);
        assert_eq!(config.timeout_ms, 120000);
        assert_eq!(config.timezone.as_deref(), Some("Europe/Helsinki"));
    }

    #[test]
    fn stored_settings_disable_assistant_when_cleared() {
        let settings = vec![assistant_setting_row(json!({"max_tokens": 4096}))];
        assert!(AssistantConfig::from_settings(&settings).is_none());
        let view = assistant_settings_view(&settings);
        assert_eq!(view["enabled"], false);
        assert_eq!(view["baseUrl"], Value::Null);
        assert_eq!(view["apiKeySet"], false);
        assert_eq!(view["maxTokens"], 4096);
        assert_eq!(view["timeoutMs"], DEFAULT_TIMEOUT_MS);
    }

    #[test]
    fn settings_patch_sets_and_clears_fields() {
        let updated = apply_assistant_settings_patch(
            serde_json::Map::new(),
            AssistantSettingsPatch {
                base_url: Some("https://api.openai.com/v1/".to_string()),
                model: Some("gpt-test".to_string()),
                api_key: Some("sk-new".to_string()),
                reasoning_effort: Some("HIGH".to_string()),
                max_tokens: Some(4096),
                timeout_ms: Some(30_000),
                timezone: Some("UTC".to_string()),
            },
        )
        .unwrap();
        assert_eq!(updated["base_url"], "https://api.openai.com/v1/");
        assert_eq!(updated["reasoning_effort"], "high");
        assert_eq!(updated["max_tokens"], 4096);

        // Omitted fields keep their values; empty values clear them.
        let cleared = apply_assistant_settings_patch(
            updated,
            AssistantSettingsPatch {
                api_key: Some(String::new()),
                reasoning_effort: Some(String::new()),
                timezone: Some(String::new()),
                max_tokens: Some(0),
                timeout_ms: None,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(cleared.get("api_key").is_none());
        assert!(cleared.get("reasoning_effort").is_none());
        assert!(cleared.get("timezone").is_none());
        assert!(cleared.get("max_tokens").is_none());
        assert_eq!(cleared["timeout_ms"], 30_000);
        assert_eq!(cleared["model"], "gpt-test");
    }

    #[test]
    fn settings_patch_rejects_invalid_values() {
        let error = apply_assistant_settings_patch(
            serde_json::Map::new(),
            AssistantSettingsPatch {
                reasoning_effort: Some("extreme".to_string()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("reasoningEffort"));

        let error = apply_assistant_settings_patch(
            serde_json::Map::new(),
            AssistantSettingsPatch {
                timezone: Some("Mars/Olympus".to_string()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("timezone"));

        let error = apply_assistant_settings_patch(
            serde_json::Map::new(),
            AssistantSettingsPatch {
                timeout_ms: Some(10),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("timeoutMs"));
    }
}
