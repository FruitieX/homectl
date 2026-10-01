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
//!
//! The configuration assistant plan flow (`assistant/search`, `assistant/plan`,
//! `assistant/plans/{id}`, `DELETE assistant/plans/{id}` to discard, and
//! `assistant/plans/{id}/apply`) shares the same
//! provider settings. Plans live in an in-memory store for as long as the
//! server process runs; applying a plan re-validates the accepted operations
//! against the live snapshot and writes them through the config API's state
//! mutations.

use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::{Arc, Mutex as StdMutex};
use std::task::{Context, Poll};
use std::time::Duration;

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};
use tokio_stream::wrappers::ReceiverStream;

use super::*;
use crate::core::automation::{self, ConfigCatalog};
use crate::core::integrations::integration_config_schemas;
use crate::core::snapshot::RuntimeSnapshot;
use crate::types::assistant::assistant_proposal_id;
use crate::types::assistant::{
    ApplyAssistantActionRequest, ApplyAssistantActionResponse, ApplyAssistantPlanRequest,
    ApplyAssistantPlanResponse, AssistantAction, AssistantActionChange,
    AssistantActionChangeResult, AssistantActionColor, AssistantAttachment, AssistantChatRequest,
    AssistantEntityKind, AssistantHistoryMessage, AssistantMessageRole, AssistantOpKind,
    AssistantOperation, AssistantOperationResult, AssistantPlan, AssistantPlanRequest,
    AssistantSearchResult, AssistantThread, AssistantThreadOutcomeRequest, AssistantThreadProposal,
    AssistantUsage,
};
use crate::types::automation_block::AutomationBlock;
use crate::types::automation_source::SourceDefinition;
use crate::types::automation_value::HelperDefinition;
use crate::types::device::{Device, DeviceData, DeviceKey, DeviceRef};
use crate::types::device_command::DeviceCommand;
use crate::types::integration::IntegrationConfigFieldKind;
use crate::types::logs::{LogLevel, UiLogEntry};
use crate::types::scene::SceneDeviceConfig;
use ordered_float::OrderedFloat;

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_MAX_TOKENS: u32 = 2_048;
const MAX_PROMPT_CHARS: usize = 2_000;
const MAX_ATTEMPTS: usize = 3;
const MAX_CATALOG_DEVICES: usize = 250;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
const MAX_MAX_TOKENS: u64 = 1_000_000;
const REASONING_EFFORTS: [&str; 3] = ["low", "medium", "high"];

/// Fallback context window used by the UI's approximate context meter when the
/// deployment did not configure the model's real window.
const DEFAULT_CONTEXT_WINDOW: u64 = 128_000;
const MIN_CONTEXT_WINDOW: u64 = 1_000;
const MAX_CONTEXT_WINDOW: u64 = 100_000_000;

/// History caps: the newest turns survive; older turns and oversized messages
/// are dropped before the provider sees them.
const MAX_HISTORY_MESSAGES: usize = 16;
const MAX_HISTORY_CHARS: usize = 8_000;
const MAX_HISTORY_MESSAGE_CHARS: usize = 2_000;
/// Rough token estimate used when the provider reports no usage.
const CHARS_PER_TOKEN: u64 = 4;

/// Cap on stored review artifacts (plans and light-state actions). Both are
/// ephemeral: never persisted, and reviewed in the session that produced them,
/// so the store only needs to hold what a user could still act on.
const MAX_STORED_REVIEWS: usize = 50;
/// Hard bound on operations in one plan; the provider envelope is rejected
/// beyond this without validating further.
const MAX_PLAN_OPERATIONS: usize = 40;
/// Plain explanation replies are prose, bounded like any other provider text.
const MAX_ANSWER_CHARS: usize = 4_000;
/// Deterministic search caps.
const MAX_SEARCH_RESULTS: usize = 30;
const MAX_CONTEXT_DEVICES: usize = 250;
const MAX_ENTITY_ID_CHARS: usize = 64;

/// Live-state context caps: attached and prompt-matched devices come first, and
/// the log tail is bounded so diagnostic questions stay affordable.
const MAX_LIVE_DEVICE_STATES: usize = 60;
const MAX_LIVE_LOGS: usize = 40;
const MAX_LIVE_LOG_CHARS: usize = 240;

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
    context_window: u64,
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
            context_window: source
                .u64("context_window", "HOMECTL_ASSISTANT_CONTEXT_WINDOW")
                .filter(|value| *value >= MIN_CONTEXT_WINDOW)
                .unwrap_or(DEFAULT_CONTEXT_WINDOW),
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
    use std::hash::{BuildHasher, Hash, Hasher};
    static HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
        once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);
    let source = setting_source(settings);
    let base_url = source.string("base_url", "HOMECTL_ASSISTANT_BASE_URL");
    let model = source.string("model", "HOMECTL_ASSISTANT_MODEL");
    let mut view = json!({
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
        "contextWindow": source
            .u64("context_window", "HOMECTL_ASSISTANT_CONTEXT_WINDOW")
            .filter(|value| *value >= MIN_CONTEXT_WINDOW)
            .unwrap_or(DEFAULT_CONTEXT_WINDOW),
        "timezone": source.string("timezone", "HOMECTL_ASSISTANT_TIMEZONE"),
    });
    // Process-keyed and secret-sensitive, without an exposed password digest.
    let mut hasher = HASHER.build_hasher();
    view.to_string().hash(&mut hasher);
    source
        .string("api_key", "HOMECTL_ASSISTANT_API_KEY")
        .hash(&mut hasher);
    settings
        .iter()
        .find(|row| row.key == ASSISTANT_SETTING_KEY)
        .map(|row| row.config.to_string())
        .hash(&mut hasher);
    view["revisionToken"] = json!(format!("{:016x}", hasher.finish()));
    view
}

/// Settings update from the settings form. An absent field keeps its stored
/// value; an empty string (or zero) clears it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistantSettingsPatch {
    expected: Option<Value>,
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
    context_window: Option<u64>,
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
    if let Some(value) = patch.context_window {
        set_stored_u64(
            &mut stored,
            "context_window",
            value,
            MIN_CONTEXT_WINDOW,
            MAX_CONTEXT_WINDOW,
            "contextWindow",
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
    let plans = Arc::new(PlanStore::new(MAX_STORED_REVIEWS));

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

    let apply = warp::path!("assistant" / "apply")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(apply_assistant_action);

    let search = warp::path!("assistant" / "search")
        .and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<AssistantSearchQuery>())
        .and(with_snapshot(snapshot))
        .and_then(search_assistant_entities);

    let plan = warp::path!("assistant" / "plan")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_plan_store(&plans))
        .and_then(plan_assistant_operations);

    let get_plan = warp::path!("assistant" / "plans" / String)
        .and(warp::path::end())
        .and(warp::get())
        .and(with_plan_store(&plans))
        .and_then(get_assistant_plan);

    let discard_plan = warp::path!("assistant" / "plans" / String)
        .and(warp::path::end())
        .and(warp::delete())
        .and(with_plan_store(&plans))
        .and_then(discard_assistant_plan);

    let apply_plan = warp::path!("assistant" / "plans" / String / "apply")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and(with_plan_store(&plans))
        .and_then(apply_assistant_plan);

    let chat = warp::path!("assistant" / "chat")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_plan_store(&plans))
        .and_then(chat_assistant);

    let threads_list = warp::path!("assistant" / "threads")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(list_assistant_threads);

    let thread_get = warp::path!("assistant" / "threads" / String)
        .and(warp::path::end())
        .and(warp::get())
        .and(with_plan_store(&plans))
        .and_then(get_assistant_thread);

    let thread_delete = warp::path!("assistant" / "threads" / String)
        .and(warp::path::end())
        .and(warp::delete())
        .and_then(delete_assistant_thread);

    let thread_outcome = warp::path!("assistant" / "threads" / String / "outcome")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and_then(record_assistant_thread_outcome);

    let apply_action = warp::path!("assistant" / "actions" / String / "apply")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::bytes())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and(with_plan_store(&plans))
        .and_then(apply_stored_action);

    let discard_action = warp::path!("assistant" / "actions" / String)
        .and(warp::path::end())
        .and(warp::delete())
        .and(with_plan_store(&plans))
        .and_then(discard_stored_action);

    status
        .or(settings_get)
        .or(settings_put)
        .or(draft)
        .or(apply)
        .or(search)
        .or(plan)
        .or(get_plan)
        .or(discard_plan)
        .or(apply_plan)
        .or(chat)
        .or(threads_list)
        .or(thread_get)
        .or(thread_delete)
        .or(thread_outcome)
        .or(apply_action)
        .or(discard_action)
}

fn with_plan_store(
    plans: &Arc<PlanStore>,
) -> impl Filter<Extract = (Arc<PlanStore>,), Error = Infallible> + Clone {
    let plans = plans.clone();
    warp::any().map(move || plans.clone())
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
    _snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let settings = &state.runtime_config.widget_settings;
                let current = assistant_settings_view(settings);
                if patch.expected.as_ref().is_some_and(|expected| {
                    expected.get("revisionToken") != current.get("revisionToken")
                }) {
                    return Err((
                        StatusCode::CONFLICT,
                        "Assistant settings changed elsewhere.".to_string(),
                        Some(current),
                    ));
                }
                let stored = settings
                    .iter()
                    .find(|row| row.key == ASSISTANT_SETTING_KEY)
                    .and_then(|row| row.config.as_object().cloned())
                    .unwrap_or_else(|| {
                        // The first database save takes ownership of all effective
                        // values, including an omitted deployment-provided key.
                        let mut stored = serde_json::Map::new();
                        for (stored_key, view_key) in [
                            ("base_url", "baseUrl"),
                            ("model", "model"),
                            ("reasoning_effort", "reasoningEffort"),
                            ("timezone", "timezone"),
                            ("max_tokens", "maxTokens"),
                            ("timeout_ms", "timeoutMs"),
                            ("context_window", "contextWindow"),
                        ] {
                            if !current[view_key].is_null() {
                                stored.insert(stored_key.into(), current[view_key].clone());
                            }
                        }
                        if let Some(key) =
                            setting_source(settings).string("api_key", "HOMECTL_ASSISTANT_API_KEY")
                        {
                            stored.insert("api_key".into(), json!(key));
                        }
                        stored
                    });
                let updated = apply_assistant_settings_patch(stored, patch)
                    .map_err(|error| (StatusCode::BAD_REQUEST, error, None))?;
                let setting = config_queries::WidgetSettingRow {
                    key: ASSISTANT_SETTING_KEY.into(),
                    config: Value::Object(updated),
                };
                state.upsert_widget_setting(setting.clone());
                Ok((
                    assistant_settings_view(&state.runtime_config.widget_settings),
                    setting,
                ))
            })
        })
        .await;
    let (response, persistence_setting) = match result {
        Ok(Ok(response)) => response,
        Ok(Err((status, error, current))) => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&json!({"success":false,"error":error,"current":current})),
                status,
            ))
        }
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
            Ok(completion) => completion.content,
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
                        "content": repair_feedback(&snapshot, &last_errors),
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

/// Token usage reported by the provider. Missing for providers that omit the
/// `usage` object; callers then estimate from character counts.
#[derive(Clone, Copy, Debug, Default)]
struct ProviderUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

impl ProviderUsage {
    fn from_value(value: &Value) -> Option<Self> {
        let usage = value.get("usage")?;
        let prompt_tokens = usage.get("prompt_tokens").and_then(Value::as_u64)?;
        let completion_tokens = usage
            .get("completion_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let total_tokens = usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(prompt_tokens + completion_tokens);
        Some(Self {
            prompt_tokens,
            completion_tokens,
            total_tokens,
        })
    }
}

/// One provider completion plus any usage it reported.
#[derive(Clone, Debug)]
struct Completion {
    content: String,
    usage: Option<ProviderUsage>,
}

async fn chat(
    config: &AssistantConfig,
    messages: &[Value],
    options: &mut ChatOptions,
    session_id: &str,
) -> Result<Completion, ProviderError> {
    loop {
        match post_chat(config, messages, *options, session_id).await {
            Ok(completion) => return Ok(completion),
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
) -> Result<Completion, ProviderError> {
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
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            ProviderError::Transport(
                "provider response had no choices[0].message.content".to_string(),
            )
        })?;
    Ok(Completion {
        content,
        usage: ProviderUsage::from_value(&value),
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

/// What to tell the model when a definition or plan fails validation: the
/// errors, the ids it may actually reference, and label→id hints. Without these
/// a repair turn can only guess again — the common failure is copying a display
/// name into an id field (`Patio lights` instead of `patio_lights`).
fn repair_feedback(snapshot: &RuntimeSnapshot, errors: &str) -> String {
    let config = &snapshot.runtime_config;
    let mut items: Vec<(String, String, String)> = Vec::new();
    for group in &config.groups {
        items.push((
            "group".to_string(),
            group.id.to_string(),
            group.name.clone(),
        ));
    }
    for scene in &config.scenes {
        items.push((
            "scene".to_string(),
            scene.id.to_string(),
            scene.name.clone(),
        ));
    }
    for helper in &config.helpers {
        items.push((
            "helper".to_string(),
            helper.id.to_string(),
            helper.name.clone(),
        ));
    }
    for source in &config.sources {
        items.push((
            "source".to_string(),
            source.id.to_string(),
            source.name.clone(),
        ));
    }
    for routine in &config.routines {
        items.push((
            "routine".to_string(),
            routine.id.to_string(),
            routine.name.clone(),
        ));
    }

    let lowered = errors.to_lowercase();
    let mut hints: Vec<String> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    for (kind, id, name) in items {
        ids.push(format!("{kind} '{id}'"));
        let name_lower = name.trim().to_lowercase();
        if !name_lower.is_empty()
            && name_lower != id.to_lowercase()
            && lowered.contains(&format!("'{name_lower}'"))
        {
            hints.push(format!("  '{name}' is a name, its id is '{id}'"));
        }
    }

    let mut device_keys = Vec::new();
    for (key, device) in snapshot.devices.0.iter().take(MAX_CATALOG_DEVICES) {
        let key = key.to_string();
        let name = device_label(snapshot, &key, &device.name)
            .trim()
            .to_lowercase();
        if !name.is_empty() && name != key.to_lowercase() && lowered.contains(&format!("'{name}'"))
        {
            hints.push(format!("  '{name}' is a name, its device key is '{key}'"));
        }
        device_keys.push(key);
    }

    let mut message = format!("That response failed validation:\n{errors}");
    if !hints.is_empty() {
        message.push_str("\n\nIdentifier corrections for the values above:\n");
        message.push_str(&hints.join("\n"));
    }
    message.push_str(&format!(
        "\n\nValid ids — reference these ids, never their display names:\n  {}\n  devices: {}\n\nReturn a corrected JSON object with the same contract.",
        ids.join("\n  "),
        device_keys.join(", ")
    ));
    message
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
                "name": device_label(snapshot, &key.to_string(), &device.name),
                "kind": "sensor",
                "state": sensor,
                "sensorConfiguration": snapshot.runtime_config.device_sensor_configs.iter().find(|row|row.device_ref == key.to_string()),
            }),
            DeviceData::Controllable(controllable) => json!({
                "deviceRef": device_ref,
                "key": key.to_string(),
                "name": device_label(snapshot, &key.to_string(), &device.name),
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
                "devices": group.devices,
                "linked_groups": group.linked_groups,
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

    let mut body_budget = 32 * 1024;
    let blocks: Vec<Value> = snapshot
        .runtime_config
        .blocks
        .iter()
        .map(|block| {
            let mut entry = json!({"id":block.id,"name":block.name,"description":block.description,
            "kind":block.kind,"inputs":block.inputs,"revision":block.revision,
            "implementation":if block.body["kind"] == "javascript" {"javascript"} else {"visual"},
            "output":block.body.get("output"),"functions":block.body.pointer("/spec/functions")});
            let bytes = serde_json::to_vec(&block.body)
                .map(|body| body.len())
                .unwrap_or(usize::MAX);
            if bytes <= 8 * 1024 && bytes <= body_budget {
                entry["body"] = block.body.clone();
                body_budget -= bytes;
            } else {
                entry["bodyOmitted"] = json!(true);
            }
            entry
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
                "readOnly": helper.compute.is_some(),
                "compute": helper.compute,
                "runtime": snapshot.helper_statuses.iter().find(|status|status.id == helper.id)
                    .map(|status|json!({"value":status.value,"revision":status.revision,"compute_status":status.compute_status})),
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
            "blocks": blocks,
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

/// Shared v2 schema reference for the routine draft and plan prompts.
const ROUTINE_DEFINITION_REFERENCE: &str = include_str!("assistant-automation-reference.md");

fn system_prompt(catalog_json: &str) -> String {
    format!(
        r#"You are the homectl routine drafting assistant. You translate a plain-language request into one homectl v2 routine definition.

Respond with a single JSON object and nothing else:
{{"name": "<short routine name>", "definition": <RoutineDefinitionV2>, "notes": "<optional assumptions>"}}

Rules:
- Only reference entities that appear in the CATALOG below. Never invent device ids, groups, scenes, helpers, sources, or routine ids. If a required entity is missing, explain it in "notes"; never silently substitute a different device or behavior. This endpoint drafts one routine only; new blocks/helpers require a reviewed configuration plan.
- Every node id ("id" on triggers, steps, and branches) must be a unique short string within the routine, e.g. "t1", "a1".
- Prefer native programs. Only use a script program when the request cannot be expressed natively.
- Schedules use six-field cron: "second minute hour day-of-month month day-of-week" and should include the timezone from the catalog.
- Conditions are three-valued; prefer explicit comparisons over implicit truthiness.

{ROUTINE_DEFINITION_REFERENCE}

CATALOG:
{catalog_json}"#
    )
}

const MAX_APPLY_CHANGES: usize = 24;
const MAX_APPLY_DEVICES: usize = 120;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyRequest {
    prompt: String,
    /// Optional scope (for example the floorplan selection). When present the
    /// model may only address these devices.
    #[serde(default)]
    device_keys: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ApplyEnvelope {
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    changes: Vec<ApplyChange>,
}

#[derive(Debug, Deserialize)]
struct ApplyChange {
    device_key: String,
    #[serde(default)]
    power: Option<bool>,
    #[serde(default)]
    brightness: Option<f64>,
    #[serde(default)]
    color: Option<ApplyColor>,
}

#[derive(Debug, Deserialize)]
struct ApplyColor {
    h: f64,
    s: f64,
}

/// Controllable devices plus their group names, for one-off light state
/// requests. Group membership lets the model resolve room names itself.
struct ControlCatalog {
    value: Value,
    devices: BTreeMap<String, DeviceKey>,
}

fn build_control_catalog(
    snapshot: &RuntimeSnapshot,
    scope: Option<&HashSet<String>>,
) -> ControlCatalog {
    let groups = &snapshot.runtime_config.groups;
    let mut devices = BTreeMap::new();
    let mut entries = Vec::new();

    for (key, device) in snapshot.devices.0.iter() {
        let key_string = key.to_string();
        if scope.is_some_and(|scope| !scope.contains(&key_string)) {
            continue;
        }
        let DeviceData::Controllable(data) = &device.data else {
            continue;
        };
        if device.is_readonly() || entries.len() >= MAX_APPLY_DEVICES {
            continue;
        }
        let rooms: Vec<&str> = groups
            .iter()
            .filter(|group| {
                group.devices.iter().any(|member| {
                    member.integration_id == key.integration_id.to_string()
                        && member.device_id == key.device_id.to_string()
                })
            })
            .map(|group| group.name.as_str())
            .collect();
        entries.push(json!({
            "device_key": key_string,
            "name": device_label(snapshot, &key_string, &device.name),
            "power": data.state.power,
            "brightness": data.state.brightness.map(|value| value.0),
            "color": data.state.color,
            "capabilities": {
                "brightness": data.capabilities.brightness,
                "color": data.capabilities.hs
                    || data.capabilities.rgb
                    || data.capabilities.xy
                    || data.capabilities.ct.is_some(),
            },
            "groups": rooms,
        }));
        devices.insert(key_string, key.clone());
    }

    let group_entries: Vec<Value> = groups
        .iter()
        .filter(|group| {
            group.devices.iter().any(|member| {
                devices.contains_key(&format!("{}/{}", member.integration_id, member.device_id))
            })
        })
        .map(|group| {
            json!({
                "name": group.name,
                "device_keys": group
                    .devices
                    .iter()
                    .map(|member| format!("{}/{}", member.integration_id, member.device_id))
                    .filter(|key| devices.contains_key(key))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();

    ControlCatalog {
        value: json!({ "devices": entries, "groups": group_entries }),
        devices,
    }
}

fn control_system_prompt(catalog_json: &str) -> String {
    format!(
        "You control smart lights in a home. You receive a catalog of controllable devices, \
         their current state, capabilities, and group names. Interpret the user's request and \
         reply with a single JSON object using exactly this contract:\n\
         {{\"summary\":\"one short sentence\",\"changes\":[{{\"device_key\":\"integration/device\",\"power\":true,\"brightness\":0.4,\"color\":{{\"h\":320,\"s\":0.8}}}}]}}\n\
         Rules:\n\
         - Only use device_key values from the catalog; never invent devices.\n\
         - Omit any field you do not want to change (for example set only color).\n\
         - brightness is 0..1; color h is 0..360 degrees and s is 0..1.\n\
         - Only set color when the device's capabilities.color is true.\n\
         - Resolve room or group names (for example \"living room\") to their member device_keys.\n\
         - If the request cannot be fulfilled with light state changes, return an empty changes \
         list and explain why in summary.\n\
         - Return only the JSON object, without markdown or code fences.\n\n\
         Catalog:\n{catalog_json}"
    )
}

fn parse_apply_envelope(content: &str) -> Result<ApplyEnvelope, String> {
    let value = extract_json_object(content)
        .ok_or_else(|| "Assistant response did not contain a JSON object".to_string())?;
    serde_json::from_value(value)
        .map_err(|error| format!("Assistant response did not match the contract: {error}"))
}

fn apply_change_to_action_change(change: &ApplyChange) -> AssistantActionChange {
    AssistantActionChange {
        device_key: change.device_key.clone(),
        name: None,
        power: change.power,
        brightness: change.brightness,
        color: change.color.as_ref().map(|color| AssistantActionColor {
            h: color.h,
            s: color.s,
        }),
    }
}

/// Validate and apply proposed light-state changes through the normal device
/// command path. Unknown devices and no-op changes are reported per entry
/// instead of failing the whole batch. Shared by the legacy one-off apply
/// endpoint and the stored-action quick apply.
async fn apply_device_changes(
    handle: &StateHandle,
    snapshot: &RuntimeSnapshot,
    catalog: &ControlCatalog,
    changes: &[AssistantActionChange],
) -> (Vec<AssistantActionChangeResult>, u32) {
    let mut results = Vec::with_capacity(changes.len());
    let mut applied_count = 0u32;
    for change in changes {
        let Some(device_key) = catalog.devices.get(&change.device_key).cloned() else {
            results.push(AssistantActionChangeResult {
                device_key: change.device_key.clone(),
                name: change.name.clone(),
                ok: false,
                error: Some("Unknown device".to_string()),
            });
            continue;
        };
        let name = snapshot
            .devices
            .0
            .get(&device_key)
            .map(|device| device_label(snapshot, &device_key.to_string(), &device.name))
            .or_else(|| change.name.clone());
        if change.power.is_none() && change.brightness.is_none() && change.color.is_none() {
            results.push(AssistantActionChangeResult {
                device_key: change.device_key.clone(),
                name,
                ok: false,
                error: Some("No changes supplied".to_string()),
            });
            continue;
        }

        let command = DeviceCommand {
            request_id: new_session_id(),
            device_key,
            power: change.power,
            brightness: change.brightness.map(|value| value.clamp(0.0, 1.0) as f32),
            color: change.color.as_ref().map(|color| {
                crate::types::color::DeviceColor::Hs(crate::types::color::Hs {
                    h: color.h.clamp(0.0, 360.0).round() as u64,
                    s: OrderedFloat(color.s.clamp(0.0, 1.0) as f32),
                })
            }),
            transition: Some(MANUAL_TRANSITION_SECONDS),
            preserve_scene: false,
        };
        let result = handle.control_device(command).await;
        let (ok, error) = match result {
            Ok(result) => (result.applied, result.error),
            Err(error) => (false, Some(error.to_string())),
        };
        if ok {
            applied_count += 1;
        }
        results.push(AssistantActionChangeResult {
            device_key: change.device_key.clone(),
            name,
            ok,
            error,
        });
    }
    (results, applied_count)
}

async fn apply_assistant_action(
    request: ApplyRequest,
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
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
    let Some(config) = AssistantConfig::from_settings(&snapshot.runtime_config.widget_settings)
    else {
        return Ok(error_response(
            "Assistant is not configured. Set the provider base URL and model in Settings.",
            StatusCode::SERVICE_UNAVAILABLE,
        ));
    };

    let scope = request
        .device_keys
        .map(|keys| keys.into_iter().collect::<HashSet<_>>())
        .filter(|scope| !scope.is_empty());
    let catalog = build_control_catalog(&snapshot, scope.as_ref());
    let catalog_json = serde_json::to_string(&catalog.value).unwrap_or_else(|_| "{}".to_string());

    let messages = vec![
        json!({ "role": "system", "content": control_system_prompt(&catalog_json) }),
        json!({ "role": "user", "content": prompt }),
    ];
    let mut options = ChatOptions {
        json_mode: true,
        reasoning_effort: config.reasoning_effort.is_some(),
    };
    let session_id = new_session_id();

    let content = match chat(&config, &messages, &mut options, &session_id).await {
        Ok(completion) => completion.content,
        Err(error) => return Ok(provider_error_response(error)),
    };
    let envelope = match parse_apply_envelope(&content) {
        Ok(envelope) => envelope,
        Err(error) => return Ok(error_response(&error, StatusCode::UNPROCESSABLE_ENTITY)),
    };
    if envelope.changes.len() > MAX_APPLY_CHANGES {
        return Ok(error_response(
            &format!("Assistant returned more than {MAX_APPLY_CHANGES} changes"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ));
    }

    let changes: Vec<AssistantActionChange> = envelope
        .changes
        .iter()
        .map(apply_change_to_action_change)
        .collect();
    let (results, applied_count) =
        apply_device_changes(&handle, &snapshot, &catalog, &changes).await;
    let applied: Vec<Value> = results
        .iter()
        .map(|result| {
            json!({
                "device_key": result.device_key,
                "name": result.name,
                "ok": result.ok,
                "error": result.error,
            })
        })
        .collect();

    Ok(ApiResponse::success(json!({
        "summary": envelope.summary,
        "applied": applied,
        "applied_count": applied_count,
        "model": config.model,
    })))
}

// ============================================================================
// Plan store
// ============================================================================

/// In-memory store for assistant plans and light-state actions. Both are
/// ephemeral review artifacts: never persisted, and dropped oldest-first once
/// the cap is exceeded. They deliberately do not expire on a timer — a proposal
/// the user is still looking at stays applicable for as long as the process
/// that produced it is running.
struct PlanStore {
    capacity: usize,
    plans: StdMutex<HashMap<String, AssistantPlan>>,
    actions: StdMutex<HashMap<String, AssistantAction>>,
}

impl PlanStore {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            plans: StdMutex::new(HashMap::new()),
            actions: StdMutex::new(HashMap::new()),
        }
    }

    fn insert_plan(&self, plan: AssistantPlan) {
        self.insert_capped(&self.plans, plan.plan_id.clone(), plan, |stored| {
            stored.created_at_ms
        });
    }

    fn get_plan(&self, plan_id: &str) -> Option<AssistantPlan> {
        self.plans
            .lock()
            .expect("plan store lock")
            .get(plan_id)
            .cloned()
    }

    /// Remove a plan once the user dismisses it. Applying keeps it.
    fn remove_plan(&self, plan_id: &str) -> Option<AssistantPlan> {
        self.plans.lock().expect("plan store lock").remove(plan_id)
    }

    fn insert_action(&self, action: AssistantAction) {
        self.insert_capped(&self.actions, action.action_id.clone(), action, |stored| {
            stored.created_at_ms
        });
    }

    fn get_action(&self, action_id: &str) -> Option<AssistantAction> {
        self.actions
            .lock()
            .expect("plan store lock")
            .get(action_id)
            .cloned()
    }

    fn remove_action(&self, action_id: &str) -> Option<AssistantAction> {
        self.actions
            .lock()
            .expect("plan store lock")
            .remove(action_id)
    }

    fn insert_capped<T>(
        &self,
        entries: &StdMutex<HashMap<String, T>>,
        key: String,
        value: T,
        created_at_ms: impl Fn(&T) -> i64,
    ) {
        let mut entries = entries.lock().expect("plan store lock");
        entries.insert(key, value);
        while entries.len() > self.capacity {
            // Evict the oldest artifact: the most recent proposal is the one a
            // user could still be reviewing.
            let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, stored)| created_at_ms(stored))
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            entries.remove(&oldest);
        }
    }

    #[cfg(test)]
    fn plan_len(&self) -> usize {
        self.plans.lock().expect("plan store lock").len()
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ============================================================================
// Deterministic entity search
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistantSearchQuery {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    q: Option<String>,
}

async fn search_assistant_entities(
    query: AssistantSearchQuery,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snapshot = snapshot.load();
    let kind = match query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
    {
        Some(raw) => match parse_entity_kind(raw) {
            Some(kind) => Some(kind),
            None => {
                return Ok(error_response(
                    &format!("unknown kind '{raw}'"),
                    StatusCode::BAD_REQUEST,
                ))
            }
        },
        None => None,
    };

    let query_text = query.q.unwrap_or_default();
    let results = match kind {
        Some(kind) => search_snapshot(&snapshot, kind, query_text.trim(), MAX_SEARCH_RESULTS),
        None => search_all_kinds(&snapshot, query_text.trim(), MAX_SEARCH_RESULTS),
    };
    Ok(ApiResponse::success(results))
}

fn parse_entity_kind(raw: &str) -> Option<AssistantEntityKind> {
    serde_json::from_value::<AssistantEntityKind>(Value::String(raw.to_lowercase())).ok()
}

fn kind_entities(
    snapshot: &RuntimeSnapshot,
    kind: AssistantEntityKind,
) -> Vec<(String, String, String)> {
    match kind {
        AssistantEntityKind::Routine => snapshot
            .runtime_config
            .routines
            .iter()
            .map(|routine| {
                let version = if routine.definition_v2.is_some() {
                    "v2"
                } else {
                    "v1"
                };
                let state = if routine.enabled {
                    "enabled"
                } else {
                    "disabled"
                };
                (
                    routine.id.clone(),
                    routine.name.clone(),
                    format!("{version} routine · {state}"),
                )
            })
            .collect(),
        AssistantEntityKind::Scene => snapshot
            .runtime_config
            .scenes
            .iter()
            .map(|scene| {
                (
                    scene.id.clone(),
                    scene.name.clone(),
                    format!(
                        "scene · {} target(s)",
                        scene.device_states.len() + scene.group_states.len()
                    ),
                )
            })
            .collect(),
        AssistantEntityKind::Group => snapshot
            .runtime_config
            .groups
            .iter()
            .map(|group| {
                (
                    group.id.clone(),
                    group.name.clone(),
                    format!("group · {} device(s)", group.devices.len()),
                )
            })
            .collect(),
        AssistantEntityKind::Device => snapshot
            .devices
            .0
            .iter()
            .map(|(key, device)| {
                let kind = match &device.data {
                    DeviceData::Sensor(_) => "sensor",
                    DeviceData::Controllable(_) => "controllable",
                };
                (
                    key.to_string(),
                    device.name.clone(),
                    format!("device · {kind}"),
                )
            })
            .collect(),
        AssistantEntityKind::Floorplan => list_runtime_floorplans(&snapshot.runtime_config)
            .into_iter()
            .map(|floorplan| (floorplan.id, floorplan.name, "floorplan".to_string()))
            .collect(),
        AssistantEntityKind::Integration => snapshot
            .runtime_config
            .integrations
            .iter()
            .map(|integration| {
                let state = if integration.enabled {
                    "enabled"
                } else {
                    "disabled"
                };
                (
                    integration.id.clone(),
                    integration.id.clone(),
                    format!("{} integration · {state}", integration.plugin),
                )
            })
            .collect(),
        AssistantEntityKind::Block => snapshot
            .runtime_config
            .blocks
            .iter()
            .map(|block| {
                (
                    block.id.clone(),
                    block.name.clone(),
                    format!(
                        "{} block · {}",
                        serde_json::to_value(block.kind).unwrap().as_str().unwrap(),
                        block.description
                    ),
                )
            })
            .collect(),
        AssistantEntityKind::Helper => snapshot
            .runtime_config
            .helpers
            .iter()
            .map(|helper| {
                (
                    helper.id.0.clone(),
                    helper.name.clone(),
                    format!(
                        "{} {}helper",
                        helper.kind.code(),
                        if helper.compute.is_some() {
                            "computed "
                        } else {
                            ""
                        }
                    ),
                )
            })
            .collect(),
        AssistantEntityKind::ComputedSource => snapshot
            .runtime_config
            .sources
            .iter()
            .map(|source| {
                let state = if source.enabled {
                    "enabled"
                } else {
                    "disabled"
                };
                (
                    source.id.0.clone(),
                    source.name.clone(),
                    format!("computed source · {state}"),
                )
            })
            .collect(),
    }
}

/// Exact match ranks above prefix, which ranks above substring.
fn match_rank(haystack: &str, needle: &str) -> Option<u8> {
    let haystack = haystack.to_lowercase();
    let needle = needle.to_lowercase();
    if needle.is_empty() {
        return Some(2);
    }
    if haystack == needle {
        Some(0)
    } else if haystack.starts_with(&needle) {
        Some(1)
    } else if haystack.contains(&needle) {
        Some(2)
    } else {
        None
    }
}

fn entity_rank(id: &str, label: &str, needle: &str) -> Option<u8> {
    [id, label]
        .iter()
        .filter_map(|value| match_rank(value, needle))
        .min()
}

fn sort_ranked(ranked: &mut [(u8, AssistantSearchResult)]) {
    ranked.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.kind.code().cmp(right.1.kind.code()))
            .then(left.1.id.cmp(&right.1.id))
    });
}

fn rank_entities(
    snapshot: &RuntimeSnapshot,
    kinds: &[AssistantEntityKind],
    needle: &str,
) -> Vec<(u8, AssistantSearchResult)> {
    let mut ranked = Vec::new();
    for kind in kinds {
        for (id, label, summary) in kind_entities(snapshot, *kind) {
            let Some(rank) = entity_rank(&id, &label, needle) else {
                continue;
            };
            ranked.push((
                rank,
                AssistantSearchResult {
                    kind: *kind,
                    id,
                    label,
                    summary,
                },
            ));
        }
    }
    sort_ranked(&mut ranked);
    ranked
}

fn search_snapshot(
    snapshot: &RuntimeSnapshot,
    kind: AssistantEntityKind,
    query: &str,
    cap: usize,
) -> Vec<AssistantSearchResult> {
    rank_entities(snapshot, &[kind], query)
        .into_iter()
        .take(cap)
        .map(|(_, result)| result)
        .collect()
}

fn search_all_kinds(
    snapshot: &RuntimeSnapshot,
    query: &str,
    cap: usize,
) -> Vec<AssistantSearchResult> {
    rank_entities(snapshot, &AssistantEntityKind::searchable(), query)
        .into_iter()
        .take(cap)
        .map(|(_, result)| result)
        .collect()
}

fn prompt_tokens(prompt: &str) -> Vec<String> {
    let mut tokens: Vec<String> = prompt
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '-'
        })
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.chars().count() >= 2)
        .collect();
    tokens.sort();
    tokens.dedup();
    tokens
}

/// Deterministic prompt search used to build unattached context: tokenize the
/// prompt, rank every entity by its best token match, keep the top matches.
fn search_prompt(snapshot: &RuntimeSnapshot, prompt: &str) -> Vec<AssistantSearchResult> {
    use std::collections::hash_map::Entry;

    let tokens = prompt_tokens(prompt);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut best: HashMap<(String, String), (u8, AssistantSearchResult)> = HashMap::new();
    for token in &tokens {
        for (rank, result) in rank_entities(snapshot, &AssistantEntityKind::searchable(), token) {
            let key = (result.kind.code().to_string(), result.id.clone());
            match best.entry(key) {
                Entry::Occupied(mut entry) => {
                    if rank < entry.get().0 {
                        entry.insert((rank, result));
                    }
                }
                Entry::Vacant(entry) => {
                    entry.insert((rank, result));
                }
            }
        }
    }

    let mut ranked: Vec<(u8, AssistantSearchResult)> = best.into_values().collect();
    sort_ranked(&mut ranked);
    ranked.truncate(MAX_SEARCH_RESULTS);
    ranked.into_iter().map(|(_, result)| result).collect()
}

// ============================================================================
// Plan endpoint
// ============================================================================

#[derive(Debug, Deserialize)]
struct ProviderPlan {
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    operations: Vec<ProviderOperation>,
}

#[derive(Debug, Deserialize)]
struct ProviderOperation {
    op: AssistantOpKind,
    kind: AssistantEntityKind,
    #[serde(default, alias = "targetId")]
    target_id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    after: Option<Value>,
    #[serde(default)]
    warnings: Vec<String>,
}

fn parse_plan_envelope(content: &str) -> Result<ProviderPlan, String> {
    let value = extract_json_object(content)
        .ok_or_else(|| "Assistant response did not contain a JSON object".to_string())?;
    serde_json::from_value(value)
        .map_err(|error| format!("Assistant plan did not match the contract: {error}"))
}

async fn plan_assistant_operations(
    request: AssistantPlanRequest,
    snapshot: SnapshotHandle,
    plans: Arc<PlanStore>,
) -> Result<impl Reply, warp::Rejection> {
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
    let Some(config) = AssistantConfig::from_settings(&snapshot.runtime_config.widget_settings)
    else {
        return Ok(error_response(
            "Assistant is not configured. Set the provider base URL and model in Settings.",
            StatusCode::SERVICE_UNAVAILABLE,
        ));
    };

    let context = match build_plan_context(&snapshot, &request.attachments, prompt) {
        Ok(context) => context,
        Err(error) => return Ok(error_response(&error, StatusCode::UNPROCESSABLE_ENTITY)),
    };
    let context_json = serde_json::to_string(&context).unwrap_or_else(|_| "{}".to_string());
    let catalog = catalog_from_snapshot_export(&snapshot);

    let mut messages =
        vec![json!({ "role": "system", "content": plan_system_prompt(&context_json) })];
    messages.extend(history_messages(
        request.history.as_deref().unwrap_or_default(),
    ));
    messages.push(json!({ "role": "user", "content": prompt }));
    let mut options = ChatOptions {
        json_mode: true,
        reasoning_effort: config.reasoning_effort.is_some(),
    };
    let session_id = new_session_id();
    let mut last_errors = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        let content = match chat(&config, &messages, &mut options, &session_id).await {
            Ok(completion) => completion.content,
            Err(error) => return Ok(provider_error_response(error)),
        };

        let validated = parse_plan_envelope(&content).and_then(|provider| {
            if provider.operations.len() > MAX_PLAN_OPERATIONS {
                return Err(format!(
                    "Assistant returned more than {MAX_PLAN_OPERATIONS} operations"
                ));
            }
            validate_plan_operations(&snapshot, catalog.clone(), provider)
        });

        match validated {
            Ok((summary, operations)) => {
                let now = now_ms();
                let plan = AssistantPlan {
                    plan_id: format!("plan-{}", new_session_id()),
                    summary,
                    operations,
                    created_at_ms: now,
                };
                plans.insert_plan(plan.clone());
                return Ok(ApiResponse::success(plan));
            }
            Err(errors) => {
                last_errors = errors;
                if attempt < MAX_ATTEMPTS {
                    messages.push(json!({ "role": "assistant", "content": content }));
                    messages.push(json!({
                        "role": "user",
                        "content": repair_feedback(&snapshot, &last_errors),
                    }));
                }
            }
        }
    }

    Ok(error_response(
        &format!("Assistant could not produce a valid plan: {last_errors}"),
        StatusCode::UNPROCESSABLE_ENTITY,
    ))
}

async fn get_assistant_plan(
    plan_id: String,
    plans: Arc<PlanStore>,
) -> Result<impl Reply, warp::Rejection> {
    match plans.get_plan(&plan_id) {
        Some(plan) => Ok(ApiResponse::success(plan)),
        None => Ok(not_found("Assistant plan")),
    }
}

/// Discard a stored plan without applying it. The UI calls this when the user
/// dismisses a review card; unknown ids are a clean 404.
async fn discard_assistant_plan(
    plan_id: String,
    plans: Arc<PlanStore>,
) -> Result<impl Reply, warp::Rejection> {
    match plans.remove_plan(&plan_id) {
        Some(_) => Ok(ApiResponse::success(true)),
        None => Ok(not_found("Assistant plan")),
    }
}

// ============================================================================
// Persisted conversation threads
// ============================================================================

/// Record the result of applying a stored proposal against the thread turn that
/// proposed it, so a reopened conversation shows the same applied state.
async fn record_assistant_thread_outcome(
    thread_id: String,
    request: AssistantThreadOutcomeRequest,
) -> Result<warp::reply::Response, warp::Rejection> {
    let Some(mut thread) = config_queries::db_load_assistant_thread(&thread_id)
        .await
        .ok()
        .flatten()
    else {
        return Ok(not_found("Assistant thread").into_response());
    };

    let mut recorded = false;
    for message in thread.messages.iter_mut() {
        let matching = message
            .proposal
            .as_ref()
            .map(assistant_proposal_id)
            .is_some_and(|id| id == request.proposal_id);
        if matching {
            message.outcome = Some(request.outcome.clone());
            recorded = true;
        }
    }
    if !recorded {
        return Ok(not_found("Assistant thread turn").into_response());
    }

    thread.updated_at_ms = now_ms();
    if let Err(error) = config_queries::db_save_assistant_thread(&thread).await {
        log::warn!("Failed to record assistant thread outcome {thread_id}: {error}");
        return Ok(ApiResponse::success(json!({ "recorded": false })).into_response());
    }
    Ok(ApiResponse::success(json!({ "recorded": true })).into_response())
}

async fn list_assistant_threads() -> Result<warp::reply::Response, warp::Rejection> {
    match config_queries::db_list_assistant_threads().await {
        Ok(threads) => Ok(ApiResponse::success(threads).into_response()),
        Err(error) => Ok(error_response(
            &format!("Failed to list assistant threads: {error}"),
            StatusCode::INTERNAL_SERVER_ERROR,
        )
        .into_response()),
    }
}

async fn get_assistant_thread(
    thread_id: String,
    plans: Arc<PlanStore>,
) -> Result<warp::reply::Response, warp::Rejection> {
    match config_queries::db_load_assistant_thread(&thread_id).await {
        Ok(Some(thread)) => {
            // Proposals live in an in-memory store for as long as the server
            // runs while threads are persisted, so a conversation reopened
            // after a restart would otherwise offer "Apply again" buttons that
            // can only answer with a 404.
            restore_thread_proposals(&plans, &thread);
            Ok(ApiResponse::success(thread).into_response())
        }
        Ok(None) => Ok(not_found("Assistant thread").into_response()),
        Err(error) => Ok(error_response(
            &format!("Failed to load assistant thread: {error}"),
            StatusCode::INTERNAL_SERVER_ERROR,
        )
        .into_response()),
    }
}

/// Re-register the proposals stored on a thread's turns.
fn restore_thread_proposals(plans: &PlanStore, thread: &AssistantThread) {
    for message in &thread.messages {
        match &message.proposal {
            Some(AssistantThreadProposal::Plan { plan }) => plans.insert_plan(plan.clone()),
            Some(AssistantThreadProposal::Action { action }) => plans.insert_action(action.clone()),
            None => {}
        }
    }
}

async fn delete_assistant_thread(
    thread_id: String,
) -> Result<warp::reply::Response, warp::Rejection> {
    match config_queries::db_delete_assistant_thread(&thread_id).await {
        Ok(true) => Ok(ApiResponse::success(true).into_response()),
        Ok(false) => Ok(not_found("Assistant thread").into_response()),
        Err(error) => Ok(error_response(
            &format!("Failed to delete assistant thread: {error}"),
            StatusCode::INTERNAL_SERVER_ERROR,
        )
        .into_response()),
    }
}

// ============================================================================
// Unified streaming chat
// ============================================================================

/// SSE event names emitted by `POST /assistant/chat`.
const CHAT_EVENT_STATUS: &str = "status";
const CHAT_EVENT_DELTA: &str = "delta";
const CHAT_EVENT_USAGE: &str = "usage";
const CHAT_EVENT_PLAN: &str = "plan";
const CHAT_EVENT_ACTION: &str = "action";
const CHAT_EVENT_ANSWER: &str = "answer";
const CHAT_EVENT_THREAD: &str = "thread";
const CHAT_EVENT_ERROR: &str = "error";

/// Cap and normalize client-held conversation history. The newest turns are
/// kept; oversized messages are truncated and older ones dropped server-side.
fn history_messages(history: &[AssistantHistoryMessage]) -> Vec<Value> {
    let mut selected: Vec<Value> = Vec::new();
    let mut chars = 0usize;
    for message in history.iter().rev() {
        if selected.len() >= MAX_HISTORY_MESSAGES {
            break;
        }
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        let content = truncate(content, MAX_HISTORY_MESSAGE_CHARS);
        let content_chars = content.chars().count();
        if chars + content_chars > MAX_HISTORY_CHARS && !selected.is_empty() {
            break;
        }
        chars += content_chars;
        selected.push(json!({
            "role": message.role.code(),
            "content": content,
        }));
    }
    selected.reverse();
    selected
}

fn estimate_tokens(chars: usize) -> u64 {
    (chars as u64).div_ceil(CHARS_PER_TOKEN)
}

fn message_content_chars(message: &Value) -> usize {
    message
        .get("content")
        .and_then(Value::as_str)
        .map(|content| content.chars().count())
        .unwrap_or(0)
}

/// Approximate context usage for one turn: provider-reported when available,
/// character-based estimate otherwise.
fn assistant_usage(
    config: &AssistantConfig,
    completion: &Completion,
    messages: &[Value],
) -> AssistantUsage {
    if let Some(usage) = completion.usage {
        return AssistantUsage {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            context_window: config.context_window,
            approximate: false,
        };
    }
    let prompt_tokens = estimate_tokens(messages.iter().map(message_content_chars).sum());
    let completion_tokens = estimate_tokens(completion.content.chars().count());
    AssistantUsage {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        context_window: config.context_window,
        approximate: true,
    }
}

fn provider_error_message(error: &ProviderError) -> String {
    match error {
        ProviderError::Status(status, body) => {
            log::warn!("Assistant provider returned {status}: {body}");
            format!("Assistant provider returned HTTP {status}")
        }
        ProviderError::Transport(message) => {
            log::warn!("Assistant provider request failed: {message}");
            "Assistant provider request failed".to_string()
        }
    }
}

/// Provider deltas + progress states for one turn.
#[derive(Debug)]
enum ChatStreamError {
    Provider(ProviderError),
    Cancelled,
}

/// SSE frames parsed from a provider stream.
#[derive(Debug)]
enum SseFrame {
    Delta(String),
    Usage(ProviderUsage),
    Done,
    Ignore,
}

/// Pull complete `\n\n`-separated frames out of the byte buffer. Decoding
/// happens per frame so multi-byte characters split across HTTP chunks are
/// reassembled before lossy UTF-8 conversion.
fn drain_sse_frames(buffer: &mut Vec<u8>) -> Vec<SseFrame> {
    let mut frames = Vec::new();
    while let Some(position) = buffer.windows(2).position(|window| window == b"\n\n") {
        let frame: Vec<u8> = buffer.drain(..position + 2).collect();
        frames.push(parse_sse_frame(&String::from_utf8_lossy(
            &frame[..position],
        )));
    }
    frames
}

fn parse_sse_frame(frame: &str) -> SseFrame {
    let mut data = String::new();
    let mut has_data = false;
    for line in frame.lines() {
        let line = line.trim_end_matches('\r');
        let Some(rest) = line.strip_prefix("data:") else {
            continue;
        };
        has_data = true;
        if !data.is_empty() {
            data.push('\n');
        }
        data.push_str(rest.trim_start());
    }
    if !has_data {
        return SseFrame::Ignore;
    }
    if data.trim() == "[DONE]" {
        return SseFrame::Done;
    }
    let Ok(value) = serde_json::from_str::<Value>(&data) else {
        return SseFrame::Ignore;
    };
    if let Some(text) = value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
    {
        if !text.is_empty() {
            return SseFrame::Delta(text.to_string());
        }
    }
    if let Some(usage) = ProviderUsage::from_value(&value) {
        return SseFrame::Usage(usage);
    }
    SseFrame::Ignore
}

/// Sends SSE frames to the response body. A failed send means the client went
/// away, which cancels the turn; the cancellation watch also aborts in-flight
/// provider requests.
struct EventSink {
    tx: mpsc::Sender<Bytes>,
    cancel: watch::Receiver<bool>,
}

impl EventSink {
    fn is_cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    async fn wait_cancelled(&mut self) {
        while !*self.cancel.borrow() {
            if self.cancel.changed().await.is_err() {
                return;
            }
        }
    }

    async fn send(&self, event: &str, data: &Value) -> bool {
        if self.is_cancelled() {
            return false;
        }
        let payload = format!("event: {event}\ndata: {data}\n\n");
        self.tx.send(Bytes::from(payload)).await.is_ok()
    }
}

fn chat_stream_request_body(
    config: &AssistantConfig,
    messages: &[Value],
    options: ChatOptions,
) -> Value {
    let mut body = chat_request_body(config, messages, options);
    body["stream"] = json!(true);
    body["stream_options"] = json!({ "include_usage": true });
    body
}

/// Request a streaming provider completion, forwarding deltas through the
/// sink. Providers that reject or ignore streaming fall back to the regular
/// non-streaming path (progress states are still streamed to the UI).
async fn chat_streaming(
    sink: &mut EventSink,
    config: &AssistantConfig,
    messages: &[Value],
    options: &mut ChatOptions,
    session_id: &str,
) -> Result<Completion, ChatStreamError> {
    let body = chat_stream_request_body(config, messages, *options);
    let mut request = http_client()
        .post(config.chat_completions_url())
        .header(reqwest::header::USER_AGENT, user_agent())
        .header("x-opencode-session", session_id)
        .json(&body);
    if let Some(api_key) = &config.api_key {
        request = request.bearer_auth(api_key);
    }

    let mut response = tokio::select! {
        _ = sink.wait_cancelled() => return Err(ChatStreamError::Cancelled),
        result = tokio::time::timeout(Duration::from_millis(config.timeout_ms), request.send()) => {
            match result {
                Err(_) => {
                    return Err(ChatStreamError::Provider(ProviderError::Transport(
                        format!("timed out after {} ms", config.timeout_ms),
                    )));
                }
                Ok(Err(error)) => {
                    return Err(ChatStreamError::Provider(ProviderError::Transport(
                        error.to_string(),
                    )));
                }
                Ok(Ok(response)) => response,
            }
        }
    };

    let status = response.status();
    if !status.is_success() {
        // Streaming is a provider capability, not a correctness requirement:
        // fall back to the non-streaming call so json_mode/reasoning retries
        // still apply. Progress states keep the UI informed.
        log::warn!(
            "Assistant streaming request returned HTTP {status}; falling back to non-streaming"
        );
        let completion = tokio::select! {
            _ = sink.wait_cancelled() => return Err(ChatStreamError::Cancelled),
            result = chat(config, messages, options, session_id) => {
                result.map_err(ChatStreamError::Provider)?
            }
        };
        return Ok(completion);
    }

    let streaming = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));
    if !streaming {
        let text = tokio::select! {
            _ = sink.wait_cancelled() => return Err(ChatStreamError::Cancelled),
            result = response.text() => {
                result.map_err(|error| ChatStreamError::Provider(ProviderError::Transport(error.to_string())))?
            }
        };
        let value: Value = serde_json::from_str(&text).map_err(|error| {
            ChatStreamError::Provider(ProviderError::Transport(format!(
                "invalid provider response: {error}"
            )))
        })?;
        let content = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                ChatStreamError::Provider(ProviderError::Transport(
                    "provider response had no choices[0].message.content".to_string(),
                ))
            })?;
        return Ok(Completion {
            content,
            usage: ProviderUsage::from_value(&value),
        });
    }

    let mut buffer: Vec<u8> = Vec::new();
    let mut content = String::new();
    let mut usage = None;
    let mut done = false;
    while !done {
        let chunk = tokio::select! {
            _ = sink.wait_cancelled() => return Err(ChatStreamError::Cancelled),
            chunk = response.chunk() => {
                chunk.map_err(|error| ChatStreamError::Provider(ProviderError::Transport(error.to_string())))?
            }
        };
        let Some(chunk) = chunk else { break };
        buffer.extend_from_slice(&chunk);
        for frame in drain_sse_frames(&mut buffer) {
            match frame {
                SseFrame::Delta(text) => {
                    content.push_str(&text);
                    if !sink.send(CHAT_EVENT_DELTA, &json!({ "text": text })).await {
                        return Err(ChatStreamError::Cancelled);
                    }
                }
                SseFrame::Usage(reported) => usage = Some(reported),
                SseFrame::Done => done = true,
                SseFrame::Ignore => {}
            }
        }
    }

    Ok(Completion { content, usage })
}

/// Validated unified response: a configuration plan, a light-state action, or
/// a plain explanation. Plans and actions are stored for review before
/// anything is written; answers write nothing.
enum ChatOutcome {
    Plan {
        summary: String,
        operations: Vec<AssistantOperation>,
    },
    Action {
        summary: String,
        changes: Vec<AssistantActionChange>,
    },
    Answer {
        text: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ChatEnvelopeKind {
    Action,
    Plan,
    Answer,
}

/// Unified provider envelope. `kind` routes to the plan contract
/// (`operations`), the light-state action contract (`changes`), or a plain
/// `answer`; when it is absent, the populated field decides.
#[derive(Debug, Deserialize)]
struct ChatEnvelope {
    #[serde(default)]
    kind: Option<ChatEnvelopeKind>,
    #[serde(default, alias = "threadName")]
    thread_name: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    changes: Vec<ApplyChange>,
    #[serde(default)]
    operations: Vec<ProviderOperation>,
    #[serde(default, alias = "text")]
    answer: Option<String>,
}

fn parse_chat_envelope(content: &str) -> Result<ChatEnvelope, String> {
    let value = extract_json_object(content)
        .ok_or_else(|| "Assistant response did not contain a JSON object".to_string())?;
    serde_json::from_value(value)
        .map_err(|error| format!("Assistant response did not match the contract: {error}"))
}

fn validate_action_changes(
    snapshot: &RuntimeSnapshot,
    control: &ControlCatalog,
    changes: &[ApplyChange],
) -> Result<Vec<AssistantActionChange>, String> {
    let mut validated = Vec::with_capacity(changes.len());
    for change in changes {
        let device_key = change.device_key.trim().to_string();
        let Some(key) = control.devices.get(&device_key) else {
            return Err(format!("unknown device key '{device_key}'"));
        };
        if change.power.is_none() && change.brightness.is_none() && change.color.is_none() {
            return Err(format!("change for '{device_key}' has no state fields"));
        }
        validated.push(AssistantActionChange {
            device_key,
            name: snapshot
                .devices
                .0
                .get(key)
                .map(|device| device.name.clone()),
            power: change.power,
            brightness: change.brightness.map(|value| value.clamp(0.0, 1.0)),
            color: change.color.as_ref().map(|color| AssistantActionColor {
                h: color.h.clamp(0.0, 360.0),
                s: color.s.clamp(0.0, 1.0),
            }),
        });
    }
    Ok(validated)
}

fn build_chat_outcome(
    snapshot: &RuntimeSnapshot,
    catalog: ConfigCatalog,
    control: &ControlCatalog,
    envelope: ChatEnvelope,
) -> Result<ChatOutcome, String> {
    let kind = envelope.kind.unwrap_or(if !envelope.operations.is_empty() {
        ChatEnvelopeKind::Plan
    } else if !envelope.changes.is_empty() {
        ChatEnvelopeKind::Action
    } else if envelope.answer.is_some() {
        ChatEnvelopeKind::Answer
    } else {
        ChatEnvelopeKind::Plan
    });
    let summary = envelope
        .summary
        .map(|summary| summary.trim().to_string())
        .filter(|summary| !summary.is_empty());

    match kind {
        ChatEnvelopeKind::Plan => {
            if envelope.operations.len() > MAX_PLAN_OPERATIONS {
                return Err(format!(
                    "Assistant returned more than {MAX_PLAN_OPERATIONS} operations"
                ));
            }
            let provider = ProviderPlan {
                summary,
                operations: envelope.operations,
            };
            let (summary, operations) = validate_plan_operations(snapshot, catalog, provider)?;
            Ok(ChatOutcome::Plan {
                summary,
                operations,
            })
        }
        ChatEnvelopeKind::Action => {
            if envelope.changes.len() > MAX_APPLY_CHANGES {
                return Err(format!(
                    "Assistant returned more than {MAX_APPLY_CHANGES} changes"
                ));
            }
            let changes = validate_action_changes(snapshot, control, &envelope.changes)?;
            let summary =
                summary.unwrap_or_else(|| format!("{} proposed light change(s)", changes.len()));
            Ok(ChatOutcome::Action { summary, changes })
        }
        ChatEnvelopeKind::Answer => {
            let text = envelope
                .answer
                .map(|answer| answer.trim().to_string())
                .filter(|answer| !answer.is_empty())
                .ok_or_else(|| "Assistant answer was empty".to_string())?;
            Ok(ChatOutcome::Answer {
                text: truncate(&text, MAX_ANSWER_CHARS),
            })
        }
    }
}

/// `POST /assistant/chat` handler. Returns immediately with an SSE response;
/// the provider turn runs in a spawned task that stops when the client
/// disconnects.
async fn chat_assistant(
    request: AssistantChatRequest,
    snapshot: SnapshotHandle,
    plans: Arc<PlanStore>,
) -> Result<warp::reply::Response, warp::Rejection> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Ok(error_response("prompt is required", StatusCode::BAD_REQUEST).into_response());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Ok(error_response(
            &format!("prompt must be at most {MAX_PROMPT_CHARS} characters"),
            StatusCode::BAD_REQUEST,
        )
        .into_response());
    }
    if AssistantConfig::from_settings(&snapshot.load().runtime_config.widget_settings).is_none() {
        return Ok(error_response(
            "Assistant is not configured. Set the provider base URL and model in Settings.",
            StatusCode::SERVICE_UNAVAILABLE,
        )
        .into_response());
    }

    let (tx, rx) = mpsc::channel::<Bytes>(64);
    let (cancel_tx, cancel_rx) = watch::channel(false);
    tokio::spawn(run_assistant_chat(snapshot, plans, request, tx, cancel_rx));

    let stream = CancelOnDrop {
        inner: ReceiverStream::new(rx).map(Ok::<Bytes, Infallible>),
        cancel: cancel_tx,
    };
    let body = warp::hyper::Body::wrap_stream(stream);
    let response = warp::http::Response::builder()
        .status(StatusCode::OK)
        .header(
            warp::http::header::CONTENT_TYPE,
            "text/event-stream; charset=utf-8",
        )
        .header(warp::http::header::CACHE_CONTROL, "no-cache")
        .body(body)
        .expect("assistant SSE response");
    Ok(response)
}

/// Streams the response body while holding the cancellation guard: dropping
/// the body (client disconnect, server shutdown) stops the provider work.
struct CancelOnDrop<S> {
    inner: S,
    cancel: watch::Sender<bool>,
}

impl<S: Stream + Unpin> Stream for CancelOnDrop<S> {
    type Item = S::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner).poll_next(cx)
    }
}

impl<S> Drop for CancelOnDrop<S> {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
    }
}

async fn run_assistant_chat(
    snapshot: SnapshotHandle,
    plans: Arc<PlanStore>,
    request: AssistantChatRequest,
    tx: mpsc::Sender<Bytes>,
    cancel: watch::Receiver<bool>,
) {
    let mut sink = EventSink { tx, cancel };
    let prompt = request.prompt.trim().to_string();

    // Continue a persisted thread when asked; otherwise start a fresh one that
    // is persisted on the first successful turn.
    let thread_id = request
        .thread_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("thread-{}", new_session_id()));
    let stored_thread = match config_queries::db_load_assistant_thread(&thread_id).await {
        Ok(thread) => thread,
        Err(error) => {
            log::warn!("Failed to load assistant thread {thread_id}: {error}");
            None
        }
    };
    // The proposals on those turns live in memory only; make sure continuing a
    // conversation after a restart still offers applies that can succeed.
    if let Some(thread) = stored_thread.as_ref() {
        restore_thread_proposals(&plans, thread);
    }
    let mut thread_messages: Vec<AssistantHistoryMessage> = stored_thread
        .as_ref()
        .map(|thread| thread.messages.clone())
        .unwrap_or_default();
    let thread_created_at_ms = stored_thread.as_ref().map(|thread| thread.created_at_ms);
    let stored_thread_name = stored_thread
        .as_ref()
        .map(|thread| thread.name.trim().to_string())
        .filter(|name| !name.is_empty());
    let provisional_name = stored_thread_name
        .clone()
        .unwrap_or_else(|| default_thread_name(&prompt));
    let _ = sink
        .send(
            CHAT_EVENT_THREAD,
            &json!({ "id": thread_id, "name": provisional_name }),
        )
        .await;

    let live = snapshot.load();
    let Some(config) = AssistantConfig::from_settings(&live.runtime_config.widget_settings) else {
        return;
    };
    let context = match build_plan_context(&live, &request.attachments, &prompt) {
        Ok(context) => context,
        Err(error) => {
            sink.send(CHAT_EVENT_ERROR, &json!({ "message": error }))
                .await;
            return;
        }
    };
    let scope: HashSet<String> = request
        .device_keys
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect();
    let scope = (!scope.is_empty()).then_some(scope);
    let control = build_control_catalog(&live, scope.as_ref());
    let catalog = catalog_from_snapshot_export(&live);

    if !sink
        .send(
            CHAT_EVENT_STATUS,
            &json!({ "phase": "context", "message": "Gathering context…" }),
        )
        .await
    {
        return;
    }

    let context_json = serde_json::to_string(&json!({
        "config": context,
        "controllable_devices": control.value,
    }))
    .unwrap_or_else(|_| "{}".to_string());

    let mut messages = vec![json!({
        "role": "system",
        "content": chat_system_prompt(&context_json),
    })];
    messages.extend(history_messages(if thread_messages.is_empty() {
        request.history.as_deref().unwrap_or_default()
    } else {
        thread_messages.as_slice()
    }));
    messages.push(json!({ "role": "user", "content": prompt }));

    let mut options = ChatOptions {
        json_mode: true,
        reasoning_effort: config.reasoning_effort.is_some(),
    };
    let session_id = new_session_id();
    let mut last_errors = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        if sink.is_cancelled() {
            return;
        }
        if !sink
            .send(
                CHAT_EVENT_STATUS,
                &json!({
                    "phase": "thinking",
                    "message": format!("Asking {}", config.model),
                    "attempt": attempt,
                }),
            )
            .await
        {
            return;
        }

        let completion =
            match chat_streaming(&mut sink, &config, &messages, &mut options, &session_id).await {
                Ok(completion) => completion,
                Err(ChatStreamError::Cancelled) => return,
                Err(ChatStreamError::Provider(error)) => {
                    let message = provider_error_message(&error);
                    sink.send(CHAT_EVENT_ERROR, &json!({ "message": message }))
                        .await;
                    return;
                }
            };

        let usage = assistant_usage(&config, &completion, &messages);
        if !sink
            .send(
                CHAT_EVENT_USAGE,
                &serde_json::to_value(usage).unwrap_or(Value::Null),
            )
            .await
        {
            return;
        }

        let envelope = parse_chat_envelope(&completion.content);
        let suggested_name = envelope
            .as_ref()
            .ok()
            .and_then(|envelope| envelope.thread_name.clone());
        let outcome = envelope
            .and_then(|envelope| build_chat_outcome(&live, catalog.clone(), &control, envelope));
        match outcome {
            Ok(ChatOutcome::Plan {
                summary,
                operations,
            }) => {
                let now = now_ms();
                let plan = AssistantPlan {
                    plan_id: format!("plan-{}", new_session_id()),
                    summary: summary.clone(),
                    operations,
                    created_at_ms: now,
                };
                plans.insert_plan(plan.clone());
                persist_thread_turn(
                    &mut sink,
                    &thread_id,
                    thread_created_at_ms,
                    &mut thread_messages,
                    &prompt,
                    &summary,
                    Some(AssistantThreadProposal::Plan { plan: plan.clone() }),
                    suggested_name,
                    stored_thread_name.clone(),
                )
                .await;
                let _ = sink
                    .send(
                        CHAT_EVENT_PLAN,
                        &serde_json::to_value(plan).unwrap_or(Value::Null),
                    )
                    .await;
                return;
            }
            Ok(ChatOutcome::Action { summary, changes }) => {
                let now = now_ms();
                let action = AssistantAction {
                    action_id: format!("action-{}", new_session_id()),
                    summary: summary.clone(),
                    changes,
                    created_at_ms: now,
                    model: config.model.clone(),
                };
                plans.insert_action(action.clone());
                persist_thread_turn(
                    &mut sink,
                    &thread_id,
                    thread_created_at_ms,
                    &mut thread_messages,
                    &prompt,
                    &summary,
                    Some(AssistantThreadProposal::Action {
                        action: action.clone(),
                    }),
                    suggested_name,
                    stored_thread_name.clone(),
                )
                .await;
                let _ = sink
                    .send(
                        CHAT_EVENT_ACTION,
                        &serde_json::to_value(action).unwrap_or(Value::Null),
                    )
                    .await;
                return;
            }
            Ok(ChatOutcome::Answer { text }) => {
                persist_thread_turn(
                    &mut sink,
                    &thread_id,
                    thread_created_at_ms,
                    &mut thread_messages,
                    &prompt,
                    &text,
                    None,
                    suggested_name,
                    stored_thread_name.clone(),
                )
                .await;
                let _ = sink.send(CHAT_EVENT_ANSWER, &json!({ "text": text })).await;
                return;
            }
            Err(errors) => {
                last_errors = errors;
                if attempt < MAX_ATTEMPTS {
                    messages.push(json!({ "role": "assistant", "content": completion.content }));
                    messages.push(json!({
                        "role": "user",
                        "content": format!(
                            "That response failed validation:\n{last_errors}\nReturn a corrected JSON object with the same contract."
                        ),
                    }));
                }
            }
        }
    }

    let _ = sink
        .send(
            CHAT_EVENT_ERROR,
            &json!({
                "message": format!("Assistant could not produce a valid response: {last_errors}"),
            }),
        )
        .await;
}

/// Stored threads keep the newest turns only, bounding row size.
const MAX_STORED_THREAD_MESSAGES: usize = 40;

/// Derive a thread title from the first prompt line when the model did not
/// suggest one.
fn default_thread_name(prompt: &str) -> String {
    let line = prompt.lines().next().unwrap_or(prompt).trim();
    let mut name: String = line.chars().take(48).collect();
    if line.chars().count() > 48 {
        name.push('…');
    }
    if name.is_empty() {
        "New conversation".to_string()
    } else {
        name
    }
}

/// Append the user prompt and the assistant reply to the thread, persist it,
/// and tell the client the (possibly model-suggested) thread name.
#[allow(clippy::too_many_arguments)]
async fn persist_thread_turn(
    sink: &mut EventSink,
    thread_id: &str,
    created_at_ms: Option<i64>,
    messages: &mut Vec<AssistantHistoryMessage>,
    prompt: &str,
    reply: &str,
    proposal: Option<AssistantThreadProposal>,
    suggested_name: Option<String>,
    stored_name: Option<String>,
) {
    let now = now_ms();
    messages.push(AssistantHistoryMessage {
        role: AssistantMessageRole::User,
        content: prompt.to_string(),
        proposal: None,
        outcome: None,
    });
    messages.push(AssistantHistoryMessage {
        role: AssistantMessageRole::Assistant,
        content: reply.to_string(),
        proposal,
        outcome: None,
    });
    if messages.len() > MAX_STORED_THREAD_MESSAGES {
        let excess = messages.len() - MAX_STORED_THREAD_MESSAGES;
        messages.drain(0..excess);
    }

    let name = stored_name
        .or_else(|| {
            suggested_name
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
        })
        .unwrap_or_else(|| default_thread_name(prompt));
    let thread = AssistantThread {
        id: thread_id.to_string(),
        name: name.clone(),
        created_at_ms: created_at_ms.unwrap_or(now),
        updated_at_ms: now,
        messages: messages.clone(),
    };
    if let Err(error) = config_queries::db_save_assistant_thread(&thread).await {
        log::warn!("Failed to persist assistant thread {thread_id}: {error}");
    }
    let _ = sink
        .send(CHAT_EVENT_THREAD, &json!({ "id": thread_id, "name": name }))
        .await;
}

/// Apply a stored light-state action. The store entry stays available so the
/// same proposal can be applied again later, and every change is re-validated
/// against the live catalog on each apply.
async fn apply_stored_action(
    action_id: String,
    body: Bytes,
    snapshot: SnapshotHandle,
    handle: StateHandle,
    plans: Arc<PlanStore>,
) -> Result<impl Reply, warp::Rejection> {
    let Some(action) = plans.get_action(&action_id) else {
        return Ok(not_found("Assistant action"));
    };
    if body.len() > 65536 {
        return Ok(error_response(
            "Action selection is too large",
            StatusCode::PAYLOAD_TOO_LARGE,
        ));
    }
    let selection: ApplyAssistantActionRequest = if body.is_empty() {
        Default::default()
    } else {
        match serde_json::from_slice(&body) {
            Ok(selection) => selection,
            Err(_) => {
                return Ok(error_response(
                    "Invalid action selection",
                    StatusCode::BAD_REQUEST,
                ))
            }
        }
    };
    let changes = match selection.device_keys {
        None => action.changes,
        Some(keys) => {
            if keys.iter().any(|key| {
                !action
                    .changes
                    .iter()
                    .any(|change| &change.device_key == key)
            }) {
                return Ok(error_response(
                    "Selection contains a device outside this proposal",
                    StatusCode::BAD_REQUEST,
                ));
            }
            action
                .changes
                .into_iter()
                .filter(|change| keys.contains(&change.device_key))
                .collect()
        }
    };
    let live = snapshot.load();
    let control = build_control_catalog(&live, None);
    let (results, applied_count) = apply_device_changes(&handle, &live, &control, &changes).await;

    Ok(ApiResponse::success(ApplyAssistantActionResponse {
        summary: Some(action.summary),
        results,
        applied_count,
    }))
}

/// Discard a stored action without applying it.
async fn discard_stored_action(
    action_id: String,
    plans: Arc<PlanStore>,
) -> Result<impl Reply, warp::Rejection> {
    match plans.remove_action(&action_id) {
        Some(_) => Ok(ApiResponse::success(true)),
        None => Ok(not_found("Assistant action")),
    }
}

// ============================================================================
// Plan apply
// ============================================================================

/// Order accepted operations: creates first (dependencies before dependents),
/// then updates, then deletes in reverse dependency order. The index keeps the
/// order deterministic for equal phases and ranks.
fn operation_sort_key(operation: &AssistantOperation, index: usize) -> (u8, u8, usize) {
    let rank = match operation.kind {
        AssistantEntityKind::Integration => 0,
        AssistantEntityKind::Floorplan => 1,
        AssistantEntityKind::Device => 2,
        AssistantEntityKind::Block => 3,
        AssistantEntityKind::Helper => 4,
        AssistantEntityKind::ComputedSource => 5,
        AssistantEntityKind::Group => 6,
        AssistantEntityKind::Scene => 7,
        AssistantEntityKind::Routine => 8,
    };
    let phase = match operation.op {
        AssistantOpKind::Create => 0,
        AssistantOpKind::Update => 1,
        AssistantOpKind::Delete => 2,
    };
    let rank = if operation.op == AssistantOpKind::Delete {
        8 - rank
    } else {
        rank
    };
    (phase, rank, index)
}

/// Dependency order within and across entity kinds, including functions imported
/// by blocks and computed-helper dependencies. Never add unaccepted operations.
fn order_plan_operations(
    mut pending: Vec<(usize, AssistantOperation)>,
    sort_phases: bool,
) -> Result<Vec<(usize, AssistantOperation)>, String> {
    fn references(body: &Value, kind: AssistantEntityKind, id: &str) -> bool {
        if kind == AssistantEntityKind::Block {
            return automation::blocks::references(body, id);
        }
        match body {
            Value::String(text) => {
                text == id
                    || (kind == AssistantEntityKind::ComputedSource
                        && text == &format!("computed/{id}"))
            }
            Value::Array(items) => items.iter().any(|body| references(body, kind, id)),
            Value::Object(map) => {
                map.contains_key(id)
                    || map.iter().any(|(key, body)| {
                        !matches!(
                            key.as_str(),
                            "id" | "name" | "label" | "description" | "source_body"
                        ) && references(body, kind, id)
                    })
            }
            _ => false,
        }
    }
    fn depends_on(operation: &AssistantOperation, dependency: &AssistantOperation) -> bool {
        let (body, target) = if operation.op == AssistantOpKind::Delete
            && dependency.op == AssistantOpKind::Delete
        {
            (dependency.before.as_ref(), operation_target(operation).ok())
        } else if operation.op != AssistantOpKind::Delete
            && dependency.op != AssistantOpKind::Delete
        {
            (
                operation.after.as_ref(),
                dependency
                    .target_id
                    .clone()
                    .or_else(|| dependency.after.as_ref().and_then(operation_entity_id)),
            )
        } else {
            return false;
        };
        let kind = if operation.op == AssistantOpKind::Delete {
            operation.kind
        } else {
            dependency.kind
        };
        body.zip(target)
            .is_some_and(|(body, id)| references(body, kind, &id))
    }
    if sort_phases {
        pending.sort_by_key(|(index, operation)| operation_sort_key(operation, *index));
    }
    let mut ordered = Vec::with_capacity(pending.len());
    while !pending.is_empty() {
        let next = pending.iter().enumerate().position(|(index,(_, operation))| {
            !pending.iter().enumerate().any(|(other,(_,dependency))|index != other && depends_on(operation,dependency))
        }).ok_or_else(||"Plan operations contain a dependency cycle. Split conflicting changes or remove the cycle.".to_string())?;
        ordered.push(pending.remove(next));
    }
    Ok(ordered)
}

async fn apply_assistant_plan(
    plan_id: String,
    request: ApplyAssistantPlanRequest,
    snapshot: SnapshotHandle,
    handle: StateHandle,
    plans: Arc<PlanStore>,
) -> Result<impl Reply, warp::Rejection> {
    if request.accepted_operation_ids.is_empty() {
        return Ok(error_response(
            "acceptedOperationIds must not be empty",
            StatusCode::BAD_REQUEST,
        ));
    }

    let Some(plan) = plans.get_plan(&plan_id) else {
        return Ok(not_found("Assistant plan"));
    };

    let accepted: HashSet<&str> = request
        .accepted_operation_ids
        .iter()
        .map(String::as_str)
        .collect();
    let mut selected: Vec<(usize, AssistantOperation)> = plan
        .operations
        .into_iter()
        .enumerate()
        .filter(|(_, operation)| accepted.contains(operation.op_id.as_str()))
        .collect();
    if selected.is_empty() {
        return Ok(error_response(
            "no accepted operations match this plan",
            StatusCode::BAD_REQUEST,
        ));
    }
    selected = match order_plan_operations(selected, true) {
        Ok(operations) => operations,
        Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    };

    // The plan stays in the store: applying the same proposal again is a
    // supported action, and every operation is re-validated against the live
    // snapshot below before it runs.

    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    // Re-validate against the live snapshot: entities may have changed since
    // the plan was produced. Per-op failures are reported in the response
    // instead of aborting the whole apply.
    let mut results = Vec::with_capacity(selected.len());
    for (_, operation) in selected {
        let live = snapshot.load();
        let validation = PlanValidation::new(&live, catalog_from_snapshot_export(&live));
        let outcome =
            apply_plan_operation(&handle, &live, &_write_guard, &validation, &operation).await;
        results.push(AssistantOperationResult {
            op_id: operation.op_id,
            ok: outcome.is_ok(),
            error: outcome.err(),
        });
    }

    Ok(ApiResponse::success(ApplyAssistantPlanResponse { results }))
}

/// Re-validate one accepted operation against the live snapshot, then execute
/// it through the same state mutations and persistence calls the config API
/// handlers use.
async fn apply_plan_operation(
    handle: &StateHandle,
    live: &RuntimeSnapshot,
    guard: &tokio::sync::OwnedMutexGuard<()>,
    validation: &PlanValidation<'_>,
    operation: &AssistantOperation,
) -> Result<(), String> {
    if operation.kind == AssistantEntityKind::Block
        && operation.op != AssistantOpKind::Create
        && operation.before
            != entity_snapshot(
                live,
                operation.kind,
                operation.target_id.as_deref().unwrap_or_default(),
            )
    {
        return Err("This block changed since the plan was reviewed. Request a new plan.".into());
    }
    let provider = ProviderOperation {
        op: operation.op,
        kind: operation.kind,
        target_id: operation.target_id.clone(),
        label: Some(operation.label.clone()),
        after: operation.after.clone(),
        warnings: Vec::new(),
    };
    let validated = validation.build_operation(operation.op_id.clone(), provider)?;

    match validated.op {
        AssistantOpKind::Create => apply_create(handle, guard, &validated).await,
        AssistantOpKind::Update => apply_update(handle, live, guard, &validated).await,
        AssistantOpKind::Delete => apply_delete(handle, guard, &validated).await,
    }
}

fn parse_validated_body<T>(operation: &AssistantOperation) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let body = operation.after.clone().ok_or_else(|| {
        format!(
            "{}: validated operation is missing its final body",
            operation.op_id
        )
    })?;
    serde_json::from_value(body)
        .map_err(|error| format!("{}: invalid body: {error}", operation.op_id))
}

fn operation_target(operation: &AssistantOperation) -> Result<String, String> {
    operation.target_id.clone().ok_or_else(|| {
        format!(
            "{}: validated operation is missing its target id",
            operation.op_id
        )
    })
}

fn persisted(error: color_eyre::Report) -> String {
    format!("applied in memory but persistence failed: {error}")
}

async fn apply_create(
    handle: &StateHandle,
    guard: &tokio::sync::OwnedMutexGuard<()>,
    operation: &AssistantOperation,
) -> Result<(), String> {
    match operation.kind {
        AssistantEntityKind::Block => write_assistant_block(handle, operation).await,

        AssistantEntityKind::Group => {
            let group: GroupRow = parse_validated_body(operation)?;
            write_group(handle, group.clone()).await?;
            config_queries::db_upsert_group(&group)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Scene => {
            let scene: SceneRow = parse_validated_body(operation)?;
            write_scene(handle, scene.clone()).await?;
            config_queries::db_upsert_config_scene(&scene)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Routine => {
            let mut routine: RoutineRow = parse_validated_body(operation)?;
            routine.revision = automation::next_revision(None);
            write_routine(handle, routine.clone()).await?;
            config_queries::db_upsert_routine(&routine)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Helper => {
            let definition: HelperDefinition = parse_validated_body(operation)?;
            let definition = write_helper(handle, definition).await?;
            config_queries::db_upsert_helper(&definition)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::ComputedSource => {
            let mut source: SourceDefinition = parse_validated_body(operation)?;
            source.revision = 1;
            write_source(handle, source.clone()).await?;
            config_queries::db_upsert_source(&source)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Integration => {
            let integration: IntegrationRow = parse_validated_body(operation)?;
            write_integration(handle, guard, integration.clone()).await?;
            config_queries::db_upsert_integration(&integration)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Floorplan => {
            let floorplan: FloorplanMetadataRow = parse_validated_body(operation)?;
            let to_create = floorplan.clone();
            let created = handle
                .mutate(move |state| {
                    Box::pin(async move { state.create_floorplan_metadata(to_create) })
                })
                .await
                .map_err(|error| error.to_string())?;
            if !created {
                return Err(format!("floorplan '{}' already exists", floorplan.id));
            }
            config_queries::db_create_floorplan(&floorplan)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Device => {
            Err("devices are discovered from integrations and cannot be created".to_string())
        }
    }
}

async fn apply_update(
    handle: &StateHandle,
    live: &RuntimeSnapshot,
    guard: &tokio::sync::OwnedMutexGuard<()>,
    operation: &AssistantOperation,
) -> Result<(), String> {
    match operation.kind {
        AssistantEntityKind::Block => write_assistant_block(handle, operation).await,

        AssistantEntityKind::Group => {
            let group: GroupRow = parse_validated_body(operation)?;
            write_group(handle, group.clone()).await?;
            config_queries::db_upsert_group(&group)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Scene => {
            let scene: SceneRow = parse_validated_body(operation)?;
            write_scene(handle, scene.clone()).await?;
            config_queries::db_upsert_config_scene(&scene)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Routine => {
            let mut routine: RoutineRow = parse_validated_body(operation)?;
            let existing = live
                .runtime_config
                .routines
                .iter()
                .find(|row| row.id == routine.id);
            routine.revision = automation::next_revision(existing);
            write_routine(handle, routine.clone()).await?;
            config_queries::db_upsert_routine(&routine)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Helper => {
            let definition: HelperDefinition = parse_validated_body(operation)?;
            let definition = write_helper(handle, definition).await?;
            config_queries::db_upsert_helper(&definition)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::ComputedSource => {
            let mut source: SourceDefinition = parse_validated_body(operation)?;
            let existing = live
                .runtime_config
                .sources
                .iter()
                .find(|row| row.id == source.id);
            source.revision = existing.map(|row| row.revision + 1).unwrap_or(1);
            write_source(handle, source.clone()).await?;
            config_queries::db_upsert_source(&source)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Integration => {
            let mut integration: IntegrationRow = parse_validated_body(operation)?;
            // The plan snapshot masked secret fields. Keep the stored value
            // for any secret the reviewed body does not explicitly set.
            if let Some(stored) = live
                .runtime_config
                .integrations
                .iter()
                .find(|row| row.id == integration.id)
            {
                restore_omitted_integration_secrets(
                    &mut integration.config,
                    &stored.config,
                    &integration.plugin,
                );
            }
            write_integration(handle, guard, integration.clone()).await?;
            config_queries::db_upsert_integration(&integration)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Floorplan => {
            let floorplan: FloorplanMetadataRow = parse_validated_body(operation)?;
            let to_update = floorplan.clone();
            let updated = handle
                .mutate(move |state| {
                    Box::pin(async move { state.update_floorplan_metadata(to_update) })
                })
                .await
                .map_err(|error| error.to_string())?;
            if !updated {
                return Err(format!("floorplan '{}' no longer exists", floorplan.id));
            }
            config_queries::db_update_floorplan_metadata(&floorplan)
                .await
                .map_err(persisted)
        }
        AssistantEntityKind::Device => {
            let state: DevicePlanState = parse_validated_body(operation)?;
            let device_key = state
                .device_key
                .ok_or_else(|| "device body requires device_key".to_string())?;
            match state.display_name {
                Some(display_name) => {
                    let row = DeviceDisplayNameRow {
                        device_key: device_key.clone(),
                        display_name,
                    };
                    let row_for_state = row.clone();
                    handle
                        .mutate(move |state| {
                            Box::pin(async move {
                                state.upsert_device_display_override(row_for_state);
                            })
                        })
                        .await
                        .map_err(|error| error.to_string())?;
                    config_queries::db_upsert_device_display_override(&row)
                        .await
                        .map_err(persisted)
                }
                None => {
                    let key_for_state = device_key.clone();
                    handle
                        .mutate(move |state| {
                            Box::pin(async move {
                                state.delete_device_display_override(&key_for_state);
                            })
                        })
                        .await
                        .map_err(|error| error.to_string())?;
                    config_queries::db_delete_device_display_override(&device_key)
                        .await
                        .map(|_| ())
                        .map_err(persisted)
                }
            }
        }
    }
}

async fn apply_delete(
    handle: &StateHandle,
    guard: &tokio::sync::OwnedMutexGuard<()>,
    operation: &AssistantOperation,
) -> Result<(), String> {
    let target_id = operation_target(operation)?;
    match operation.kind {
        AssistantEntityKind::Block => {
            handle
                .mutate(move |state| {
                    Box::pin(async move { super::blocks::remove_block(state, target_id.clone()) })
                })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|(_, message)| message)?;
            config_queries::db_delete_block(&operation_target(operation)?)
                .await
                .map(|_| ())
                .map_err(persisted)
        }

        AssistantEntityKind::Group => {
            if !delete_group_state(handle, target_id.clone()).await? {
                return Err(format!("group '{target_id}' no longer exists"));
            }
            config_queries::db_delete_group(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::Scene => {
            if !delete_scene_state(handle, target_id.clone()).await? {
                return Err(format!("scene '{target_id}' no longer exists"));
            }
            config_queries::db_delete_config_scene(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::Routine => {
            if !delete_routine_state(handle, target_id.clone()).await? {
                return Err(format!("routine '{target_id}' no longer exists"));
            }
            config_queries::db_delete_routine(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::Helper => {
            if !delete_helper_state(handle, target_id.clone()).await? {
                return Err(format!("helper '{target_id}' no longer exists"));
            }
            config_queries::db_delete_helper(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::ComputedSource => {
            if !delete_source_state(handle, target_id.clone()).await? {
                return Err(format!("computed source '{target_id}' no longer exists"));
            }
            config_queries::db_delete_source(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::Integration => {
            let id = target_id.clone();
            let deleted = apply_runtime_integrations_change(handle, guard, move |config| {
                let len_before = config.integrations.len();
                config.integrations.retain(|row| row.id != id);
                config.integrations.len() != len_before
            })
            .await
            .map_err(|error| format!("integration change failed: {error}"))?;
            if !deleted {
                return Err(format!("integration '{target_id}' no longer exists"));
            }
            config_queries::db_delete_integration(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::Floorplan => {
            let id = target_id.clone();
            let deleted = handle
                .mutate(move |state| Box::pin(async move { state.delete_floorplan(&id) }))
                .await
                .map_err(|error| error.to_string())?;
            if !deleted {
                return Err(format!("floorplan '{target_id}' no longer exists"));
            }
            config_queries::db_delete_floorplan(&target_id)
                .await
                .map(|_| ())
                .map_err(persisted)
        }
        AssistantEntityKind::Device => {
            match delete_config_device_impl(target_id.clone(), handle).await {
                DeviceConfigDeleteOutcome::Deleted {
                    rewrite, source, ..
                } => persist_device_config_rewrite(&rewrite, &source, None)
                    .await
                    .map_err(persisted),
                DeviceConfigDeleteOutcome::InvalidKey => {
                    Err(format!("invalid device key '{target_id}'"))
                }
                DeviceConfigDeleteOutcome::NotFound => {
                    Err(format!("device '{target_id}' no longer exists"))
                }
                DeviceConfigDeleteOutcome::ActorUnavailable => {
                    Err("state actor unavailable".to_string())
                }
            }
        }
    }
}

async fn write_assistant_block(
    handle: &StateHandle,
    operation: &AssistantOperation,
) -> Result<(), String> {
    let block: AutomationBlock = parse_validated_body(operation)?;
    let expected = operation
        .before
        .clone()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| error.to_string())?;
    let create_only = operation.op == AssistantOpKind::Create;
    let (block, routines, helpers, sources) = handle
        .mutate(move |state| {
            Box::pin(async move { super::blocks::write_block(state, block, expected, create_only) })
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|(_, body)| {
            body["error"]
                .as_str()
                .unwrap_or("Invalid block")
                .to_string()
        })?;
    config_queries::db_save_block_change(&block, &routines, &helpers, &sources)
        .await
        .map_err(persisted)
}

async fn write_group(handle: &StateHandle, group: GroupRow) -> Result<(), String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_group(group);
                state.apply_runtime_groups();
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn write_scene(handle: &StateHandle, scene: SceneRow) -> Result<(), String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_scene(scene);
                state.apply_runtime_scenes();
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn write_routine(handle: &StateHandle, routine: RoutineRow) -> Result<(), String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_routine(routine);
                state.apply_runtime_routines();
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn write_helper(
    handle: &StateHandle,
    mut definition: HelperDefinition,
) -> Result<HelperDefinition, String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                if let Some(compute) = &mut definition.compute {
                    compute.revision = state
                        .runtime_config
                        .helpers
                        .iter()
                        .find(|helper| helper.id == definition.id)
                        .and_then(|helper| helper.compute.as_ref())
                        .map(|compute| compute.revision.saturating_add(1))
                        .unwrap_or(1);
                }
                let mut config = state.runtime_config.clone();
                config.helpers.retain(|helper| helper.id != definition.id);
                config.helpers.push(definition.clone());
                let catalog =
                    ConfigCatalog::new(state.devices.get_state().0.keys().cloned(), &config);
                super::validate_routine_catalog(&config, &catalog)
                    .map_err(|error| error.to_string())?;
                state.helpers.upsert_definition(definition.clone())?;
                let id = definition.id.clone();
                if let Some(existing) = state
                    .runtime_config
                    .helpers
                    .iter_mut()
                    .find(|existing| existing.id == id)
                {
                    *existing = definition.clone();
                } else {
                    state.runtime_config.helpers.push(definition.clone());
                    state
                        .runtime_config
                        .helpers
                        .sort_by(|left, right| left.id.0.cmp(&right.id.0));
                }
                state.scripts.sync_helper_owners(&state.helpers);
                state.apply_runtime_routines();
                state.schedule_ws_broadcast(SnapshotChanges {
                    helper_statuses: true,
                    routine_statuses: true,
                    ..SnapshotChanges::none()
                });
                Ok::<HelperDefinition, String>(definition)
            })
        })
        .await
        .map_err(|error| error.to_string())?
}

async fn write_source(handle: &StateHandle, source: SourceDefinition) -> Result<(), String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                let catalog = ConfigCatalog::new(
                    state.devices.get_state().0.keys().cloned(),
                    &state.runtime_config,
                );
                if matches!(
                    source.compute,
                    crate::types::automation_source::SourceCompute::Script { .. }
                ) {
                    automation::reuse::resolve_source(&source.compute, &catalog)?;
                }
                state.upsert_source(source);
                state.schedule_ws_broadcast(SnapshotChanges {
                    runtime_config: true,
                    ..SnapshotChanges::none()
                });
                Ok::<(), String>(())
            })
        })
        .await
        .map_err(|error| error.to_string())?
}

async fn write_integration(
    handle: &StateHandle,
    guard: &tokio::sync::OwnedMutexGuard<()>,
    integration: IntegrationRow,
) -> Result<(), String> {
    apply_runtime_integrations_change(handle, guard, move |config| {
        if let Some(existing) = config
            .integrations
            .iter_mut()
            .find(|existing| existing.id == integration.id)
        {
            *existing = integration.clone();
        } else {
            config.integrations.push(integration.clone());
            config
                .integrations
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
        true
    })
    .await
    .map(|_| ())
    .map_err(|error| format!("integration change failed: {error}"))
}

async fn delete_group_state(handle: &StateHandle, id: String) -> Result<bool, String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                let deleted = state.delete_group(&id);
                if deleted {
                    state.apply_runtime_groups();
                }
                deleted
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn delete_scene_state(handle: &StateHandle, id: String) -> Result<bool, String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                let deleted = state.delete_scene(&id);
                if deleted {
                    state.apply_runtime_scenes();
                }
                deleted
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn delete_routine_state(handle: &StateHandle, id: String) -> Result<bool, String> {
    handle
        .mutate(move |state| {
            Box::pin(async move {
                let deleted = state.delete_routine(&id);
                if deleted {
                    state.apply_runtime_routines();
                }
                deleted
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn delete_helper_state(handle: &StateHandle, id: String) -> Result<bool, String> {
    let helper_id = HelperId(id);
    handle
        .mutate(move |state| {
            Box::pin(async move {
                let removed = state.helpers.remove_definition(&helper_id);
                state
                    .runtime_config
                    .helpers
                    .retain(|definition| definition.id != helper_id);
                state
                    .runtime_config
                    .helper_values
                    .retain(|row| row.id != helper_id.0);
                state.refresh_routine_statuses();
                state.schedule_ws_broadcast(SnapshotChanges {
                    helper_statuses: true,
                    routine_statuses: true,
                    ..SnapshotChanges::none()
                });
                removed
            })
        })
        .await
        .map_err(|error| error.to_string())
}

async fn delete_source_state(handle: &StateHandle, id: String) -> Result<bool, String> {
    let source_id = crate::types::automation_definition::SourceId(id);
    handle
        .mutate(move |state| {
            Box::pin(async move {
                let deleted = state.delete_source(&source_id);
                if deleted {
                    state.schedule_ws_broadcast(SnapshotChanges {
                        runtime_config: true,
                        ..SnapshotChanges::none()
                    });
                }
                deleted
            })
        })
        .await
        .map_err(|error| error.to_string())
}

/// Keep stored integration secrets for paths the reviewed body omitted.
pub(super) fn restore_omitted_integration_secrets(
    config: &mut Value,
    stored: &Value,
    plugin: &str,
) {
    for key in integration_secret_keys(plugin) {
        insert_missing_json_path(config, stored, &key);
    }
}

/// Context for the plan prompt: attachment snapshots, deterministic prompt
/// matches, and the device catalog that scene/group/routine bodies may
/// reference.
fn build_plan_context(
    snapshot: &RuntimeSnapshot,
    attachments: &[AssistantAttachment],
    prompt: &str,
) -> Result<Value, String> {
    let mut attached = Vec::new();
    for attachment in attachments {
        match attachment
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => {
                let entity = entity_snapshot(snapshot, attachment.kind, id).ok_or_else(|| {
                    format!("attached {} '{id}' was not found", attachment.kind.code())
                })?;
                attached.push(json!({
                    "kind": attachment.kind.code(),
                    "id": id,
                    "label": attachment.label,
                    "snapshot": entity,
                }));
            }
            None => attached.push(json!({
                "kind": attachment.kind.code(),
                "label": attachment.label,
            })),
        }
    }

    let mut match_budget = 64 * 1024;
    let matches: Vec<Value> = search_prompt(snapshot, prompt)
        .into_iter()
        .map(|matched| {
            let snapshot = entity_snapshot(snapshot, matched.kind, &matched.id);
            let mut value = serde_json::to_value(matched).unwrap_or_default();
            if let Some(snapshot) = snapshot {
                let bytes = serde_json::to_vec(&snapshot)
                    .map(|body| body.len())
                    .unwrap_or(usize::MAX);
                if bytes <= 16 * 1024 && bytes <= match_budget {
                    value["snapshot"] = snapshot;
                    match_budget -= bytes;
                } else {
                    value["snapshotOmitted"] = json!(true);
                }
            }
            value
        })
        .collect();
    let timezone = setting_source(&snapshot.runtime_config.widget_settings)
        .string("timezone", "HOMECTL_ASSISTANT_TIMEZONE");
    Ok(json!({
        "attachments": attached,
        "matches": matches,
        "devices": build_context_devices(snapshot),
        "automation_catalog": build_catalog(snapshot, timezone.as_deref()).value,
        "live_state": build_live_state(
            snapshot,
            attachments,
            prompt,
            crate::core::logs::recent_logs(),
        ),
        "supported_kinds": AssistantEntityKind::searchable()
            .iter()
            .map(|kind| kind.code())
            .collect::<Vec<_>>(),
    }))
}

/// Current device values, configured integrations, and a bounded tail of
/// recent server logs. Read-only context that lets the assistant answer "what
/// is it doing now" and "why did that happen" instead of only seeing stored
/// configuration.
fn build_live_state(
    snapshot: &RuntimeSnapshot,
    attachments: &[AssistantAttachment],
    prompt: &str,
    logs: Vec<UiLogEntry>,
) -> Value {
    let mut priority: Vec<String> = Vec::new();
    let mut prioritize = |key: &str| {
        let key = key.trim();
        if !key.is_empty() && !priority.iter().any(|existing| existing == key) {
            priority.push(key.to_string());
        }
    };
    for attachment in attachments {
        if attachment.kind == AssistantEntityKind::Device {
            if let Some(id) = attachment.id.as_deref() {
                prioritize(id);
            }
        }
    }
    for result in search_prompt(snapshot, prompt) {
        if result.kind == AssistantEntityKind::Device {
            prioritize(&result.id);
        }
    }

    let mut devices = Vec::new();
    for key in &priority {
        if devices.len() == MAX_LIVE_DEVICE_STATES {
            break;
        }
        if let Some((key, device)) = snapshot
            .devices
            .0
            .iter()
            .find(|(candidate, _)| candidate.to_string() == *key)
        {
            devices.push(live_device_entry(snapshot, key, device));
        }
    }
    for (key, device) in snapshot.devices.0.iter() {
        if devices.len() == MAX_LIVE_DEVICE_STATES {
            break;
        }
        if priority
            .iter()
            .any(|candidate| candidate == &key.to_string())
        {
            continue;
        }
        devices.push(live_device_entry(snapshot, key, device));
    }

    let integrations: Vec<Value> = snapshot
        .runtime_config
        .integrations
        .iter()
        .map(|integration| {
            json!({
                "id": integration.id,
                "plugin": integration.plugin,
                "enabled": integration.enabled,
            })
        })
        .collect();

    let recent_logs: Vec<Value> = logs
        .iter()
        .filter(|entry| {
            matches!(
                entry.level,
                LogLevel::Error | LogLevel::Warn | LogLevel::Info
            )
        })
        .rev()
        .take(MAX_LIVE_LOGS)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|entry| {
            json!({
                "timestamp": entry.timestamp,
                "level": entry.level,
                "target": entry.target,
                "message": truncate(&entry.message, MAX_LIVE_LOG_CHARS),
            })
        })
        .collect();

    json!({
        "devices": devices,
        "integrations": integrations,
        "recent_logs": recent_logs,
    })
}

fn live_device_entry(snapshot: &RuntimeSnapshot, key: &DeviceKey, device: &Device) -> Value {
    match &device.data {
        DeviceData::Sensor(sensor) => json!({
            "device_key": key.to_string(),
            "name": device_label(snapshot, &key.to_string(), &device.name),
            "kind": "sensor",
            "state": sensor,
        }),
        DeviceData::Controllable(controllable) => json!({
            "device_key": key.to_string(),
            "name": device_label(snapshot, &key.to_string(), &device.name),
            "kind": "controllable",
            "state": controllable.state,
            "capabilities": {
                "brightness": controllable.capabilities.brightness,
                "color": controllable.capabilities.hs
                    || controllable.capabilities.rgb
                    || controllable.capabilities.xy
                    || controllable.capabilities.ct.is_some(),
            },
        }),
    }
}

/// Manual light changes — including an assistant proposal the user accepted —
/// always carry a short transition. Without one the device keeps whatever
/// transition its current scene left in place (tens of seconds for a slow
/// morning scene), which is not what "apply this change now" should mean.
const MANUAL_TRANSITION_SECONDS: f32 = 0.4;

/// The user's custom label for a device, when one is set and non-empty.
fn device_display_override(snapshot: &RuntimeSnapshot, device_key: &str) -> Option<String> {
    snapshot
        .runtime_config
        .device_display_overrides
        .iter()
        .find(|row| row.device_key == device_key)
        .map(|row| row.display_name.trim().to_string())
        .filter(|label| !label.is_empty())
}

/// What a device should be called in assistant payloads: the label from
/// settings wins over the name the integration reported, which is a generic
/// default for entities the integration could not name (an ESPHome light with
/// no `name:` arrives as "Light").
fn device_label(snapshot: &RuntimeSnapshot, device_key: &str, fallback: &str) -> String {
    device_display_override(snapshot, device_key).unwrap_or_else(|| fallback.to_string())
}

fn build_context_devices(snapshot: &RuntimeSnapshot) -> Vec<Value> {
    snapshot
        .devices
        .0
        .iter()
        .take(MAX_CONTEXT_DEVICES)
        .map(|(key, device)| match &device.data {
            DeviceData::Sensor(_) => json!({
                "device_key": key.to_string(),
                "name": device_label(snapshot, &key.to_string(), &device.name),
                "kind": "sensor",
            }),
            DeviceData::Controllable(data) => json!({
                "device_key": key.to_string(),
                "name": device_label(snapshot, &key.to_string(), &device.name),
                "kind": "controllable",
                "capabilities": {
                    "brightness": data.capabilities.brightness,
                    "color": data.capabilities.hs
                        || data.capabilities.rgb
                        || data.capabilities.xy
                        || data.capabilities.ct.is_some(),
                },
            }),
        })
        .collect()
}

/// Full, browser-safe snapshot of one entity. Secret-bearing kinds mask their
/// secret fields here before the value is shown in a plan or sent to a
/// provider.
fn entity_snapshot(
    snapshot: &RuntimeSnapshot,
    kind: AssistantEntityKind,
    id: &str,
) -> Option<Value> {
    match kind {
        AssistantEntityKind::Routine => snapshot
            .runtime_config
            .routines
            .iter()
            .find(|routine| routine.id == id)
            .and_then(|routine| serde_json::to_value(routine).ok()),
        AssistantEntityKind::Scene => snapshot
            .runtime_config
            .scenes
            .iter()
            .find(|scene| scene.id == id)
            .and_then(|scene| serde_json::to_value(scene).ok()),
        AssistantEntityKind::Group => snapshot
            .runtime_config
            .groups
            .iter()
            .find(|group| group.id == id)
            .and_then(|group| serde_json::to_value(group).ok()),
        AssistantEntityKind::Device => {
            let (key, device) = snapshot
                .devices
                .0
                .iter()
                .find(|(key, _)| key.to_string() == id)?;
            let display_name = snapshot
                .runtime_config
                .device_display_overrides
                .iter()
                .find(|row| row.device_key == id)
                .map(|row| row.display_name.clone());
            let data_kind = match &device.data {
                DeviceData::Sensor(_) => "sensor",
                DeviceData::Controllable(_) => "controllable",
            };
            Some(json!({
                "device_key": key.to_string(),
                "name": display_name
                    .clone()
                    .unwrap_or_else(|| device.name.clone()),
                "display_name": display_name,
                "kind": data_kind,
            }))
        }
        AssistantEntityKind::Floorplan => list_runtime_floorplans(&snapshot.runtime_config)
            .into_iter()
            .find(|floorplan| floorplan.id == id)
            .and_then(|floorplan| serde_json::to_value(floorplan).ok()),
        AssistantEntityKind::Integration => {
            let row = snapshot
                .runtime_config
                .integrations
                .iter()
                .find(|integration| integration.id == id)?;
            let mut value = serde_json::to_value(row).ok()?;
            redact_integration_secrets(&mut value, &row.plugin);
            Some(value)
        }
        AssistantEntityKind::Block => snapshot
            .runtime_config
            .blocks
            .iter()
            .find(|block| block.id == id)
            .and_then(|block| serde_json::to_value(block).ok()),
        AssistantEntityKind::Helper => snapshot
            .runtime_config
            .helpers
            .iter()
            .find(|helper| helper.id.0 == id)
            .and_then(|helper| serde_json::to_value(helper).ok()),
        AssistantEntityKind::ComputedSource => snapshot
            .runtime_config
            .sources
            .iter()
            .find(|source| source.id.0 == id)
            .and_then(|source| serde_json::to_value(source).ok()),
    }
}

/// Password-kind config fields for an integration plugin, as dot-separated
/// schema keys. Integrations are schema-driven, so the schema is the source of
/// truth for which fields are secrets (the widget-settings equivalent lives in
/// `secret_widget_field`).
pub(super) fn integration_secret_keys(plugin: &str) -> Vec<String> {
    integration_config_schemas()
        .into_iter()
        .find(|schema| schema.plugin == plugin)
        .map(|schema| {
            schema
                .fields
                .into_iter()
                .filter(|field| field.kind == IntegrationConfigFieldKind::Password)
                .map(|field| field.key)
                .collect()
        })
        .unwrap_or_default()
}

fn json_path_pointer(key: &str) -> String {
    let mut pointer = String::with_capacity(key.len() + 1);
    for segment in key.split('.') {
        pointer.push('/');
        pointer.push_str(segment);
    }
    pointer
}

fn remove_json_path(value: &mut Value, key: &str) {
    let pointer = json_path_pointer(key);
    let Some((parent_pointer, last)) = pointer.rsplit_once('/') else {
        return;
    };
    let Some(parent) = value.pointer_mut(parent_pointer) else {
        return;
    };
    if let Some(object) = parent.as_object_mut() {
        object.remove(last);
    }
}

/// Restore a stored value for a path that is absent from `target` (the plan
/// body). Presence, including an explicit null, is respected so a user can
/// still clear a secret deliberately.
fn insert_missing_json_path(target: &mut Value, source: &Value, key: &str) {
    let pointer = json_path_pointer(key);
    if target.pointer(&pointer).is_some() {
        return;
    }
    let Some(stored) = source.pointer(&pointer).cloned() else {
        return;
    };
    let Some((parent_pointer, last)) = pointer.rsplit_once('/') else {
        return;
    };
    let Some(parent) = target.pointer_mut(parent_pointer) else {
        return;
    };
    if let Some(object) = parent.as_object_mut() {
        object.insert(last.to_string(), stored);
    }
}

/// Drop every secret field from an integration row snapshot.
pub(super) fn redact_integration_secrets(value: &mut Value, plugin: &str) {
    let Some(config) = value.get_mut("config") else {
        return;
    };
    for key in integration_secret_keys(plugin) {
        remove_json_path(config, &key);
    }
}

fn plan_system_prompt(context_json: &str) -> String {
    format!(
        r#"You are the homectl configuration assistant. You translate a plain-language request into a reviewed plan of configuration operations across routines, scenes, groups, devices, floorplans, integrations, helpers, reusable blocks/functions, and computed sources. Nothing is written until the user accepts the plan.

Respond with a single JSON object and nothing else:
{{"summary": "<one or two sentences for review>", "operations": [{{"op": "create|update|delete", "kind": "routine|scene|group|device|floorplan|integration|helper|computed_source|block", "target_id": "<existing id; update/delete only>", "label": "<short review label>", "after": <final entity state>, "warnings": ["<optional warning>"]}}]}}

Rules:
- Reference existing entities in CONTEXT or entities explicitly created in this same plan. New entities need unique descriptive IDs; never invent existing target IDs. Put dependencies before callers: shared functions, blocks/helpers/sources, then routines. Unknown references and dependency cycles are rejected.
- CONTEXT.automation_catalog lists reusable signatures, helper computations, scenes/groups and timezone even when they were not attached. Attached/matched entities contain full bodies. Reuse only entities that actually fit.
- If essential behavior is ambiguous or a required physical device is missing, use an answer to ask a focused question instead of guessing an unrelated target.
- CONTEXT.live_state holds current device values, configured integrations, and a bounded tail of recent server logs (oldest first). Consult it for questions about the current state or why something did or did not happen. It is read-only background and never a plan target.
- create requires "after" with a new unique "id"; it must not include target_id.
- update requires target_id plus an "after" patch; "after" is merged over the current entity, so include only the fields that change.
- delete requires target_id and must not include "after".
- Ids match [A-Za-z0-9_.-]{{1,64}}.
- At most 40 operations. Prefer the smallest plan that fulfills the request.
- Never include secrets or credentials. Integration secret fields are omitted from snapshots; leave them out and they keep their stored values on update.
- Return only the JSON object, without markdown or code fences.

Per-kind shapes:
Group:
{{"id": "<id>", "name": "<name>", "hidden": false, "devices": [{{"integration_id": "<id>", "device_id": "<id>"}}], "linked_groups": ["<group id>"]}}

Scene:
{{"id": "<id>", "name": "<name>", "hidden": false, "script": null, "device_states": {{"<integration_id>/<device_id>": {{"power": true, "brightness": 0.7, "color": {{"h": 320, "s": 0.8}}}}}}, "group_states": {{"<group id>": {{"power": true}}}}, "group_state_order": []}}
- Device state fields are optional; set only what the scene should change.
- A device_states value may instead be a scene link {{"scene_id": "<scene id>"}} or a device link.
- Only set color when devices[].capabilities.color is true.

Routine (v2 only):
{{"id": "<id>", "name": "<name>", "enabled": false, "semantics_version": 2, "definition_v2": <RoutineDefinitionV2>}}
- "enabled" defaults to false; set true when the user asked for an active automation.

Device (update/delete only; devices are discovered from integrations and can never be created here):
{{"device_key": "<integration_id>/<device_id>", "display_name": "<new label>"}}
- display_name null or "" clears the custom label and restores the device name.

Floorplan:
{{"id": "<id>", "name": "<name>"}}

Integration:
{{"id": "<id>", "plugin": "<mqtt|circadian|cron|timer|dummy|random>", "enabled": true, "config": {{ ... }}}}
- Secret fields (for example mqtt "password") are never shown; omit them and the stored value is kept on update.

Helper:
{{"id": "<id>", "name": "<name>", "kind": {{"kind": "boolean"}}, "initial_value": false, "persistence": "durable"}}
- kind is one of {{"kind":"boolean"}}, {{"kind":"string"}}, {{"kind":"enum","options":["a","b"]}}, {{"kind":"number","min":0,"max":100}}.
- persistence is "durable" (default) or "session"; initial_value must match the declared kind.

Computed source:
{{"id": "<id>", "name": "<name>", "enabled": true, "timezone": "Europe/Helsinki", "refresh_interval_ms": 60000, "compute": <SourceCompute>}}
- Prefer the circadian_compat compute shape shown in the catalog or an existing source snapshot; scripts are a last resort.

    {ROUTINE_DEFINITION_REFERENCE}

CONTEXT:
{context_json}"#
    )
}

/// Unified chat prompt: route the prompt to an immediate light-state action or
/// to a reviewed configuration plan, then follow the matching contract.
fn chat_system_prompt(context_json: &str) -> String {
    format!(
        r#"You are the homectl assistant. Decide which single JSON response fits the request and include a top-level "kind" field:
- {{"kind": "action", "summary": "<one short sentence>", "changes": [{{"device_key": "integration/device", "power": true, "brightness": 0.4, "color": {{"h": 320, "s": 0.8}}}}]}} for one-off light-state changes to devices listed under "controllable_devices". Omit fields you do not want to change; brightness is 0..1; color h is degrees and s is 0..1 and only allowed when the device's capabilities allow color; resolve room or group names to their member device keys. Never invent device keys.
- {{"kind": "plan", ...}} for configuration changes, following the plan contract below.
- {{"kind": "answer", "answer": "<concise markdown prose>"}} when the user asks a question, wants an explanation, or needs troubleshooting that does not require changing configuration. Ground every claim in CONTEXT.config: use live_state.devices for current values, live_state.integrations for connected systems, and live_state.recent_logs for what the server just did. If the logs do not show the answer, say what you can and cannot tell from the recent sample. Never claim to have changed anything; answers write nothing.

Always include "threadName": a short (2-5 word) title for this conversation, for example "Entryway motion lights".

Prefer "answer" for questions and explanations. Use "action" or "plan" only when the user asks for a change to happen; nothing is written until the user applies.

Use CONTEXT.config.live_state (current device values, integrations, recent server logs) to answer troubleshooting questions about the current state or recent behavior.

{PLAN_PROMPT}"#,
        PLAN_PROMPT = plan_system_prompt(context_json)
            .replace("CONTEXT.live_state", "CONTEXT.config.live_state")
            .replace(
                "CONTEXT.automation_catalog",
                "CONTEXT.config.automation_catalog"
            ),
    )
}

// ============================================================================
// Plan validation
// ============================================================================

#[derive(Debug, Deserialize)]
struct RoutinePlanState {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    semantics_version: Option<i32>,
    #[serde(default)]
    definition_v2: Option<Value>,
    #[serde(default)]
    rules: Option<Value>,
    #[serde(default)]
    actions: Option<Value>,
}

/// Tolerant scene body: omitted optional fields default, so a model can send
/// only the fields the scene needs.
#[derive(Debug, Deserialize)]
struct ScenePlanState {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    device_states: HashMap<String, Value>,
    #[serde(default)]
    group_states: HashMap<String, Value>,
    #[serde(default)]
    group_state_order: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GroupPlanState {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default)]
    devices: Vec<config_queries::GroupDeviceRow>,
    #[serde(default)]
    linked_groups: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct DevicePlanState {
    #[serde(default)]
    device_key: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FloorplanPlanState {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IntegrationPlanState {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    plugin: Option<String>,
    #[serde(default)]
    config: Value,
    #[serde(default)]
    enabled: Option<bool>,
}

/// Validates provider operations against the live snapshot and normalizes
/// their state into reviewable `before`/`after` bodies.
struct PlanValidation<'a> {
    snapshot: &'a RuntimeSnapshot,
    catalog: StdMutex<ConfigCatalog>,
    device_keys: HashSet<String>,
    group_ids: HashSet<String>,
    scene_ids: HashSet<String>,
    /// Ids created by earlier operations of this same plan: a plan may reference
    /// what it creates, so they are staged as each operation is validated.
    /// Interior mutability keeps validation `&self` for the apply path, which
    /// revalidates each operation against the same instance as it runs.
    created_ids: StdMutex<HashSet<String>>,
    staged_groups: StdMutex<HashSet<String>>,
    staged_scenes: StdMutex<HashSet<String>>,
    staged_config: StdMutex<ConfigExport>,
}

impl<'a> PlanValidation<'a> {
    fn new(snapshot: &'a RuntimeSnapshot, catalog: ConfigCatalog) -> Self {
        Self {
            device_keys: snapshot
                .devices
                .0
                .keys()
                .map(DeviceKey::to_string)
                .collect(),
            group_ids: snapshot
                .runtime_config
                .groups
                .iter()
                .map(|group| group.id.clone())
                .collect(),
            scene_ids: snapshot
                .runtime_config
                .scenes
                .iter()
                .map(|scene| scene.id.clone())
                .collect(),
            snapshot,
            catalog: StdMutex::new(catalog),
            created_ids: StdMutex::new(HashSet::new()),
            staged_groups: StdMutex::new(HashSet::new()),
            staged_scenes: StdMutex::new(HashSet::new()),
            staged_config: StdMutex::new((*snapshot.runtime_config).clone()),
        }
    }

    /// Live group ids plus anything earlier operations of this plan create.
    fn group_exists(&self, id: &str) -> bool {
        self.group_ids.contains(id)
            || self
                .staged_groups
                .lock()
                .map(|ids| ids.contains(id))
                .unwrap_or(false)
    }

    /// Live scene ids plus anything earlier operations of this plan create.
    fn scene_exists(&self, id: &str) -> bool {
        self.scene_ids.contains(id)
            || self
                .staged_scenes
                .lock()
                .map(|ids| ids.contains(id))
                .unwrap_or(false)
    }

    fn entity_snapshot(&self, kind: AssistantEntityKind, id: &str) -> Option<Value> {
        entity_snapshot(self.snapshot, kind, id)
    }

    fn candidate_config(
        &self,
        kind: AssistantEntityKind,
        body: &Value,
    ) -> Result<ConfigExport, String> {
        let mut config = self
            .staged_config
            .lock()
            .map_err(|_| "Configuration catalog unavailable")?
            .clone();
        macro_rules! upsert {
            ($rows:ident, $ty:ty) => {{
                let row: $ty = serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
                config.$rows.retain(|old| old.id != row.id);
                config.$rows.push(row);
            }};
        }
        match kind {
            AssistantEntityKind::Block => upsert!(blocks, AutomationBlock),
            AssistantEntityKind::Helper => upsert!(helpers, HelperDefinition),
            AssistantEntityKind::ComputedSource => upsert!(sources, SourceDefinition),
            AssistantEntityKind::Routine => upsert!(routines, RoutineRow),
            AssistantEntityKind::Group => upsert!(groups, GroupRow),
            AssistantEntityKind::Scene => upsert!(scenes, SceneRow),
            _ => {}
        }
        Ok(config)
    }

    fn validate_reuse_candidate(
        &self,
        kind: AssistantEntityKind,
        body: &Value,
        op_id: &str,
    ) -> Result<(), String> {
        let config = self.candidate_config(kind, body)?;
        let catalog = ConfigCatalog::new(self.snapshot.devices.0.keys().cloned(), &config);
        super::validate_routine_catalog(&config, &catalog)
            .map_err(|error| format!("{op_id}: {error}"))
    }

    fn build_operation(
        &self,
        op_id: String,
        operation: ProviderOperation,
    ) -> Result<AssistantOperation, String> {
        let mut warnings: Vec<String> = operation
            .warnings
            .into_iter()
            .map(|warning| warning.trim().to_string())
            .filter(|warning| !warning.is_empty())
            .collect();

        let (target_id, before, after) = match operation.op {
            AssistantOpKind::Create => {
                if operation.target_id.is_some() {
                    return Err(format!(
                        "{op_id}: create operations must not include targetId"
                    ));
                }
                let body = operation
                    .after
                    .ok_or_else(|| format!("{op_id}: create requires an 'after' body"))?;
                let after =
                    self.validate_entity(operation.kind, None, body, &op_id, &mut warnings)?;
                let id = operation_entity_id(&after)
                    .ok_or_else(|| format!("{op_id}: 'after' must include an id"))?;
                if self.entity_snapshot(operation.kind, &id).is_some() {
                    return Err(format!(
                        "{op_id}: {} '{id}' already exists",
                        operation.kind.code()
                    ));
                }
                if !self
                    .created_ids
                    .lock()
                    .map(|mut ids| ids.insert(format!("{}:{id}", operation.kind.code())))
                    .unwrap_or(true)
                {
                    return Err(format!(
                        "{op_id}: {} '{id}' is created twice in this plan",
                        operation.kind.code()
                    ));
                }
                // Later operations of this plan may reference what this one
                // creates, so stage it for the remainder of the validation.
                match operation.kind {
                    AssistantEntityKind::Group => {
                        if let Ok(mut ids) = self.staged_groups.lock() {
                            ids.insert(id.clone());
                        }
                    }
                    AssistantEntityKind::Scene => {
                        if let Ok(mut ids) = self.staged_scenes.lock() {
                            ids.insert(id.clone());
                        }
                    }
                    _ => {}
                }
                (None, None, Some(after))
            }
            AssistantOpKind::Update => {
                let target_id =
                    required_target(operation.target_id, operation.op, operation.kind, &op_id)?;
                let before = self
                    .entity_snapshot(operation.kind, &target_id)
                    .ok_or_else(|| {
                        format!(
                            "{op_id}: unknown {} target '{target_id}'",
                            operation.kind.code()
                        )
                    })?;
                let patch = operation
                    .after
                    .ok_or_else(|| format!("{op_id}: update requires an 'after' body"))?;
                let merged = merge_operation_body(operation.kind, &before, &patch);
                let after = self.validate_entity(
                    operation.kind,
                    Some(&target_id),
                    merged,
                    &op_id,
                    &mut warnings,
                )?;
                (Some(target_id), Some(before), Some(after))
            }
            AssistantOpKind::Delete => {
                let target_id =
                    required_target(operation.target_id, operation.op, operation.kind, &op_id)?;
                if operation.after.is_some() {
                    return Err(format!("{op_id}: delete must not include an 'after' body"));
                }
                let before = self
                    .entity_snapshot(operation.kind, &target_id)
                    .ok_or_else(|| {
                        format!(
                            "{op_id}: unknown {} target '{target_id}'",
                            operation.kind.code()
                        )
                    })?;
                warnings.push(format!(
                    "Deleting {} '{target_id}' is permanent.",
                    operation.kind.code()
                ));
                let references = self.reference_warnings(operation.kind, &target_id);
                if operation.kind == AssistantEntityKind::Block && !references.is_empty() {
                    return Err(format!(
                        "{op_id}: block '{target_id}' is in use; remove its callers first"
                    ));
                }
                warnings.extend(references);
                if let Ok(mut config) = self.staged_config.lock() {
                    match operation.kind {
                        AssistantEntityKind::Block => {
                            config.blocks.retain(|row| row.id != target_id);
                        }
                        AssistantEntityKind::Routine => {
                            config.routines.retain(|row| row.id != target_id);
                        }
                        AssistantEntityKind::Helper => {
                            config.helpers.retain(|row| row.id.0 != target_id);
                        }
                        AssistantEntityKind::ComputedSource => {
                            config.sources.retain(|row| row.id.0 != target_id);
                        }
                        _ => {}
                    }
                    *self
                        .catalog
                        .lock()
                        .map_err(|_| "Routine catalog unavailable")? =
                        ConfigCatalog::new(self.snapshot.devices.0.keys().cloned(), &config);
                }

                (Some(target_id), Some(before), None)
            }
        };

        let label = operation
            .label
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty())
            .unwrap_or_else(|| {
                default_operation_label(
                    operation.op,
                    operation.kind,
                    target_id.as_deref(),
                    after.as_ref(),
                    before.as_ref(),
                )
            });

        if let Some(body) = &after {
            let config = self.candidate_config(operation.kind, body)?;
            *self
                .staged_config
                .lock()
                .map_err(|_| "Configuration catalog unavailable")? = config;
            if let Some(id) = operation_entity_id(body) {
                self.catalog
                    .lock()
                    .map_err(|_| "Routine catalog unavailable")?
                    .stage_created(operation.kind.code(), &id, body);
            }
        }

        Ok(AssistantOperation {
            op_id,
            op: operation.op,
            kind: operation.kind,
            target_id,
            label,
            before,
            after,
            warnings,
        })
    }

    fn validate_entity(
        &self,
        kind: AssistantEntityKind,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
        warnings: &mut Vec<String>,
    ) -> Result<Value, String> {
        match kind {
            AssistantEntityKind::Routine => self.validate_routine(target_id, body, op_id, warnings),
            AssistantEntityKind::Scene => self.validate_scene(target_id, body, op_id),
            AssistantEntityKind::Group => self.validate_group(target_id, body, op_id),
            AssistantEntityKind::Device => self.validate_device(target_id, body, op_id),
            AssistantEntityKind::Floorplan => self.validate_floorplan(target_id, body, op_id),
            AssistantEntityKind::Integration => self.validate_integration(target_id, body, op_id),
            AssistantEntityKind::Block => self.validate_block(target_id, body, op_id),
            AssistantEntityKind::Helper => self.validate_helper(target_id, body, op_id),
            AssistantEntityKind::ComputedSource => self.validate_source(target_id, body, op_id),
        }
    }

    fn validate_routine(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
        warnings: &mut Vec<String>,
    ) -> Result<Value, String> {
        let state: RoutinePlanState = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid routine body: {error}"))?;
        let id = state
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{op_id}: routine body requires an id"))?;
        validate_entity_id(id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: routine id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        let name = state
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| format!("{op_id}: routine body requires a name"))?;
        if state.rules.as_ref().is_some_and(has_plan_content)
            || state.actions.as_ref().is_some_and(has_plan_content)
        {
            return Err(format!(
                "{op_id}: only v2 routines are supported; provide definition_v2"
            ));
        }
        if state.semantics_version.is_some_and(|version| version != 2) {
            return Err(format!("{op_id}: only v2 routines are supported"));
        }
        let definition = state
            .definition_v2
            .ok_or_else(|| format!("{op_id}: routine body requires definition_v2"))?;
        {
            let catalog = self
                .catalog
                .lock()
                .map_err(|_| format!("{op_id}: routine catalog unavailable"))?;
            automation::compile_definition_value(&definition, &catalog).map_err(|report| {
                format!("{op_id}: invalid routine definition: {}", report.summary())
            })?;
        }
        if let Some(warning) = program_warning(&definition) {
            warnings.push(warning);
        }

        let row = RoutineRow {
            id: id.to_string(),
            name: name.to_string(),
            enabled: state.enabled.unwrap_or(false),
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(definition),
            rules: json!([]),
            actions: json!([]),
        };
        serde_json::to_value(&row)
            .map_err(|error| format!("{op_id}: routine body could not be normalized: {error}"))
    }

    fn validate_scene(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let state: ScenePlanState = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid scene body: {error}"))?;
        let id = state
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{op_id}: scene body requires an id"))?;
        validate_entity_id(id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: scene id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        let name = state
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| format!("{op_id}: scene body requires a name"))?;
        for device_key in state.device_states.keys() {
            if !self.device_keys.contains(device_key) {
                return Err(format!(
                    "{op_id}: scene references unknown device '{device_key}'"
                ));
            }
        }
        for group_id in state
            .group_states
            .keys()
            .chain(state.group_state_order.iter())
        {
            if !self.group_exists(group_id) {
                return Err(format!(
                    "{op_id}: scene references unknown group '{group_id}'"
                ));
            }
        }
        for (device_key, config_value) in &state.device_states {
            let config: SceneDeviceConfig =
                serde_json::from_value(config_value.clone()).map_err(|error| {
                    format!("{op_id}: invalid state for device '{device_key}': {error}")
                })?;
            if let SceneDeviceConfig::SceneLink(link) = config {
                if !self.scene_exists(&link.scene_id.to_string()) {
                    return Err(format!(
                        "{op_id}: scene '{device_key}' links to unknown scene '{}'",
                        link.scene_id
                    ));
                }
            }
        }

        let scene = SceneRow {
            id: id.to_string(),
            name: name.to_string(),
            hidden: state.hidden.unwrap_or(false),
            script: state.script,
            device_states: state.device_states,
            group_states: state.group_states,
            group_state_order: state.group_state_order,
        };
        serde_json::to_value(&scene)
            .map_err(|error| format!("{op_id}: scene body could not be normalized: {error}"))
    }

    fn validate_group(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let state: GroupPlanState = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid group body: {error}"))?;
        let id = state
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{op_id}: group body requires an id"))?;
        validate_entity_id(id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: group id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        let name = state
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| format!("{op_id}: group body requires a name"))?;
        for device in &state.devices {
            let device_key = format!("{}/{}", device.integration_id, device.device_id);
            if !self.device_keys.contains(&device_key) {
                return Err(format!(
                    "{op_id}: group references unknown device '{device_key}'"
                ));
            }
        }
        for linked in &state.linked_groups {
            if linked == id {
                return Err(format!("{op_id}: group cannot link to itself"));
            }
            if !self.group_exists(linked) {
                return Err(format!("{op_id}: group links to unknown group '{linked}'"));
            }
        }

        let group = GroupRow {
            id: id.to_string(),
            name: name.to_string(),
            hidden: state.hidden.unwrap_or(false),
            devices: state.devices,
            linked_groups: state.linked_groups,
        };
        serde_json::to_value(&group)
            .map_err(|error| format!("{op_id}: group body could not be normalized: {error}"))
    }

    /// Devices are discovered from integrations, so a plan can only update or
    /// delete one. `after` carries the user-visible label override.
    fn validate_device(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let Some(target_id) = target_id else {
            return Err(format!(
                "{op_id}: devices are discovered from integrations and cannot be created here"
            ));
        };
        let state: DevicePlanState = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid device body: {error}"))?;
        let device_key = state
            .device_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .ok_or_else(|| format!("{op_id}: device body requires device_key"))?;
        if device_key != target_id {
            return Err(format!(
                "{op_id}: device key '{device_key}' does not match targetId '{target_id}'"
            ));
        }
        if !self.device_keys.contains(device_key) {
            return Err(format!("{op_id}: unknown device '{device_key}'"));
        }
        let display_name = state
            .display_name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty());
        Ok(json!({ "device_key": device_key, "display_name": display_name }))
    }

    fn validate_floorplan(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let state: FloorplanPlanState = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid floorplan body: {error}"))?;
        let id = state
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{op_id}: floorplan body requires an id"))?;
        validate_entity_id(id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: floorplan id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        let name = state
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| format!("{op_id}: floorplan body requires a name"))?;
        let floorplan = FloorplanMetadataRow {
            id: id.to_string(),
            name: name.to_string(),
        };
        serde_json::to_value(&floorplan)
            .map_err(|error| format!("{op_id}: floorplan body could not be normalized: {error}"))
    }

    fn validate_integration(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let state: IntegrationPlanState = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid integration body: {error}"))?;
        let id = state
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{op_id}: integration body requires an id"))?;
        validate_entity_id(id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: integration id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        let plugin = state
            .plugin
            .as_deref()
            .map(str::trim)
            .filter(|plugin| !plugin.is_empty())
            .ok_or_else(|| format!("{op_id}: integration body requires a plugin"))?;
        if !integration_config_schemas()
            .iter()
            .any(|schema| schema.plugin == plugin)
        {
            return Err(format!("{op_id}: unknown integration plugin '{plugin}'"));
        }
        if !state.config.is_null() && !state.config.is_object() {
            return Err(format!("{op_id}: integration config must be a JSON object"));
        }
        let integration = IntegrationRow {
            id: id.to_string(),
            plugin: plugin.to_string(),
            config: state.config,
            enabled: state.enabled.unwrap_or(true),
        };
        serde_json::to_value(&integration)
            .map_err(|error| format!("{op_id}: integration body could not be normalized: {error}"))
    }

    fn validate_block(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let mut block: AutomationBlock = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid block: {error}"))?;
        validate_entity_id(&block.id).map_err(|error| format!("{op_id}: {error}"))?;
        if target_id.is_some_and(|target| target != block.id) {
            return Err(format!("{op_id}: block id does not match targetId"));
        }
        block.revision = 1;
        let body = serde_json::to_value(block).map_err(|error| error.to_string())?;
        self.validate_reuse_candidate(AssistantEntityKind::Block, &body, op_id)?;
        Ok(body)
    }

    fn validate_helper(
        &self,
        target_id: Option<&str>,
        mut body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        // Server-owned computation revisions are optional in provider proposals.
        if let Some(compute) = body.get_mut("compute").and_then(Value::as_object_mut) {
            compute.insert("revision".into(), json!(1));
        }
        let mut definition: HelperDefinition = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid helper body: {error}"))?;
        let id = definition.id.0.trim();
        if id.is_empty() {
            return Err(format!("{op_id}: helper body requires an id"));
        }
        validate_entity_id(id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: helper id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        if let Some(compute) = &mut definition.compute {
            compute.revision = 1;
        }
        definition
            .validate()
            .map_err(|error| format!("{op_id}: invalid helper: {error}"))?;
        let body = serde_json::to_value(&definition).map_err(|error| error.to_string())?;
        self.validate_reuse_candidate(AssistantEntityKind::Helper, &body, op_id)?;
        Ok(body)
    }

    fn validate_source(
        &self,
        target_id: Option<&str>,
        body: Value,
        op_id: &str,
    ) -> Result<Value, String> {
        let mut source: SourceDefinition = serde_json::from_value(body)
            .map_err(|error| format!("{op_id}: invalid computed source body: {error}"))?;
        let id = source.id.0.trim().to_string();
        if id.is_empty() {
            return Err(format!("{op_id}: computed source body requires an id"));
        }
        validate_entity_id(&id).map_err(|error| format!("{op_id}: {error}"))?;
        if let Some(target_id) = target_id {
            if id != target_id {
                return Err(format!(
                    "{op_id}: computed source id '{id}' does not match targetId '{target_id}'"
                ));
            }
        }
        super::sources::validate_source(&source)
            .map_err(|error| format!("{op_id}: invalid computed source: {error}"))?;
        // Revisions are server-owned.
        source.revision = 1;
        let body = serde_json::to_value(&source).map_err(|error| error.to_string())?;
        self.validate_reuse_candidate(AssistantEntityKind::ComputedSource, &body, op_id)?;
        Ok(body)
    }

    /// Approximate, deterministic in-use warnings for deletes. References are
    /// counted from scene/group rows and v2 routine definitions.
    fn reference_warnings(&self, kind: AssistantEntityKind, id: &str) -> Vec<String> {
        let count = match kind {
            AssistantEntityKind::Group => {
                let scenes = self
                    .snapshot
                    .runtime_config
                    .scenes
                    .iter()
                    .filter(|scene| {
                        scene.group_states.contains_key(id)
                            || scene.group_state_order.iter().any(|group| group == id)
                    })
                    .count();
                let groups = self
                    .snapshot
                    .runtime_config
                    .groups
                    .iter()
                    .filter(|group| group.linked_groups.iter().any(|linked| linked == id))
                    .count();
                scenes + groups + self.routine_mentions(id)
            }
            AssistantEntityKind::Scene => {
                let scenes = self
                    .snapshot
                    .runtime_config
                    .scenes
                    .iter()
                    .filter(|scene| {
                        scene
                            .device_states
                            .values()
                            .any(|value| scene_link_id(value).as_deref() == Some(id))
                    })
                    .count();
                scenes + self.routine_mentions(id)
            }
            AssistantEntityKind::Routine => self.routine_mentions(id),
            AssistantEntityKind::Device => {
                let groups = self
                    .snapshot
                    .runtime_config
                    .groups
                    .iter()
                    .filter(|group| {
                        group.devices.iter().any(|device| {
                            format!("{}/{}", device.integration_id, device.device_id) == id
                        })
                    })
                    .count();
                let scenes = self
                    .snapshot
                    .runtime_config
                    .scenes
                    .iter()
                    .filter(|scene| scene.device_states.contains_key(id))
                    .count();
                groups + scenes
            }
            AssistantEntityKind::Block => {
                let config = self.staged_config.lock().unwrap();
                config
                    .blocks
                    .iter()
                    .filter(|block| {
                        block.id != id && automation::blocks::references(&block.body, id)
                    })
                    .count()
                    + config
                        .routines
                        .iter()
                        .filter(|routine| {
                            routine
                                .definition_v2
                                .as_ref()
                                .is_some_and(|body| automation::blocks::references(body, id))
                        })
                        .count()
                    + config
                        .helpers
                        .iter()
                        .filter(|helper| {
                            helper.compute.as_ref().is_some_and(|compute| {
                                automation::blocks::references(&json!(compute.script), id)
                            })
                        })
                        .count()
                    + config
                        .sources
                        .iter()
                        .filter(|source| automation::blocks::references(&json!(source.compute), id))
                        .count()
            }
            AssistantEntityKind::Helper | AssistantEntityKind::ComputedSource => {
                self.routine_mentions(id)
            }
            _ => 0,
        };
        if count == 0 {
            Vec::new()
        } else {
            vec![format!(
                "{count} other configuration(s) still reference this {}; they will treat it as missing.",
                kind.code()
            )]
        }
    }

    fn routine_mentions(&self, id: &str) -> usize {
        self.snapshot
            .runtime_config
            .routines
            .iter()
            .filter(|routine| routine.id != id)
            .filter(|routine| {
                routine
                    .definition_v2
                    .as_ref()
                    .is_some_and(|definition| json_mentions(definition, id))
            })
            .count()
    }
}

fn validate_plan_operations(
    snapshot: &RuntimeSnapshot,
    catalog: ConfigCatalog,
    provider: ProviderPlan,
) -> Result<(String, Vec<AssistantOperation>), String> {
    let summary = provider
        .summary
        .map(|summary| summary.trim().to_string())
        .filter(|summary| !summary.is_empty());
    let validation = PlanValidation::new(snapshot, catalog);

    let pending: Vec<_> = provider
        .operations
        .into_iter()
        .enumerate()
        .map(|(index, operation)| {
            (
                index,
                AssistantOperation {
                    op_id: format!("op-{}", index + 1),
                    op: operation.op,
                    kind: operation.kind,
                    target_id: operation.target_id,
                    label: operation.label.unwrap_or_default(),
                    before: None,
                    after: operation.after,
                    warnings: operation.warnings,
                },
            )
        })
        .collect();
    // Delete ordering needs existing references; only used for ordering, not trusted validation.
    let pending = pending
        .into_iter()
        .map(|(index, mut operation)| {
            if operation.op == AssistantOpKind::Delete {
                operation.before = operation
                    .target_id
                    .as_deref()
                    .and_then(|id| entity_snapshot(snapshot, operation.kind, id));
            }
            (index, operation)
        })
        .collect();
    let mut operations = Vec::new();
    for (_, operation) in order_plan_operations(pending, false)? {
        let provider = ProviderOperation {
            op: operation.op,
            kind: operation.kind,
            target_id: operation.target_id,
            label: Some(operation.label),
            after: operation.after,
            warnings: operation.warnings,
        };
        operations.push(validation.build_operation(operation.op_id, provider)?);
    }

    let summary = summary
        .unwrap_or_else(|| format!("{} proposed configuration operation(s)", operations.len()));
    Ok((summary, operations))
}

fn required_target(
    target_id: Option<String>,
    op: AssistantOpKind,
    kind: AssistantEntityKind,
    op_id: &str,
) -> Result<String, String> {
    target_id
        .map(|target_id| target_id.trim().to_string())
        .filter(|target_id| !target_id.is_empty())
        .ok_or_else(|| {
            format!(
                "{op_id}: {} operations on {} require targetId",
                match op {
                    AssistantOpKind::Create => "create",
                    AssistantOpKind::Update => "update",
                    AssistantOpKind::Delete => "delete",
                },
                kind.code()
            )
        })
}

fn validate_entity_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.chars().count() <= MAX_ENTITY_ID_CHARS
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        });
    if valid {
        Ok(())
    } else {
        Err(format!(
            "id '{id}' must be 1..{MAX_ENTITY_ID_CHARS} characters of [A-Za-z0-9_.-]"
        ))
    }
}

fn operation_entity_id(value: &Value) -> Option<String> {
    value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

/// Whether a legacy v1 routine field actually carries content. Normalized v2
/// rows serialize empty `rules`/`actions` arrays, so those must not be treated
/// as a legacy body.
fn has_plan_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        Value::String(text) => !text.trim().is_empty(),
        _ => true,
    }
}

fn merge_object(base: &Value, patch: &Value) -> Value {
    match (base, patch) {
        (Value::Object(base), Value::Object(patch)) => {
            let mut merged = base.clone();
            for (key, value) in patch {
                merged.insert(key.clone(), value.clone());
            }
            Value::Object(merged)
        }
        _ => patch.clone(),
    }
}

/// Merge an update patch over the current body. Integration `config` objects
/// are merged field by field so a patch that changes one setting keeps the
/// rest (secret fields are already absent from the snapshot and are restored
/// at apply time).
fn merge_operation_body(kind: AssistantEntityKind, before: &Value, patch: &Value) -> Value {
    let mut merged = merge_object(before, patch);
    if kind != AssistantEntityKind::Integration {
        return merged;
    }
    let (Some(base_config), Some(patch_config)) = (before.get("config"), patch.get("config"))
    else {
        return merged;
    };
    if base_config.is_object() && patch_config.is_object() {
        merged["config"] = merge_object(base_config, patch_config);
    }
    merged
}

fn default_operation_label(
    op: AssistantOpKind,
    kind: AssistantEntityKind,
    target_id: Option<&str>,
    after: Option<&Value>,
    before: Option<&Value>,
) -> String {
    let name = after
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            before
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
        })
        .or(target_id)
        .unwrap_or_else(|| kind.code());
    let verb = match op {
        AssistantOpKind::Create => "Create",
        AssistantOpKind::Update => "Update",
        AssistantOpKind::Delete => "Delete",
    };
    format!("{verb} {} '{name}'", kind.code())
}

fn scene_link_id(value: &Value) -> Option<String> {
    let config: SceneDeviceConfig = serde_json::from_value(value.clone()).ok()?;
    match config {
        SceneDeviceConfig::SceneLink(link) => Some(link.scene_id.to_string()),
        _ => None,
    }
}

fn json_mentions(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(text) => text == needle,
        Value::Array(items) => items.iter().any(|item| json_mentions(item, needle)),
        Value::Object(map) => map.values().any(|item| json_mentions(item, needle)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::automation::sources::CIRCADIAN_COMPAT_PRESET_VERSION;
    use crate::db::config_queries::ConfigExport;
    use crate::types::assistant::AssistantMessageRole;
    use crate::types::automation_source::{CircadianCompatParams, SourceCompute};
    use crate::types::color::DeviceColor;
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
            scenario_suite: None,
            blocks: Vec::new(),
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
            device_health: Default::default(),
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
            context_window: DEFAULT_CONTEXT_WINDOW,
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

    fn control_snapshot() -> RuntimeSnapshot {
        let mut export = empty_export();
        export.groups = vec![GroupRow {
            id: "living_room".to_string(),
            name: "Living room".to_string(),
            hidden: false,
            devices: vec![config_queries::GroupDeviceRow {
                integration_id: "dummy".to_string(),
                device_id: "lamp".to_string(),
            }],
            linked_groups: Vec::new(),
        }];
        let lamp = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("lamp"),
            "Living room lamp".to_string(),
            DeviceData::Controllable(crate::types::device::ControllableDevice::new(
                None,
                false,
                Some(0.2),
                None,
                None,
                crate::types::color::Capabilities {
                    brightness: Some(true),
                    hs: true,
                    ..Default::default()
                },
                crate::types::device::ManageKind::Unmanaged,
            )),
            None,
        );
        RuntimeSnapshot {
            device_health: Default::default(),
            runtime_config: std::sync::Arc::new(export),
            devices: std::sync::Arc::new(DevicesState(
                [(lamp.get_device_key(), lamp)].into_iter().collect(),
            )),
            flattened_groups: Default::default(),
            flattened_scenes: Default::default(),
            routine_statuses: Default::default(),
            helper_statuses: Default::default(),
            timers: Default::default(),
            ui_state: Default::default(),
            warming_up: false,
        }
    }

    #[test]
    fn control_catalog_lists_controllable_devices_and_groups() {
        let snapshot = control_snapshot();
        let catalog = build_control_catalog(&snapshot, None);
        assert!(catalog.devices.contains_key("dummy/lamp"));
        assert_eq!(catalog.value["devices"][0]["name"], "Living room lamp");
        assert_eq!(catalog.value["devices"][0]["capabilities"]["color"], true);
        assert_eq!(catalog.value["devices"][0]["groups"][0], "Living room");
        assert_eq!(catalog.value["groups"][0]["name"], "Living room");
        assert_eq!(catalog.value["groups"][0]["device_keys"][0], "dummy/lamp");
    }

    #[test]
    fn control_catalog_scope_limits_devices() {
        let snapshot = control_snapshot();
        let scope = HashSet::from(["dummy/other".to_string()]);
        let catalog = build_control_catalog(&snapshot, Some(&scope));
        assert!(catalog.devices.is_empty());
        assert_eq!(catalog.value["devices"], json!([]));
        assert_eq!(catalog.value["groups"], json!([]));
    }

    #[test]
    fn parse_apply_envelope_validates_the_contract() {
        let envelope = parse_apply_envelope(
            "```json\n{\"summary\":\"done\",\"changes\":[{\"device_key\":\"dummy/lamp\",\"power\":true}]}\n```",
        )
        .unwrap();
        assert_eq!(envelope.summary.as_deref(), Some("done"));
        assert_eq!(envelope.changes.len(), 1);
        assert_eq!(envelope.changes[0].device_key, "dummy/lamp");

        let empty = parse_apply_envelope("{\"summary\":\"nothing to do\",\"changes\":[]}").unwrap();
        assert!(empty.changes.is_empty());

        assert!(parse_apply_envelope("not json").is_err());
        assert!(parse_apply_envelope("{\"changes\":\"nope\"}").is_err());
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

    #[tokio::test]
    async fn assistant_settings_save_preserves_omitted_secrets_and_rejects_stale_secret_changes() {
        use crate::core::state::actor::spawn_state_actor;
        let (mut state, _events) = crate::core::event::tests::test_state();
        state.runtime_config.widget_settings = stored_settings();
        state.runtime_config.widget_settings[0].config["future"] = json!({"keep":true});
        state.publish_snapshot(crate::core::snapshot::SnapshotChanges::all());
        let original = assistant_settings_view(&state.runtime_config.widget_settings);
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), tx);
        let response = update_assistant_settings(
            AssistantSettingsPatch {
                api_key: Some("replacement-secret".into()),
                expected: Some(original.clone()),
                ..Default::default()
            },
            snapshot.clone(),
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(response.status(), StatusCode::OK);
        let body = warp::hyper::body::to_bytes(response.into_body())
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(!text.contains("replacement-secret"));
        let changed = assistant_settings_view(&snapshot.load().runtime_config.widget_settings);
        assert_ne!(original["revisionToken"], changed["revisionToken"]);
        let response = update_assistant_settings(
            AssistantSettingsPatch {
                model: Some("stale".into()),
                expected: Some(original),
                ..Default::default()
            },
            snapshot.clone(),
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = warp::hyper::body::to_bytes(response.into_body())
            .await
            .unwrap();
        assert!(!String::from_utf8(body.to_vec())
            .unwrap()
            .contains("replacement-secret"));
        let response = update_assistant_settings(
            AssistantSettingsPatch {
                context_window: Some(64000),
                expected: Some(changed),
                ..Default::default()
            },
            snapshot.clone(),
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(response.status(), StatusCode::OK);
        let settings = snapshot.load().runtime_config.widget_settings.clone();
        assert_eq!(settings[0].config["api_key"], "replacement-secret");
        assert_eq!(settings[0].config["future"], json!({"keep":true}));
        assert_eq!(assistant_settings_view(&settings)["contextWindow"], 64000);
        let response = update_assistant_settings(
            AssistantSettingsPatch {
                api_key: Some("".into()),
                expected: Some(assistant_settings_view(&settings)),
                ..Default::default()
            },
            snapshot.clone(),
            handle,
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            assistant_settings_view(&snapshot.load().runtime_config.widget_settings)["apiKeySet"],
            false
        );
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
                expected: None,
                model: Some("gpt-test".to_string()),
                api_key: Some("sk-new".to_string()),
                reasoning_effort: Some("HIGH".to_string()),
                max_tokens: Some(4096),
                timeout_ms: Some(30_000),
                context_window: Some(32_000),
                timezone: Some("UTC".to_string()),
            },
        )
        .unwrap();
        assert_eq!(updated["base_url"], "https://api.openai.com/v1/");
        assert_eq!(updated["reasoning_effort"], "high");
        assert_eq!(updated["max_tokens"], 4096);
        assert_eq!(updated["context_window"], 32_000);

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

    // ========================================================================
    // Assistant plan tests
    // ========================================================================

    fn snapshot_with_config(export: ConfigExport) -> RuntimeSnapshot {
        snapshot_with_config_and_devices(export, Vec::new())
    }

    fn snapshot_with_config_and_devices(
        export: ConfigExport,
        devices: Vec<Device>,
    ) -> RuntimeSnapshot {
        RuntimeSnapshot {
            device_health: Default::default(),
            runtime_config: Arc::new(export),
            devices: Arc::new(DevicesState(
                devices
                    .into_iter()
                    .map(|device| (device.get_device_key(), device))
                    .collect(),
            )),
            flattened_groups: Default::default(),
            flattened_scenes: Default::default(),
            routine_statuses: Default::default(),
            helper_statuses: Default::default(),
            timers: Default::default(),
            ui_state: Default::default(),
            warming_up: false,
        }
    }

    fn group_row(id: &str, name: &str) -> GroupRow {
        GroupRow {
            id: id.to_string(),
            name: name.to_string(),
            hidden: false,
            devices: Vec::new(),
            linked_groups: Vec::new(),
        }
    }

    fn search_export() -> ConfigExport {
        let mut export = empty_export();
        export.groups = vec![
            group_row("kitchen", "Kitchen"),
            group_row("kitchen_lights", "Kitchen Lights"),
            group_row("living_room", "Living Room"),
            group_row("living_room_spots", "Living Room Spots"),
        ];
        export
    }

    #[test]
    fn search_ranks_exact_above_prefix_and_substring() {
        let snapshot = snapshot_with_config(search_export());
        let results = search_snapshot(&snapshot, AssistantEntityKind::Group, "kitchen", 30);
        let ids: Vec<&str> = results.iter().map(|result| result.id.as_str()).collect();
        assert_eq!(ids, vec!["kitchen", "kitchen_lights"]);
        assert_eq!(results[0].label, "Kitchen");
        assert_eq!(results[0].kind, AssistantEntityKind::Group);

        // Case-insensitive substring: "room" only hits rank 2, sorted by id.
        let results = search_snapshot(&snapshot, AssistantEntityKind::Group, "ROOM", 30);
        let ids: Vec<&str> = results.iter().map(|result| result.id.as_str()).collect();
        assert_eq!(ids, vec!["living_room", "living_room_spots"]);
    }

    #[test]
    fn search_ignores_entities_without_a_match() {
        let snapshot = snapshot_with_config(search_export());
        let results = search_snapshot(&snapshot, AssistantEntityKind::Group, "zzz", 30);
        assert!(results.is_empty());
    }

    #[test]
    fn search_caps_results() {
        let mut export = empty_export();
        export.groups = (0..35)
            .map(|index| group_row(&format!("group_{index:02}"), &format!("Group {index}")))
            .collect();
        let snapshot = snapshot_with_config(export);
        let results = search_all_kinds(&snapshot, "group", MAX_SEARCH_RESULTS);
        assert_eq!(results.len(), MAX_SEARCH_RESULTS);
    }

    #[test]
    fn prompt_search_merges_tokens_across_kinds() {
        let mut export = search_export();
        export.scenes = vec![SceneRow {
            id: "evening".to_string(),
            name: "Evening Living Room".to_string(),
            hidden: false,
            script: None,
            device_states: HashMap::new(),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        }];
        let snapshot = snapshot_with_config(export);
        let results = search_prompt(&snapshot, "make the living room cozy in the evening");

        let ids: Vec<&str> = results.iter().map(|result| result.id.as_str()).collect();
        assert!(ids.contains(&"living_room"));
        assert!(ids.contains(&"evening"));
        assert!(!ids.contains(&"kitchen"));
    }

    fn validate_provider(
        snapshot: &RuntimeSnapshot,
        plan: Value,
    ) -> Result<(String, Vec<AssistantOperation>), String> {
        let provider: ProviderPlan = serde_json::from_value(plan).unwrap();
        validate_plan_operations(snapshot, catalog_from_snapshot_export(snapshot), provider)
    }

    fn sensor_device() -> Device {
        Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("sensor"),
            "Test sensor".to_string(),
            DeviceData::Sensor(SensorDevice::Boolean { value: true }),
            None,
        )
    }

    #[test]
    fn plan_validation_rejects_unknown_targets() {
        let snapshot = snapshot_with_config(empty_export());
        let error = validate_provider(
            &snapshot,
            json!({
                "summary": "Update a group",
                "operations": [{
                    "op": "update",
                    "kind": "group",
                    "targetId": "ghost",
                    "after": {"name": "Ghost"}
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown group target 'ghost'"), "{error}");
    }

    #[test]
    fn plan_validation_accepts_group_and_scene_creates() {
        let snapshot = control_snapshot();
        let (summary, operations) = validate_provider(
            &snapshot,
            json!({
                "summary": "Set up a movie scene",
                "operations": [
                    {
                        "op": "create",
                        "kind": "group",
                        "label": "Game room",
                        "after": {
                            "id": "game_room",
                            "name": "Game room",
                            "hidden": false,
                            "devices": [{"integration_id": "dummy", "device_id": "lamp"}],
                            "linked_groups": []
                        }
                    },
                    {
                        "op": "create",
                        "kind": "scene",
                        "after": {
                            "id": "movie",
                            "name": "Movie",
                            "hidden": false,
                            "device_states": {"dummy/lamp": {"power": true, "brightness": 0.4}},
                            "group_states": {"living_room": {"power": true}}
                        }
                    }
                ]
            }),
        )
        .unwrap();

        assert_eq!(summary, "Set up a movie scene");
        assert_eq!(operations.len(), 2);
        assert_eq!(operations[0].op_id, "op-1");
        assert_eq!(operations[0].op, AssistantOpKind::Create);
        assert_eq!(operations[0].kind, AssistantEntityKind::Group);
        assert_eq!(
            operations[0].after.as_ref().unwrap()["id"],
            Value::String("game_room".to_string())
        );
        assert!(operations[0].before.is_none());
        assert_eq!(operations[1].kind, AssistantEntityKind::Scene);
        assert!(operations[1].after.is_some());
    }

    #[test]
    fn plan_validation_stages_created_entities_for_later_operations() {
        let snapshot = snapshot_with_config_and_devices(empty_export(), vec![sensor_device()]);
        let mut definition = valid_definition();
        definition["program"]["steps"] = json!([{
            "action": "set_helper",
            "id": "a1",
            "helper": "night_mode",
            "value": true
        }]);

        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [
                    {
                        "op": "create",
                        "kind": "helper",
                        "after": {
                            "id": "night_mode",
                            "name": "Night mode",
                            "kind": {"kind": "boolean"},
                            "initial_value": false
                        }
                    },
                    {
                        "op": "create",
                        "kind": "routine",
                        "after": {
                            "id": "night",
                            "name": "Night",
                            "definition_v2": definition
                        }
                    }
                ]
            }),
        )
        .unwrap();
        assert_eq!(operations.len(), 2);

        // The same reference is still rejected when nothing creates it.
        let mut orphan = valid_definition();
        orphan["program"]["steps"] = json!([{
            "action": "set_helper",
            "id": "a1",
            "helper": "ghost_mode",
            "value": true
        }]);
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "routine",
                    "after": {"id": "broken", "name": "Broken", "definition_v2": orphan}
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("ghost_mode"), "{error}");
    }

    #[test]
    fn plan_validation_stages_created_groups_for_later_references() {
        let snapshot = control_snapshot();
        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [
                    {
                        "op": "create",
                        "kind": "group",
                        "after": {
                            "id": "patio",
                            "name": "Patio",
                            "devices": [{"integration_id": "dummy", "device_id": "lamp"}],
                            "linked_groups": []
                        }
                    },
                    {
                        "op": "create",
                        "kind": "scene",
                        "after": {
                            "id": "patio_evening",
                            "name": "Patio evening",
                            "group_states": {"patio": {"power": true}}
                        }
                    }
                ]
            }),
        )
        .unwrap();
        assert_eq!(operations.len(), 2);

        // A group name no operation creates is still an unknown id.
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [
                    {
                        "op": "create",
                        "kind": "group",
                        "after": {
                            "id": "patio",
                            "name": "Patio",
                            "devices": [{"integration_id": "dummy", "device_id": "lamp"}],
                            "linked_groups": []
                        }
                    },
                    {
                        "op": "create",
                        "kind": "scene",
                        "after": {
                            "id": "garden_evening",
                            "name": "Garden evening",
                            "group_states": {"garden": {"power": true}}
                        }
                    }
                ]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown group 'garden'"), "{error}");
    }

    #[test]
    fn plan_validation_rejects_recreating_an_id_in_one_plan() {
        let snapshot = snapshot_with_config(empty_export());
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [
                    {
                        "op": "create",
                        "kind": "helper",
                        "after": {
                            "id": "night_mode",
                            "name": "Night mode",
                            "kind": {"kind": "boolean"},
                            "initial_value": false
                        }
                    },
                    {
                        "op": "create",
                        "kind": "helper",
                        "after": {
                            "id": "night_mode",
                            "name": "Night mode again",
                            "kind": {"kind": "boolean"},
                            "initial_value": false
                        }
                    }
                ]
            }),
        )
        .unwrap_err();
        assert!(error.contains("created twice"), "{error}");
    }

    #[test]
    fn plan_validation_builds_operations_and_merges_updates() {
        let snapshot = control_snapshot();
        let (summary, operations) = validate_provider(
            &snapshot,
            json!({
                "summary": "Rename the living room group",
                "operations": [{
                    "op": "update",
                    "kind": "group",
                    "targetId": "living_room",
                    "after": {"name": "Lounge"}
                }]
            }),
        )
        .unwrap();

        assert_eq!(summary, "Rename the living room group");
        assert_eq!(operations.len(), 1);
        let operation = &operations[0];
        assert_eq!(operation.op_id, "op-1");
        assert_eq!(operation.op, AssistantOpKind::Update);
        assert_eq!(operation.kind, AssistantEntityKind::Group);
        assert_eq!(operation.target_id.as_deref(), Some("living_room"));
        assert!(operation.before.is_some());
        let after = operation.after.as_ref().unwrap();
        assert_eq!(after["name"], "Lounge");
        // The patch was merged over the existing entity.
        assert_eq!(
            after["devices"][0]["device_id"],
            Value::String("lamp".to_string())
        );
    }

    #[test]
    fn plan_validation_rejects_group_with_unknown_device() {
        let snapshot = control_snapshot();
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "group",
                    "after": {
                        "id": "game_room",
                        "name": "Game room",
                        "hidden": false,
                        "devices": [{"integration_id": "dummy", "device_id": "ghost"}],
                        "linked_groups": []
                    }
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown device 'dummy/ghost'"), "{error}");
    }

    #[test]
    fn plan_validation_validates_scene_references() {
        let snapshot = control_snapshot();
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "scene",
                    "after": {
                        "id": "movie",
                        "name": "Movie",
                        "device_states": {"dummy/ghost": {"power": true}}
                    }
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown device 'dummy/ghost'"), "{error}");

        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "delete",
                    "kind": "scene",
                    "targetId": "evening"
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown scene target 'evening'"), "{error}");
    }

    #[test]
    fn plan_validation_compiles_routine_definitions() {
        let snapshot = snapshot_with_config_and_devices(empty_export(), vec![sensor_device()]);
        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "routine",
                    "after": {
                        "id": "morning",
                        "name": "Morning",
                        "enabled": true,
                        "semantics_version": 2,
                        "definition_v2": valid_definition()
                    }
                }]
            }),
        )
        .unwrap();
        assert_eq!(operations[0].after.as_ref().unwrap()["enabled"], true);
        assert_eq!(
            operations[0].after.as_ref().unwrap()["semantics_version"],
            2
        );

        let mut invalid = valid_definition();
        invalid["program"]["steps"][0]["device"]["device_id"] =
            Value::String("missing".to_string());
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "routine",
                    "after": {
                        "id": "broken",
                        "name": "Broken",
                        "definition_v2": invalid
                    }
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("missing"), "{error}");
    }

    #[test]
    fn plan_validation_rejects_device_creates_and_malformed_shapes() {
        let snapshot = snapshot_with_config(empty_export());
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "device",
                    "after": {"id": "x", "name": "X"}
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("cannot be created here"), "{error}");

        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "delete",
                    "kind": "group",
                    "targetId": "living_room",
                    "after": {"id": "living_room"}
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("delete must not include"), "{error}");

        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "update",
                    "kind": "group",
                    "targetId": "living_room"
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown group target"), "{error}");
    }

    #[test]
    fn plan_validation_warns_about_referenced_deletes() {
        let mut export = empty_export();
        export.groups = vec![
            GroupRow {
                devices: Vec::new(),
                ..group_row("living_room", "Living Room")
            },
            GroupRow {
                linked_groups: vec!["living_room".to_string()],
                ..group_row("downstairs", "Downstairs")
            },
        ];
        export.scenes = vec![SceneRow {
            id: "evening".to_string(),
            name: "Evening".to_string(),
            hidden: false,
            script: None,
            device_states: HashMap::new(),
            group_states: HashMap::from([("living_room".to_string(), json!({"power": true}))]),
            group_state_order: vec!["living_room".to_string()],
        }];
        let snapshot = snapshot_with_config(export);

        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "delete",
                    "kind": "group",
                    "targetId": "living_room"
                }]
            }),
        )
        .unwrap();
        let warnings = &operations[0].warnings;
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("2 other configuration(s)")));
        assert!(operations[0].after.is_none());
        assert!(operations[0].before.is_some());
    }

    fn test_plan(id: &str, created_at_ms: i64) -> AssistantPlan {
        AssistantPlan {
            plan_id: id.to_string(),
            summary: "test".to_string(),
            operations: Vec::new(),
            created_at_ms,
        }
    }

    #[test]
    fn plan_store_keeps_plans_without_a_timer() {
        let store = PlanStore::new(10);
        store.insert_plan(test_plan("plan-1", now_ms()));
        std::thread::sleep(Duration::from_millis(5));
        assert!(store.get_plan("plan-1").is_some());
        assert_eq!(store.plan_len(), 1);
    }

    #[test]
    fn plan_store_evicts_the_oldest_plan() {
        let store = PlanStore::new(2);
        let now = now_ms();
        store.insert_plan(test_plan("plan-1", now));
        store.insert_plan(test_plan("plan-2", now + 1_000));
        store.insert_plan(test_plan("plan-3", now + 2_000));

        assert_eq!(store.plan_len(), 2);
        assert!(store.get_plan("plan-1").is_none());
        assert!(store.get_plan("plan-2").is_some());
        assert!(store.get_plan("plan-3").is_some());
    }

    #[test]
    fn plan_system_prompt_documents_contract_and_context() {
        let prompt = plan_system_prompt("{\"devices\":[]}");
        assert!(prompt.contains("target_id"));
        assert!(prompt.contains("RoutineDefinitionV2"));
        assert!(prompt.contains("\"devices\":[]"));
    }

    #[test]
    fn chat_system_prompt_routes_actions_plans_and_answers() {
        let prompt = chat_system_prompt("{\"config\":{}}");
        assert!(prompt.contains("\"kind\": \"action\""));
        assert!(prompt.contains("\"kind\": \"answer\""));
        assert!(prompt.contains("controllable_devices"));
        assert!(prompt.contains("CONTEXT.config.automation_catalog"));
        assert!(prompt.contains("CONTEXT.config.live_state"));
        assert!(prompt.contains("live_state"));
        assert!(prompt.contains("target_id"));
    }

    #[test]
    fn history_keeps_newest_turns_and_truncates_long_messages() {
        let history: Vec<AssistantHistoryMessage> = (0..20)
            .map(|index| AssistantHistoryMessage {
                role: if index % 2 == 0 {
                    AssistantMessageRole::User
                } else {
                    AssistantMessageRole::Assistant
                },
                content: format!("turn {index}"),
                proposal: None,
                outcome: None,
            })
            .chain(std::iter::once(AssistantHistoryMessage {
                role: AssistantMessageRole::User,
                content: "x".repeat(MAX_HISTORY_MESSAGE_CHARS + 500),
                proposal: None,
                outcome: None,
            }))
            .collect();

        let messages = history_messages(&history);
        assert_eq!(messages.len(), MAX_HISTORY_MESSAGES);
        // The newest turn is the oversized one; it is truncated, not dropped.
        assert_eq!(messages.first().unwrap()["content"], "turn 5");
        assert_eq!(messages.last().unwrap()["role"], "user");
        // `truncate` keeps the cap plus a trailing ellipsis marker.
        assert!(
            messages.last().unwrap()["content"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                <= MAX_HISTORY_MESSAGE_CHARS + 1
        );
    }

    #[test]
    fn sse_frames_split_deltas_usage_and_done() {
        let mut buffer: Vec<u8> = Vec::new();
        buffer.extend_from_slice(
            b"data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
        );
        let frames = drain_sse_frames(&mut buffer);
        assert_eq!(frames.len(), 2);
        match &frames[0] {
            SseFrame::Delta(text) => assert_eq!(text, "Hel"),
            other => panic!("unexpected frame: {other:?}"),
        }
        // A partial trailing frame stays buffered.
        buffer.extend_from_slice(b"data: {\"usage\":{\"prompt_tokens\":3");
        assert!(drain_sse_frames(&mut buffer).is_empty());
        buffer.extend_from_slice(b",\"completion_tokens\":2,\"total_tokens\":5}}\n\n");
        match &drain_sse_frames(&mut buffer)[0] {
            SseFrame::Usage(usage) => {
                assert_eq!(usage.prompt_tokens, 3);
                assert_eq!(usage.total_tokens, 5);
            }
            other => panic!("unexpected frame: {other:?}"),
        }

        buffer.extend_from_slice(b"data: [DONE]\n\n");
        assert!(matches!(drain_sse_frames(&mut buffer)[0], SseFrame::Done));
        buffer.extend_from_slice(b": keep-alive\n\n");
        assert!(matches!(drain_sse_frames(&mut buffer)[0], SseFrame::Ignore));
    }

    #[tokio::test]
    async fn dropping_chat_response_cancels_pending_provider_stream() {
        use futures_util::StreamExt;
        let provider = warp::any().map(|| {
            let initial = futures_util::stream::once(async {
                Ok::<_, Infallible>(Bytes::from_static(
                    b"data: {\"choices\":[{\"delta\":{\"content\":\"Still thinking\"}}]}\n\n",
                ))
            });
            let stream =
                initial.chain(futures_util::stream::pending::<Result<Bytes, Infallible>>());
            warp::http::Response::builder()
                .header("content-type", "text/event-stream")
                .body(warp::hyper::Body::wrap_stream(stream))
                .unwrap()
        });
        let (addr, server) = warp::serve(provider).bind_ephemeral(([127, 0, 0, 1], 0));
        let provider_task = tokio::spawn(server);
        let mut config = test_config();
        config.base_url = format!("http://{addr}/v1");
        config.timeout_ms = 30_000;
        let (tx, mut rx) = mpsc::channel(8);
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let response_body = warp::hyper::Body::wrap_stream(CancelOnDrop {
            inner: futures_util::stream::pending::<Result<Bytes, Infallible>>(),
            cancel: cancel_tx,
        });
        let work = tokio::spawn(async move {
            let mut sink = EventSink {
                tx,
                cancel: cancel_rx,
            };
            let mut options = ChatOptions {
                json_mode: true,
                reasoning_effort: false,
            };
            chat_streaming(&mut sink, &config, &[], &mut options, "cancel-test").await
        });
        // Wait for actual provider bytes to pass through the stream parser.
        let delta = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(std::str::from_utf8(&delta)
            .unwrap()
            .contains("Still thinking"));
        drop(response_body);
        let result = tokio::time::timeout(Duration::from_secs(2), work)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(result, Err(ChatStreamError::Cancelled)));
        assert!(rx.recv().await.is_none());
        provider_task.abort();
    }

    #[test]
    fn usage_falls_back_to_a_character_estimate() {
        let config = test_config();
        let messages = vec![json!({"role": "user", "content": "x".repeat(40)})];
        let completion = Completion {
            content: "y".repeat(8),
            usage: None,
        };
        let usage = assistant_usage(&config, &completion, &messages);
        assert!(usage.approximate);
        assert_eq!(usage.prompt_tokens, 10);
        assert_eq!(usage.completion_tokens, 2);
        assert_eq!(usage.total_tokens, 12);
        assert_eq!(usage.context_window, DEFAULT_CONTEXT_WINDOW);
    }

    #[test]
    fn usage_prefers_provider_counts() {
        let config = test_config();
        let completion = Completion {
            content: "hello".to_string(),
            usage: Some(ProviderUsage {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
            }),
        };
        let usage = assistant_usage(&config, &completion, &[]);
        assert!(!usage.approximate);
        assert_eq!(usage.total_tokens, 120);
    }

    #[test]
    fn chat_envelope_infers_kind_from_content() {
        let action: ChatEnvelope =
            parse_chat_envelope("{\"changes\":[{\"device_key\":\"dummy/lamp\",\"power\":true}]}")
                .unwrap();
        assert!(action.changes.len() == 1);
        assert!(action.operations.is_empty());

        let plan: ChatEnvelope = parse_chat_envelope(
            "{\"kind\":\"plan\",\"operations\":[{\"op\":\"update\",\"kind\":\"device\",\"target_id\":\"dummy/lamp\"}]}",
        )
        .unwrap();
        assert_eq!(plan.kind, Some(ChatEnvelopeKind::Plan));

        // `text` is accepted as an alias for the answer body.
        let answer: ChatEnvelope =
            parse_chat_envelope("{\"kind\":\"answer\",\"text\":\"Because the timer expired.\"}")
                .unwrap();
        assert_eq!(answer.kind, Some(ChatEnvelopeKind::Answer));
        assert_eq!(answer.answer.as_deref(), Some("Because the timer expired."));
    }

    #[test]
    fn chat_outcome_accepts_answers_and_truncates_them() {
        let snapshot = snapshot_with_config_and_devices(empty_export(), vec![sensor_device()]);
        let catalog = catalog_from_snapshot_export(&snapshot);
        let control = build_control_catalog(&snapshot, None);

        // Kind inference routes a body-only answer to the answer contract.
        let envelope =
            parse_chat_envelope("{\"answer\":\"The office light is on at 40%.\"}").unwrap();
        match build_chat_outcome(&snapshot, catalog.clone(), &control, envelope).unwrap() {
            ChatOutcome::Answer { text } => assert_eq!(text, "The office light is on at 40%."),
            _ => panic!("expected an answer outcome"),
        }

        let envelope = parse_chat_envelope(&format!(
            "{{\"kind\":\"answer\",\"answer\":\"{}\"}}",
            "x".repeat(MAX_ANSWER_CHARS + 100)
        ))
        .unwrap();
        match build_chat_outcome(&snapshot, catalog.clone(), &control, envelope).unwrap() {
            ChatOutcome::Answer { text } => {
                assert_eq!(text.chars().count(), MAX_ANSWER_CHARS + 1);
            }
            _ => panic!("expected an answer outcome"),
        }

        let envelope = parse_chat_envelope("{\"kind\":\"answer\",\"answer\":\"   \"}").unwrap();
        assert!(build_chat_outcome(&snapshot, catalog, &control, envelope).is_err());
    }

    #[test]
    fn live_state_lists_devices_and_bounds_recent_logs() {
        let motion = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("motion"),
            "Patio motion".to_string(),
            DeviceData::Sensor(SensorDevice::Boolean { value: false }),
            None,
        );
        let snapshot =
            snapshot_with_config_and_devices(empty_export(), vec![sensor_device(), motion]);
        let logs: Vec<UiLogEntry> = (0..MAX_LIVE_LOGS + 5)
            .map(|index| UiLogEntry {
                timestamp: format!("2026-01-01T00:00:{index:02}Z"),
                level: LogLevel::Error,
                target: "homectl_server::tests".to_string(),
                message: "x".repeat(MAX_LIVE_LOG_CHARS + 50),
                references: Vec::new(),
                details: None,
            })
            .chain((0..3).map(|index| UiLogEntry {
                timestamp: format!("2026-01-01T00:01:{index:02}Z"),
                level: LogLevel::Debug,
                target: "homectl_server::tests".to_string(),
                message: "debug detail".to_string(),
                references: Vec::new(),
                details: None,
            }))
            .collect();

        let state = build_live_state(&snapshot, &[], "test prompt", logs);
        assert_eq!(state["devices"][0]["device_key"], "dummy/sensor");
        assert_eq!(state["devices"][0]["kind"], "sensor");
        assert!(state["devices"][0]["state"].is_object());
        assert!(state["integrations"].is_array());

        let recent = state["recent_logs"].as_array().unwrap();
        assert_eq!(recent.len(), MAX_LIVE_LOGS);
        assert_eq!(recent[0]["timestamp"], "2026-01-01T00:00:05Z");
        assert_eq!(recent[recent.len() - 1]["level"], "ERROR");
        assert!(recent[0]["message"].as_str().unwrap().chars().count() <= MAX_LIVE_LOG_CHARS + 1);

        // Attached devices are listed first regardless of catalog order.
        let state = build_live_state(
            &snapshot,
            &[AssistantAttachment {
                kind: AssistantEntityKind::Device,
                id: Some("dummy/motion".to_string()),
                label: Some("Patio motion".to_string()),
            }],
            "test prompt",
            Vec::new(),
        );
        assert_eq!(state["devices"][0]["device_key"], "dummy/motion");
        assert_eq!(state["devices"][1]["device_key"], "dummy/sensor");
    }

    // ========================================================================
    // Phase 2 adapters, masking, and apply ordering
    // ========================================================================

    #[test]
    fn plan_validation_accepts_device_and_helper_writes() {
        let snapshot = snapshot_with_config_and_devices(empty_export(), vec![sensor_device()]);

        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [
                    {
                        "op": "update",
                        "kind": "device",
                        "targetId": "dummy/sensor",
                        "after": {"display_name": "Hall sensor"}
                    },
                    {
                        "op": "create",
                        "kind": "helper",
                        "after": {
                            "id": "night_mode",
                            "name": "Night mode",
                            "kind": {"kind": "boolean"},
                            "initial_value": false
                        }
                    }
                ]
            }),
        )
        .unwrap();

        assert_eq!(operations[0].kind, AssistantEntityKind::Device);
        assert_eq!(
            operations[0].after.as_ref().unwrap()["device_key"],
            "dummy/sensor"
        );
        assert_eq!(
            operations[0].after.as_ref().unwrap()["display_name"],
            "Hall sensor"
        );
        assert_eq!(operations[1].kind, AssistantEntityKind::Helper);
        assert_eq!(
            operations[1].after.as_ref().unwrap()["persistence"],
            "durable"
        );

        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "update",
                    "kind": "device",
                    "targetId": "dummy/ghost",
                    "after": {"display_name": "Ghost"}
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown device"), "{error}");
    }

    #[test]
    fn plan_validation_accepts_floorplan_and_computed_source_writes() {
        let snapshot = snapshot_with_config(empty_export());
        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [
                    {"op": "create", "kind": "floorplan", "after": {"id": "attic", "name": "Attic"}},
                    {"op": "create", "kind": "computed_source", "after": circadian_source()}
                ]
            }),
        )
        .unwrap();
        assert_eq!(operations[0].after.as_ref().unwrap()["name"], "Attic");
        assert_eq!(operations[1].kind, AssistantEntityKind::ComputedSource);
        assert_eq!(operations[1].after.as_ref().unwrap()["revision"], 1);

        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "computed_source",
                    "after": {
                        "id": "broken",
                        "name": "Broken",
                        "timezone": "Mars/Olympus",
                        "compute": {"kind": "script", "source_body": "return []"}
                    }
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("timezone"), "{error}");
    }

    fn mqtt_export() -> ConfigExport {
        let mut export = empty_export();
        export.integrations = vec![IntegrationRow {
            id: "mqtt_main".to_string(),
            plugin: "mqtt".to_string(),
            enabled: false,
            config: json!({"host": "mqtt.local", "port": 1883, "password": "hunter2"}),
        }];
        export
    }

    #[test]
    fn plan_validation_masks_integration_secrets() {
        let snapshot = snapshot_with_config(mqtt_export());
        let (_, operations) = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "update",
                    "kind": "integration",
                    "targetId": "mqtt_main",
                    "after": {"enabled": true, "config": {"host": "mqtt.other"}}
                }]
            }),
        )
        .unwrap();

        let operation = &operations[0];
        let before = operation.before.as_ref().unwrap();
        let after = operation.after.as_ref().unwrap();
        assert!(before["config"].get("password").is_none(), "{before}");
        assert!(after["config"].get("password").is_none(), "{after}");
        assert_eq!(before["config"]["host"], "mqtt.local");
        // The config patch is merged field by field and keeps the port.
        assert_eq!(after["config"]["host"], "mqtt.other");
        assert_eq!(after["config"]["port"], 1883);
        assert_eq!(after["enabled"], true);
        assert!(!serde_json::to_string(operation)
            .unwrap()
            .contains("hunter2"));

        let view =
            entity_snapshot(&snapshot, AssistantEntityKind::Integration, "mqtt_main").unwrap();
        assert!(view["config"].get("password").is_none());
        assert_eq!(view["config"]["host"], "mqtt.local");
    }

    #[test]
    fn plan_validation_rejects_unknown_integration_plugins() {
        let snapshot = snapshot_with_config(empty_export());
        let error = validate_provider(
            &snapshot,
            json!({
                "operations": [{
                    "op": "create",
                    "kind": "integration",
                    "after": {"id": "custom", "plugin": "not-a-plugin", "config": {}}
                }]
            }),
        )
        .unwrap_err();
        assert!(error.contains("unknown integration plugin"), "{error}");
    }

    #[test]
    fn integration_updates_keep_omitted_secrets() {
        let stored = json!({"host": "mqtt.local", "port": 1883, "password": "hunter2"});

        let mut config = json!({"host": "mqtt.other"});
        restore_omitted_integration_secrets(&mut config, &stored, "mqtt");
        assert_eq!(config["password"], "hunter2");
        assert_eq!(config["host"], "mqtt.other");

        // An explicit replacement wins over the stored secret.
        let mut config = json!({"password": "new-secret"});
        restore_omitted_integration_secrets(&mut config, &stored, "mqtt");
        assert_eq!(config["password"], "new-secret");

        // An explicit null clears it.
        let mut config = json!({"password": null});
        restore_omitted_integration_secrets(&mut config, &stored, "mqtt");
        assert!(config["password"].is_null());

        // Kinds without secret fields are untouched.
        let mut config = json!({"anything": true});
        restore_omitted_integration_secrets(&mut config, &stored, "dummy");
        assert!(!config.to_string().contains("hunter2"));
    }

    #[test]
    fn apply_order_runs_creates_then_updates_then_reversed_deletes() {
        let operations = [
            operation(
                "op-1",
                AssistantOpKind::Delete,
                AssistantEntityKind::Routine,
            ),
            operation("op-2", AssistantOpKind::Create, AssistantEntityKind::Scene),
            operation("op-3", AssistantOpKind::Create, AssistantEntityKind::Group),
            operation("op-4", AssistantOpKind::Update, AssistantEntityKind::Group),
            operation("op-5", AssistantOpKind::Create, AssistantEntityKind::Scene),
            operation("op-6", AssistantOpKind::Delete, AssistantEntityKind::Group),
            operation("op-7", AssistantOpKind::Create, AssistantEntityKind::Helper),
            operation(
                "op-8",
                AssistantOpKind::Create,
                AssistantEntityKind::Integration,
            ),
        ];
        let mut indexed: Vec<(usize, AssistantOperation)> =
            operations.into_iter().enumerate().collect();
        indexed.sort_by_key(|(index, operation)| operation_sort_key(operation, *index));

        let order: Vec<&str> = indexed
            .iter()
            .map(|(_, operation)| operation.op_id.as_str())
            .collect();
        assert_eq!(
            order,
            vec![
                "op-8", // integration, first create
                "op-7", // helper
                "op-3", // group
                "op-2", // scene (earlier index first)
                "op-5", // scene
                "op-4", // updates
                "op-1", // deletions in reverse dependency order:
                "op-6", // routine before group
            ]
        );
    }

    fn operation(
        op_id: &str,
        op: AssistantOpKind,
        kind: AssistantEntityKind,
    ) -> AssistantOperation {
        AssistantOperation {
            op_id: op_id.to_string(),
            op,
            kind,
            target_id: None,
            label: op_id.to_string(),
            before: None,
            after: None,
            warnings: Vec::new(),
        }
    }

    fn circadian_source() -> Value {
        serde_json::to_value(SourceDefinition {
            id: crate::types::automation_definition::SourceId("circ".to_string()),
            name: "Circadian".to_string(),
            enabled: true,
            revision: 1,
            timezone: "Europe/Helsinki".to_string(),
            refresh_interval_ms: 60_000,
            aliases: Vec::new(),
            compute: SourceCompute::CircadianCompat {
                preset_version: CIRCADIAN_COMPAT_PRESET_VERSION,
                params: CircadianCompatParams {
                    day_fade_start: "06:00".to_string(),
                    day_fade_duration_hours: 2,
                    day_color: DeviceColor::new_from_kelvin(3000),
                    day_brightness: Some(0.8),
                    night_fade_start: "20:00".to_string(),
                    night_fade_duration_hours: 2,
                    night_color: DeviceColor::new_from_kelvin(2000),
                    night_brightness: Some(0.2),
                },
            },
        })
        .unwrap()
    }
    fn reuse_provider_plan() -> Value {
        serde_json::from_str(
            &include_str!("../../../tests/fixtures/assistant-reuse-plan.json")
                .replace("\"lamp\"", "\"sensor\""),
        )
        .unwrap()
    }

    fn reuse_export() -> ConfigExport {
        let mut config = empty_export();
        for operation in reuse_provider_plan()["operations"].as_array().unwrap() {
            match operation["kind"].as_str().unwrap() {
                "block" => config
                    .blocks
                    .push(serde_json::from_value(operation["after"].clone()).unwrap()),
                "helper" => {
                    let mut body = operation["after"].clone();
                    body["compute"]["revision"] = json!(1);
                    config.helpers.push(serde_json::from_value(body).unwrap());
                }
                "computed_source" => config
                    .sources
                    .push(serde_json::from_value(operation["after"].clone()).unwrap()),
                "routine" => config
                    .routines
                    .push(serde_json::from_value(operation["after"].clone()).unwrap()),
                _ => unreachable!(),
            }
        }
        config
    }

    #[test]
    fn assistant_validates_a_dependency_ordered_reuse_plan() {
        let snapshot = snapshot_with_config_and_devices(empty_export(), vec![sensor_device()]);
        let (_, operations) = validate_provider(&snapshot, reuse_provider_plan()).unwrap();
        let ids: Vec<_> = operations
            .iter()
            .map(|op| op.after.as_ref().unwrap()["id"].as_str().unwrap())
            .collect();
        let caller = ids.iter().position(|id| *id == "reuse_routine").unwrap();
        for dependency in ["dim_lights", "has_step", "computed_step"] {
            assert!(ids.iter().position(|id| *id == dependency).unwrap() < caller);
        }
        let function = ids.iter().position(|id| *id == "scaled_step").unwrap();
        assert!(function < ids.iter().position(|id| *id == "dim_lights").unwrap());
        assert!(function < ids.iter().position(|id| *id == "computed_step").unwrap());
        assert!(function < ids.iter().position(|id| *id == "profile").unwrap());
        assert!(operations.iter().all(|op| op.before.is_none()));
    }

    #[test]
    fn assistant_context_exposes_reuse_and_read_only_helper_contracts() {
        let mut config = reuse_export();
        config
            .widget_settings
            .push(assistant_setting_row(json!({"timezone":"Europe/Helsinki"})));
        let snapshot = snapshot_with_config_and_devices(config, vec![sensor_device()]);
        let context = build_plan_context(
            &snapshot,
            &[AssistantAttachment {
                kind: AssistantEntityKind::Block,
                id: Some("dim_lights".into()),
                label: None,
            }],
            "reuse scaled step",
        )
        .unwrap();
        assert_eq!(
            context["attachments"][0]["snapshot"]["body"]["spec"]["functions"],
            json!(["scaled_step"])
        );
        let catalog = &context["automation_catalog"];
        assert_eq!(catalog["timezone"], "Europe/Helsinki");
        assert_eq!(catalog["helpers"][0]["readOnly"], true);
        assert_eq!(
            catalog["helpers"][0]["compute"]["script"]["functions"],
            json!(["scaled_step"])
        );
        assert!(catalog["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|block| block["id"] == "scaled_step" && block["output"]["kind"] == "number"));
        assert_eq!(
            search_snapshot(&snapshot, AssistantEntityKind::Block, "scaled_step", 10)[0].id,
            "scaled_step"
        );
        for prompt in [
            system_prompt("{}"),
            plan_system_prompt("{}"),
            chat_system_prompt("{}"),
        ] {
            assert!(prompt.contains("call_block") && prompt.contains("run_script"));
            assert!(prompt.contains("api.functions.call") && prompt.contains("api.unknown"));
            assert!(
                prompt.contains("Computed helpers are read-only")
                    && prompt.contains("known false -> known true")
            );
            assert!(!prompt.contains("return [ ... ]"));
        }
    }

    #[test]
    fn assistant_authoring_examples_match_the_compiler_and_worker() {
        use crate::types::automation_definition::ScriptSpec;
        let mut config = empty_export();
        for line in ROUTINE_DEFINITION_REFERENCE.lines().filter(|line| {
            line.starts_with("{\"id\":\"scaled_step\"") || line.starts_with("{\"id\":\"dim_room\"")
        }) {
            config.blocks.push(serde_json::from_str(line).unwrap());
        }
        assert_eq!(config.blocks.len(), 2);
        let catalog = ConfigCatalog::from_export(&config)
            .with_group(crate::types::group::GroupId("hall".into()));
        automation::blocks::validate_catalog(&catalog).unwrap();
        let definition = json!({"triggers":[{"kind":"manual","id":"start"}],"program":{"kind":"native","steps":[{"action":"call_block","id":"dim","block_id":"dim_room","inputs":{"room":"hall","step":0.2}}]}});
        let compiled = automation::compile_definition_value(&definition, &catalog).unwrap();
        let crate::types::automation_definition::Program::Native(program) =
            compiled.normalized.program
        else {
            panic!()
        };
        let crate::types::automation_definition::NativeAction::RunScript { spec, .. } =
            &program.steps[0]
        else {
            panic!()
        };
        let output = crate::core::js_worker::engine::execute_script(
            &spec.source_body,
            &json!({"inputs":spec.inputs}),
            65536,
        )
        .unwrap();
        assert_eq!(output["actions"][0]["step"], 0.4);
        // The runtime action contract accepts these examples, not a bare array.
        automation::parse_routine_handler_outcome(&output, automation::MAX_SCRIPT_STATE_BYTES)
            .unwrap();
        let function_spec:ScriptSpec=serde_json::from_value(json!({"api_version":1,"source_body":"return api.functions.call('scaled_step',{value:0.2});","functions":["scaled_step"]})).unwrap();
        let resolved = automation::reuse::resolve_spec(&function_spec, &catalog).unwrap();
        assert_eq!(
            crate::core::js_worker::engine::execute_script(
                &resolved.source_body,
                &json!({}),
                65536
            )
            .unwrap(),
            json!(0.4)
        );
    }

    #[test]
    fn assistant_rejects_missing_functions_and_invalid_block_arguments() {
        let snapshot = snapshot_with_config_and_devices(reuse_export(), vec![sensor_device()]);
        let invalid = json!({"operations":[{"op":"create","kind":"helper","after":{"id":"broken","name":"Broken","kind":{"kind":"number"},"initial_value":0,"compute":{"script":{"api_version":1,"source_body":"return 0;","functions":["missing"]},"helpers":[],"enabled":true,"refresh_ms":60000}}}]});
        assert!(validate_provider(&snapshot, invalid)
            .unwrap_err()
            .contains("missing"));
        let mut plan = reuse_provider_plan();
        let mut routine = plan["operations"][0]["after"].clone();
        routine["id"] = json!("bad_inputs");
        routine["definition_v2"]["program"]["steps"][0]["inputs"]["step"] = json!("not a number");
        plan["operations"] = json!([{"op":"create","kind":"routine","after":routine}]);
        assert!(validate_provider(&snapshot, plan)
            .unwrap_err()
            .contains("number"));
    }

    #[test]
    fn assistant_rejects_cycles_writing_computed_helpers_and_script_edge_triggers() {
        let snapshot = snapshot_with_config_and_devices(reuse_export(), vec![sensor_device()]);
        let mut helper = json!({"id":"first","name":"First","kind":{"kind":"boolean"},"initial_value":false,"compute":{"script":{"api_version":1,"source_body":"return true;"},"helpers":["second"],"enabled":true,"refresh_ms":60000}});
        let mut other = helper.clone();
        other["id"] = json!("second");
        other["compute"]["helpers"] = json!(["first"]);
        assert!(validate_provider(&snapshot,json!({"operations":[{"op":"create","kind":"helper","after":helper},{"op":"create","kind":"helper","after":other}]})).unwrap_err().contains("cycle"));
        helper = json!({"id":"writer","name":"Writer","definition_v2":{"triggers":[{"id":"manual","kind":"manual"}],"program":{"kind":"native","steps":[{"id":"write","action":"set_helper","helper":"computed_step","value":0.5}]}}});
        assert!(validate_provider(
            &snapshot,
            json!({"operations":[{"op":"create","kind":"routine","after":helper}]})
        )
        .unwrap_err()
        .contains("cannot be written"));
        let mut definition = valid_definition();
        definition["triggers"] = json!([{"id":"edge","kind":"predicate_transition","predicate":{"kind":"block","block_id":"has_step","inputs":{}}}]);
        assert!(validate_provider(&snapshot,json!({"operations":[{"op":"create","kind":"routine","after":{"id":"bad_edge","name":"Bad edge","definition_v2":definition}}]})).is_err());
    }

    #[test]
    fn assistant_blocks_in_use_cannot_be_deleted() {
        let snapshot = snapshot_with_config_and_devices(reuse_export(), vec![sensor_device()]);
        let error = validate_provider(
            &snapshot,
            json!({"operations":[{"op":"delete","kind":"block","target_id":"scaled_step"}]}),
        )
        .unwrap_err();
        assert!(error.contains("in use"), "{error}");
        let (_,operations)=validate_provider(&snapshot,json!({"operations":[{"op":"delete","kind":"block","target_id":"dim_lights"},{"op":"delete","kind":"routine","target_id":"reuse_routine"}]})).unwrap();
        assert_eq!(operations[0].kind, AssistantEntityKind::Routine);
    }
    #[test]
    fn authoring_reference_covers_current_discriminated_schema_variants() {
        use crate::types::automation_definition::{
            ConditionExpr, NativeAction, SceneSelection, ScriptDeclaration, TriggerSpec,
            ValueSource,
        };
        use crate::types::automation_source::SourceCompute;
        let tag = regex::Regex::new(r#""(?:action|kind)": "([^"]+)""#).unwrap();
        for schema in [
            <NativeAction as ts_rs::TS>::decl(&ts_rs::Config::default()),
            <TriggerSpec as ts_rs::TS>::decl(&ts_rs::Config::default()),
            <ConditionExpr as ts_rs::TS>::decl(&ts_rs::Config::default()),
            <ValueSource as ts_rs::TS>::decl(&ts_rs::Config::default()),
            <ScriptDeclaration as ts_rs::TS>::decl(&ts_rs::Config::default()),
            <SourceCompute as ts_rs::TS>::decl(&ts_rs::Config::default()),
            <SceneSelection as ts_rs::TS>::decl(&ts_rs::Config::default()),
        ] {
            let variants: Vec<_> = tag
                .captures_iter(&schema)
                .map(|capture| capture[1].to_string())
                .collect();
            assert!(!variants.is_empty(), "No tags found in schema: {schema}");
            for variant in variants {
                assert!(ROUTINE_DEFINITION_REFERENCE.contains(&variant),"Add '{variant}' to the assistant authoring reference when changing automation schemas");
            }
        }
    }

    #[test]
    fn catalog_bounds_large_bodies_but_attached_blocks_keep_their_source() {
        let mut config = reuse_export();
        let block = config
            .blocks
            .iter_mut()
            .find(|block| block.id == "scaled_step")
            .unwrap();
        block.body["spec"]["source_body"] = json!(format!(
            "/* {} */ return inputs.value * inputs.factor;",
            "x".repeat(9000)
        ));
        let snapshot = snapshot_with_config_and_devices(config, vec![sensor_device()]);
        let context = build_plan_context(
            &snapshot,
            &[AssistantAttachment {
                kind: AssistantEntityKind::Block,
                id: Some("scaled_step".into()),
                label: None,
            }],
            "scaled_step",
        )
        .unwrap();
        let signature = context["automation_catalog"]["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|block| block["id"] == "scaled_step")
            .unwrap();
        assert_eq!(signature["bodyOmitted"], true);
        assert!(signature.get("body").is_none());
        assert!(
            context["attachments"][0]["snapshot"]["body"]["spec"]["source_body"]
                .as_str()
                .unwrap()
                .len()
                > 9000
        );
        assert_eq!(context["matches"][0]["snapshot"]["id"], "scaled_step");
    }
}

#[cfg(test)]
mod restore_proposals_tests {
    use super::*;

    /// A proposal carried by a stored turn, shaped like the one
    /// `db_load_assistant_thread` returns for a reopened conversation.
    fn stored_thread(action_id: &str) -> AssistantThread {
        AssistantThread {
            id: "thread-1".to_string(),
            name: "Downstairs daycare morning".to_string(),
            created_at_ms: 0,
            updated_at_ms: 0,
            messages: vec![AssistantHistoryMessage {
                role: AssistantMessageRole::Assistant,
                content: "Set the downstairs lights to a rainbow sweep.".to_string(),
                proposal: Some(AssistantThreadProposal::Action {
                    action: AssistantAction {
                        action_id: action_id.to_string(),
                        summary: "Rainbow sweep".to_string(),
                        changes: vec![AssistantActionChange {
                            device_key: "gx53/entryway".to_string(),
                            name: Some("Entryway gx53".to_string()),
                            power: Some(true),
                            brightness: Some(1.0),
                            color: None,
                        }],
                        created_at_ms: 0,
                        model: "mock-model".to_string(),
                    },
                }),
                outcome: None,
            }],
        }
    }

    #[test]
    fn reopening_a_thread_makes_its_proposal_applyable_again() {
        let plans = PlanStore::new(MAX_STORED_REVIEWS);

        // A server that has just restarted holds no live handle for the
        // proposal, which is what made "Apply again" answer with a 404.
        assert!(plans.get_action("action-1").is_none());

        restore_thread_proposals(&plans, &stored_thread("action-1"));

        assert!(plans.get_action("action-1").is_some());
    }
}
