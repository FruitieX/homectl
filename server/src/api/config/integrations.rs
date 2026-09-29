use super::*;
use crate::core::device_health::{policy_row, read_policy};
use crate::types::device_health::ReportingPolicy;
use std::hash::{BuildHasher, Hash, Hasher};

// A process-keyed token includes secret changes without exposing a digest that
// could be checked against guessed passwords. Restarting changes the token.
static REVISION_HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
    once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct IntegrationView {
    #[serde(flatten)]
    row: IntegrationRow,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revision_token: Option<String>,
    #[serde(default)]
    secret_fields: Vec<String>,
    #[serde(default)]
    reporting_policy: ReportingPolicy,
}
pub(super) fn public_row(row: &IntegrationRow, policy: &ReportingPolicy) -> IntegrationView {
    let raw = serde_json::to_value(row).unwrap();
    let mut hasher = REVISION_HASHER.build_hasher();
    raw.to_string().hash(&mut hasher);
    serde_json::to_string(policy).unwrap().hash(&mut hasher);
    let secret_fields = assistant::integration_secret_keys(&row.plugin)
        .into_iter()
        .filter(|path| {
            row.config
                .pointer(&format!("/{}", path.replace('.', "/")))
                .is_some_and(|value| !value.is_null() && value.as_str() != Some(""))
        })
        .collect();
    let mut redacted = raw;
    assistant::redact_integration_secrets(&mut redacted, &row.plugin);
    IntegrationView {
        row: serde_json::from_value(redacted).unwrap(),
        revision_token: Some(format!("{:016x}", hasher.finish())),
        secret_fields,
        reporting_policy: policy.clone(),
    }
}
#[derive(Deserialize)]
pub(super) struct IntegrationUpdate {
    #[serde(flatten)]
    integration: IntegrationRow,
    expected: Option<IntegrationView>,
    reporting_policy: Option<ReportingPolicy>,
}
fn matches_expected(
    expected: &IntegrationView,
    current: &IntegrationRow,
    policy: &ReportingPolicy,
) -> bool {
    let public = public_row(current, policy);
    if let Some(token) = &expected.revision_token {
        return public.revision_token.as_ref() == Some(token);
    }
    expected.reporting_policy == *policy
        && serde_json::to_value(&expected.row).unwrap() == serde_json::to_value(public.row).unwrap()
}

pub(super) fn integration_schema_routes(
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("integration-schemas")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(list_integration_schemas)
}

pub(super) async fn list_integration_schemas() -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(integration_config_schemas()))
}

pub(super) fn integrations_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let enabled = warp::path!("integrations" / String / "devices" / String / "enabled")
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(set_device_enabled);
    let list = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_integrations);

    let get = warp::path!("integrations" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_integration);

    let create = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_integration);

    let update = warp::path!("integrations" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_integration);

    let delete = warp::path!("integrations" / String)
        .and(warp::delete())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(delete_integration);

    enabled.or(list).or(get).or(create).or(update).or(delete)
}

#[derive(Deserialize)]
struct DeviceEnabledRequest {
    enabled: bool,
}

async fn set_device_enabled(
    id: String,
    device_id: String,
    request: DeviceEnabledRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let device_id = decode_path_key(device_id);
    if !handle
        .snapshot
        .load()
        .runtime_config
        .integrations
        .iter()
        .any(|row| row.id == id)
    {
        return Ok(not_found("Integration"));
    }
    if let Err(error) = apply_runtime_integrations_change(&handle, &_guard, |config| {
        let row = config
            .integrations
            .iter_mut()
            .find(|row| row.id == id)
            .unwrap();
        let mut ids: Vec<String> = serde_json::from_value(
            row.config
                .get("disabled_device_ids")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([])),
        )
        .unwrap_or_default();
        ids.retain(|value| value != &device_id);
        if !request.enabled {
            ids.push(device_id.clone());
        }
        ids.sort();
        ids.dedup();
        row.config["disabled_device_ids"] = serde_json::json!(ids);
        true
    })
    .await
    {
        return Ok(error_response(
            &format!("Device enablement change failed: {error}"),
            StatusCode::BAD_REQUEST,
        ));
    }
    let row = handle
        .snapshot
        .load()
        .runtime_config
        .integrations
        .iter()
        .find(|row| row.id == id)
        .cloned()
        .unwrap();
    let available = db::is_db_connected();
    let persistence = config_queries::db_upsert_integration(&row).await;
    Ok(config_write_response(
        serde_json::json!({"enabled":request.enabled}),
        persistence,
        available,
        StatusCode::OK,
    ))
}

pub(super) async fn list_integrations(
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config
            .integrations
            .iter()
            .map(|row| {
                public_row(
                    row,
                    &read_policy(&snap.runtime_config, "integration", &row.id),
                )
            })
            .collect::<Vec<_>>(),
    ))
}

pub(super) async fn get_integration(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .integrations
        .iter()
        .find(|integration| integration.id == id)
        .cloned()
    {
        Some(integration) => Ok(ApiResponse::success(public_row(
            &integration,
            &read_policy(&snap.runtime_config, "integration", &integration.id),
        ))),
        None => Ok(not_found("Integration")),
    }
}

pub(super) async fn create_integration(
    request: IntegrationUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    write_integration(
        None,
        request.integration,
        None,
        request.reporting_policy,
        handle,
    )
    .await
}
pub(super) async fn update_integration(
    id: String,
    request: IntegrationUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    write_integration(
        Some(id),
        request.integration,
        request.expected,
        request.reporting_policy,
        handle,
    )
    .await
}
async fn write_integration(
    id: Option<String>,
    mut integration: IntegrationRow,
    expected: Option<IntegrationView>,
    reporting_policy: Option<ReportingPolicy>,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let creating = id.is_none();
    if let Some(id) = id {
        integration.id = id;
    }
    if integration.id.trim().is_empty()
        || integration.plugin.trim().is_empty()
        || !integration.config.is_object()
    {
        return Ok(error_response(
            "Choose an integration ID, plugin and configuration object.",
            StatusCode::BAD_REQUEST,
        ));
    }
    let current_policy = read_policy(
        &handle.snapshot.load().runtime_config,
        "integration",
        &integration.id,
    );
    let reporting_policy = reporting_policy.unwrap_or_else(|| current_policy.clone());
    if let Err(error) = reporting_policy.validate() {
        return Ok(error_response(error, StatusCode::BAD_REQUEST));
    }
    let current = handle
        .snapshot
        .load()
        .runtime_config
        .integrations
        .iter()
        .find(|row| row.id == integration.id)
        .cloned();
    if creating && current.is_some() {
        return Ok(error_response(
            "This integration ID is already in use.",
            StatusCode::CONFLICT,
        ));
    }
    if !creating && current.is_none() {
        return Ok(not_found("Integration"));
    }
    if let Some(current) = &current {
        if expected
            .as_ref()
            .is_some_and(|expected| !matches_expected(expected, current, &current_policy))
        {
            return Ok(warp::reply::with_status(
                warp::reply::json(
                    &serde_json::json!({ "success": false, "error": "Integration settings changed elsewhere.", "current": public_row(current, &current_policy) }),
                ),
                StatusCode::CONFLICT,
            ));
        }
        if current.plugin == integration.plugin {
            assistant::restore_omitted_integration_secrets(
                &mut integration.config,
                &current.config,
                &integration.plugin,
            );
        }
    }
    if let Err(error) = apply_runtime_integrations_change(&handle, &_guard, |config| {
        if let Some(row) = config
            .integrations
            .iter_mut()
            .find(|row| row.id == integration.id)
        {
            *row = integration.clone();
        } else {
            config.integrations.push(integration.clone());
            config.integrations.sort_by(|a, b| a.id.cmp(&b.id));
        }
        let setting = policy_row("integration", &integration.id, &reporting_policy);
        config.widget_settings.retain(|row| row.key != setting.key);
        config.widget_settings.push(setting);
        true
    })
    .await
    {
        // Integration errors may include connection strings; keep the API error
        // useful without reflecting credentials supplied in this request.
        let mut message = format!("Integration change failed: {error}");
        for path in assistant::integration_secret_keys(&integration.plugin) {
            if let Some(secret) = integration
                .config
                .pointer(&format!("/{}", path.replace('.', "/")))
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
            {
                message = message.replace(secret, "[hidden]");
            }
        }
        return Ok(error_response(&message, StatusCode::BAD_REQUEST));
    }
    let available = db::is_db_connected();
    let setting = policy_row("integration", &integration.id, &reporting_policy);
    let persistence = config_queries::db_save_integration_settings(&integration, &setting).await;
    Ok(config_write_response(
        public_row(&integration, &reporting_policy),
        persistence,
        available,
        if creating {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
    ))
}

pub(super) async fn delete_integration(
    id: String,
    _snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let existed = handle
        .snapshot
        .load()
        .runtime_config
        .integrations
        .iter()
        .any(|integration| integration.id == id);

    let deleted = if !existed {
        false
    } else {
        match apply_runtime_integrations_change(&handle, &_write_guard, |config| {
            let len_before = config.integrations.len();
            config
                .integrations
                .retain(|integration| integration.id != id);
            config.integrations.len() != len_before
        })
        .await
        {
            Ok(deleted) => deleted,
            Err(e) => {
                return Ok(error_response(
                    &format!("Integration change failed: {e}"),
                    StatusCode::BAD_REQUEST,
                ));
            }
        }
    };

    if !deleted {
        return Ok(not_found("Integration"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_integration(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Groups
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    use serde_json::json;
    fn row() -> IntegrationRow {
        IntegrationRow {
            id: "test_mqtt".into(),
            plugin: "mqtt".into(),
            enabled: false,
            config: json!({"host":"localhost", "port":1883, "password":"secret-to-preserve", "future": {"untouched":true} }),
        }
    }
    async fn setup() -> (StateHandle, SnapshotHandle) {
        let (mut state, _events) = crate::core::event::tests::test_state();
        state.runtime_config.integrations.push(row());
        state.publish_snapshot(crate::core::snapshot::SnapshotChanges::all());
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), tx);
        (handle, snapshot)
    }
    async fn body(reply: impl Reply) -> serde_json::Value {
        serde_json::from_slice(
            &warp::hyper::body::to_bytes(reply.into_response().into_body())
                .await
                .unwrap(),
        )
        .unwrap()
    }
    #[test]
    fn credentials_are_omitted_and_secret_changes_invalidate_tokens() {
        let stored = row();
        let public = public_row(&stored, &ReportingPolicy::Inherit);
        let json = serde_json::to_value(&public).unwrap();
        assert!(json["config"].get("password").is_none());
        assert_eq!(json["secret_fields"], json!(["password"]));
        assert!(!json.to_string().contains("secret-to-preserve"));
        assert!(matches_expected(
            &public,
            &stored,
            &ReportingPolicy::Inherit
        ));
        let mut changed = stored;
        changed.config["password"] = json!("new-secret");
        assert!(!matches_expected(
            &public,
            &changed,
            &ReportingPolicy::Inherit
        ));
    }
    #[tokio::test]
    async fn integration_writes_preserve_omitted_passwords_and_reject_stale_and_duplicate_requests()
    {
        let (handle, snapshot) = setup().await;
        let expected = public_row(&row(), &ReportingPolicy::Inherit);
        let mut draft = expected.row.clone();
        draft.config["host"] = json!("changed.example");
        let result = write_integration(
            Some(draft.id.clone()),
            draft.clone(),
            Some(expected.clone()),
            None,
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(result.status(), StatusCode::OK);
        let response = body(result).await;
        assert!(response["data"]["config"].get("password").is_none());
        assert_eq!(
            snapshot.load().runtime_config.integrations[0].config["password"],
            "secret-to-preserve"
        );
        assert_eq!(
            snapshot.load().runtime_config.integrations[0].config["future"],
            json!({"untouched":true})
        );
        let stale = write_integration(
            Some(draft.id.clone()),
            draft.clone(),
            Some(expected),
            None,
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        assert!(!body(stale).await.to_string().contains("secret-to-preserve"));
        assert_eq!(
            write_integration(None, draft.clone(), None, None, handle.clone())
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::CONFLICT
        );
        draft.config["password"] = json!("");
        let expected = public_row(
            &snapshot.load().runtime_config.integrations[0],
            &ReportingPolicy::Inherit,
        );
        assert_eq!(
            write_integration(Some(draft.id.clone()), draft, Some(expected), None, handle)
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            snapshot.load().runtime_config.integrations[0].config["password"],
            ""
        );
    }
    #[tokio::test]
    async fn reporting_policy_changes_invalidate_baselines_and_omission_preserves_them() {
        let (handle, snapshot) = setup().await;
        let original = public_row(&row(), &ReportingPolicy::Inherit);
        let policy = ReportingPolicy::Custom {
            expected_interval_seconds: 300,
        };
        let result = write_integration(
            Some(row().id),
            original.row.clone(),
            Some(original.clone()),
            Some(policy.clone()),
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(result.status(), StatusCode::OK);
        let response = body(result).await;
        assert_eq!(
            response["data"]["reporting_policy"],
            json!({"mode":"custom","expected_interval_seconds":300})
        );
        assert_eq!(
            crate::core::device_health::read_policy(
                &snapshot.load().runtime_config,
                "integration",
                "test_mqtt"
            ),
            policy
        );
        let stale = write_integration(
            Some(row().id),
            original.row.clone(),
            Some(original.clone()),
            Some(ReportingPolicy::Ignore),
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(
            stale.status(),
            StatusCode::CONFLICT,
            "a policy-only change must invalidate the previous token"
        );
        let expected = public_row(&snapshot.load().runtime_config.integrations[0], &policy);
        let result = write_integration(
            Some(row().id),
            expected.row.clone(),
            Some(expected),
            None,
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(result.status(), StatusCode::OK);
        assert_eq!(
            crate::core::device_health::read_policy(
                &snapshot.load().runtime_config,
                "integration",
                "test_mqtt"
            ),
            policy
        );
        let result = write_integration(
            Some(row().id),
            original.row,
            None,
            Some(ReportingPolicy::Custom {
                expected_interval_seconds: 0,
            }),
            handle,
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(result.status(), StatusCode::BAD_REQUEST);
    }
    #[tokio::test]
    async fn redacted_backup_import_restores_only_omitted_matching_secrets() {
        let (_handle, snapshot) = setup().await;
        let original = (*snapshot.load().runtime_config).clone();
        let mut backup = original.clone();
        redact_widget_secrets(&mut backup);
        assert!(backup.integrations[0].config.get("password").is_none());
        preserve_omitted_widget_secrets(&mut backup, &original);
        assert_eq!(
            backup.integrations[0].config["password"],
            "secret-to-preserve"
        );
        backup.integrations[0].config["password"] = json!("");
        preserve_omitted_widget_secrets(&mut backup, &original);
        assert_eq!(backup.integrations[0].config["password"], "");
    }
}
