//! Opt-in natural-language routine drafting (UI plan phase 5).
//!
//! The assistant is a drafting aid: it maps a prompt to a v2 definition and
//! validates the result with the same pure compiler used for stored routines.
//! Drafts are never persisted or enabled by the server; the client loads them
//! into the editor for review.
//!
//! Provider configuration lives in the deployment environment so secrets never
//! reach the browser or text exports:
//! - `HOMECTL_ASSISTANT_BASE_URL` (OpenAI-compatible base, e.g.
//!   `http://ollama.lan:11434/v1` or `https://api.openai.com/v1`)
//! - `HOMECTL_ASSISTANT_MODEL`
//! - `HOMECTL_ASSISTANT_API_KEY` (optional; local endpoints usually omit it)
//! - `HOMECTL_ASSISTANT_TIMEOUT_MS` (optional, default 60000)
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
const MAX_PROMPT_CHARS: usize = 2_000;
const MAX_ATTEMPTS: usize = 2;
const MAX_CATALOG_DEVICES: usize = 250;
const MAX_TOKENS: u32 = 2_048;

#[derive(Clone, Debug)]
struct AssistantConfig {
    base_url: String,
    api_key: Option<String>,
    model: String,
    timeout_ms: u64,
    timezone: Option<String>,
}

impl AssistantConfig {
    fn from_env() -> Option<Self> {
        let base_url = env_string("HOMECTL_ASSISTANT_BASE_URL")?;
        let model = env_string("HOMECTL_ASSISTANT_MODEL")?;
        Some(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: env_string("HOMECTL_ASSISTANT_API_KEY"),
            model,
            timeout_ms: env_string("HOMECTL_ASSISTANT_TIMEOUT_MS")
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(DEFAULT_TIMEOUT_MS),
            timezone: env_string("HOMECTL_ASSISTANT_TIMEZONE"),
        })
    }

    fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }
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
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let status = warp::path!("assistant" / "status")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(assistant_status);

    let draft = warp::path!("assistant" / "draft")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and_then(draft_routine);

    status.or(draft)
}

async fn assistant_status() -> Result<impl Reply, warp::Rejection> {
    let data = match AssistantConfig::from_env() {
        Some(config) => json!({ "enabled": true, "model": config.model }),
        None => json!({ "enabled": false }),
    };
    Ok(ApiResponse::success(data))
}

async fn draft_routine(
    request: DraftRequest,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let Some(config) = AssistantConfig::from_env() else {
        return Ok(error_response(
            "Assistant is not configured. Set HOMECTL_ASSISTANT_BASE_URL and HOMECTL_ASSISTANT_MODEL.",
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

    let snapshot = snapshot.load();
    let catalog = build_catalog(&snapshot, config.timezone.as_deref());
    let catalog_json = serde_json::to_string(&catalog.value).unwrap_or_else(|_| "{}".to_string());
    let compile_catalog = catalog_from_snapshot_export(&snapshot);

    let mut messages = vec![
        json!({ "role": "system", "content": system_prompt(&catalog_json) }),
        json!({ "role": "user", "content": user_prompt(prompt, request.focus.as_deref()) }),
    ];

    let mut json_mode = true;
    let mut last_errors = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        let content = match chat(&config, &messages, &mut json_mode).await {
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

async fn chat(
    config: &AssistantConfig,
    messages: &[Value],
    json_mode: &mut bool,
) -> Result<String, ProviderError> {
    if *json_mode {
        match post_chat(config, messages, true).await {
            Ok(content) => return Ok(content),
            Err(ProviderError::Status(400, body)) => {
                log::warn!(
                    "Assistant provider rejected response_format, retrying without it: {body}"
                );
                *json_mode = false;
            }
            Err(error) => return Err(error),
        }
    }
    post_chat(config, messages, false).await
}

async fn post_chat(
    config: &AssistantConfig,
    messages: &[Value],
    json_mode: bool,
) -> Result<String, ProviderError> {
    let mut body = json!({
        "model": config.model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": MAX_TOKENS,
    });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }

    let mut request = http_client()
        .post(config.chat_completions_url())
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
}
