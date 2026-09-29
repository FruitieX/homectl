//! Reviewed, merge-based TOML migration. The original compatibility endpoints
//! remain available; this contract binds the upload, selection and saved state.
use super::*;
use serde_json::json;
use std::hash::{BuildHasher, Hash, Hasher};

const BODY_LIMIT: u64 = 32 * 1024 * 1024;
static HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
    once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);

#[derive(Deserialize, Serialize)]
struct Upload {
    toml: String,
    selection: MigrationSelection,
}
#[derive(Deserialize)]
struct Import {
    #[serde(flatten)]
    upload: Upload,
    expected: String,
    #[serde(default)]
    accept_skipped: bool,
}
struct Prepared {
    candidate: ConfigExport,
    preview: MigratePreviewResult,
    skipped: Vec<String>,
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let review = warp::path!("migrate" / "review")
        .and(warp::post())
        .and(warp::body::content_length_limit(BODY_LIMIT))
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and_then(review);
    let import = warp::path!("migrate" / "import")
        .and(warp::post())
        .and(warp::body::content_length_limit(BODY_LIMIT))
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(import);
    review.or(import)
}

fn prepare(
    upload: &Upload,
    current: &ConfigExport,
    devices: &DevicesState,
) -> Result<Prepared, String> {
    if !upload.selection.has_any() {
        return Err("Select at least one section to import.".into());
    }
    if upload.toml.len() > 16 * 1024 * 1024 {
        return Err("Choose a TOML file smaller than 16 MB.".into());
    }
    // Do not silently skip a connection lacking the field required by the legacy parser.
    // Parser errors can contain credential-bearing source lines; do not echo them.
    let mut raw: toml::Value = toml::from_str(&upload.toml).map_err(|_: toml::de::Error| {
        "Could not parse the TOML file. Check its syntax and try again.".to_owned()
    })?;
    if upload.selection.integrations {
        for (id, value) in raw
            .get("integrations")
            .and_then(toml::Value::as_table)
            .into_iter()
            .flatten()
        {
            if value
                .get("plugin")
                .and_then(toml::Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                return Err(format!("Connection '{id}' needs a plugin name."));
            }
        }
    }
    if upload.selection.core {
        if let Some(value) = raw
            .get("core")
            .and_then(|core| core.get("warmup_time_seconds"))
        {
            if value
                .as_integer()
                .is_none_or(|n| !(0..=i32::MAX as i64).contains(&n))
            {
                return Err(
                    "Warmup time must be a whole number between 0 and 2147483647 seconds.".into(),
                );
            }
        }
    }
    let selected = serde_json::to_value(upload.selection).unwrap();
    if let Some(table) = raw.as_table_mut() {
        table.retain(|key, _| selected[key] == true);
    }
    let selected_toml =
        toml::to_string(&raw).map_err(|_| "Could not read selected TOML sections.".to_owned())?;
    let parsed = parse_toml_config(&selected_toml).map_err(|_| "The selected TOML sections do not match the legacy configuration format. Check section and field types.".to_owned())?;
    let mut resolved = canonicalize_migration_preview(
        select_migration_preview(parsed, &upload.selection),
        devices,
    );
    resolved.validation_errors.sort();
    resolved.validation_errors.dedup();
    let mut candidate =
        merge_selected_migration_config(current.clone(), &resolved.preview, &upload.selection);
    preserve_omitted_widget_secrets(&mut candidate, current);
    for group in &resolved.preview.groups {
        groups::validate_group_change(&candidate.groups, group)?;
    }
    let catalog = ConfigCatalog::new(devices.0.keys().cloned(), &candidate);
    validate_routine_catalog(&candidate, &catalog).map_err(|error| error.to_string())?;
    Ok(Prepared {
        candidate,
        preview: resolved.preview,
        skipped: resolved.validation_errors,
    })
}

fn token(upload: &Upload, current: &ConfigExport, prepared: &Prepared) -> String {
    let mut hasher = HASHER.build_hasher();
    backups::review_token(current, &prepared.candidate).hash(&mut hasher);
    serde_json::to_string(upload).unwrap().hash(&mut hasher);
    prepared.skipped.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

async fn review(upload: Upload, snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    let prepared = match prepare(&upload, &snap.runtime_config, &snap.devices) {
        Ok(prepared) => prepared,
        Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    };
    let mut review = backups::review(&snap.runtime_config, &prepared.candidate);
    let selection = serde_json::to_value(upload.selection).unwrap();
    review["sections"]
        .as_array_mut()
        .unwrap()
        .retain(|section| selection[section["key"].as_str().unwrap()] == true);
    review["revision_token"] = json!(token(&upload, &snap.runtime_config, &prepared));
    review["legacy_routines"] = json!(prepared.preview.routines.len());
    review["warnings"] = json!([
        "Selected entries are added or replace entries with the same ID. Other saved entries are kept.",
        "Omitted credentials for matching connections are kept. Explicit credential values in the file replace them.",
        "Imported legacy routines are read-only until converted. Routines with skipped references are disabled.",
        "Import reloads the runtime configuration and cancels pending routine timers."
    ]);
    Ok(ApiResponse::success(
        json!({"review":review,"skipped":prepared.skipped}),
    ))
}

async fn import(
    request: Import,
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let prepared = {
        let snap = snapshot.load();
        let prepared = match prepare(&request.upload, &snap.runtime_config, &snap.devices) {
            Ok(prepared) => prepared,
            Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
        };
        if request.expected != token(&request.upload, &snap.runtime_config, &prepared) {
            return Ok(error_response("The setup, file or discovered references changed. Review this import again before applying it.", StatusCode::CONFLICT));
        }
        if !prepared.skipped.is_empty() && !request.accept_skipped {
            return Ok(error_response(
                "Review and acknowledge the skipped references before importing.",
                StatusCode::BAD_REQUEST,
            ));
        }
        prepared
    };
    if let Err(_error) =
        apply_runtime_config_snapshot(&handle, prepared.candidate.clone(), &guard).await
    {
        // Integration errors can include connection values; do not reflect them in UI logs.
        log::warn!("Legacy import runtime update failed");
        return Ok(error_response(
            "Import did not complete. Some connections may have restarted; check their status and review again.",
            StatusCode::BAD_REQUEST,
        ));
    }
    let available = db::is_db_connected();
    let persistence = apply_migration(&prepared.candidate).await;
    Ok(config_write_response(
        MigrateApplyResult {
            core: request.upload.selection.core,
            integrations: prepared.preview.integrations.len(),
            groups: prepared.preview.groups.len(),
            scenes: prepared.preview.scenes.len(),
            routines: prepared.preview.routines.len(),
        },
        persistence,
        available,
        StatusCode::OK,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn selection() -> MigrationSelection {
        MigrationSelection {
            core: false,
            integrations: false,
            groups: true,
            scenes: false,
            routines: false,
        }
    }

    #[tokio::test]
    async fn migration_review_is_read_only_binds_file_and_state_and_keeps_other_entries() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        state.runtime_config.groups = serde_json::from_value(json!([
            {"id":"kitchen","name":"Kitchen","hidden":false,"devices":[],"linked_groups":[]},
            {"id":"keep","name":"Keep this room","hidden":false,"devices":[],"linked_groups":[]}
        ]))
        .unwrap();
        state
            .runtime_config
            .widget_settings
            .push(config_queries::WidgetSettingRow {
                key: "assistant".into(),
                config: json!({"apiKey":"stored-secret"}),
            });
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        handle.mutate(|_| Box::pin(async {})).await.unwrap();
        let before = serde_json::to_value(&*snapshot.load().runtime_config).unwrap();
        let routes = routes(&snapshot, &handle);
        let toml = "[groups.kitchen]\nname='Updated kitchen'\n[groups.new]\nname='New room'\n[integrations.ignored]\npassword='uploaded-secret'\n";
        let upload = json!({"toml":toml,"selection":selection()});
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/review")
            .json(&upload)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let review: Value = serde_json::from_slice(response.body()).unwrap();
        assert!(!review.to_string().contains("stored-secret"));
        assert!(!review.to_string().contains("uploaded-secret"));
        assert_eq!(
            review["data"]["review"]["sections"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            review["data"]["review"]["sections"][0]["changes"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            serde_json::to_value(&*snapshot.load().runtime_config).unwrap(),
            before
        );
        let mut apply = upload.clone();
        apply["expected"] = review["data"]["review"]["revision_token"].clone();
        let mut changed = apply.clone();
        changed["toml"] = json!(format!("{toml}\n# changed file"));
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/import")
            .json(&changed)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        handle
            .mutate(|state| {
                Box::pin(async move {
                    state.runtime_config.widget_settings[0].config = json!({"apiKey":"new-secret"});
                })
            })
            .await
            .unwrap();
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/import")
            .json(&apply)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/review")
            .json(&upload)
            .reply(&routes)
            .await;
        let fresh: Value = serde_json::from_slice(response.body()).unwrap();
        apply["expected"] = fresh["data"]["review"]["revision_token"].clone();
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/import")
            .json(&apply)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let result: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(result["write"]["applied"], true);
        assert_eq!(result["write"]["persistence"], "memory_only");
        let snap = snapshot.load();
        assert_eq!(snap.runtime_config.groups.len(), 3);
        assert!(snap
            .runtime_config
            .groups
            .iter()
            .any(|row| row.id == "keep" && row.name == "Keep this room"));
        assert!(snap
            .runtime_config
            .groups
            .iter()
            .any(|row| row.id == "kitchen" && row.name == "Updated kitchen"));
    }

    #[tokio::test]
    async fn migration_skips_require_acknowledgment_and_disable_affected_routines() {
        let (state, _events) = crate::core::event::tests::test_state();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        handle.mutate(|_| Box::pin(async {})).await.unwrap();
        let routes = routes(&snapshot, &handle);
        let upload = json!({"toml":"[routines.motion]\nname='Motion'\nrules=[{integration_id='missing', name='Missing sensor', state={value=true}}]\nactions=[]", "selection":MigrationSelection{groups:false,routines:true,..selection()}});
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/review")
            .json(&upload)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let reviewed: Value = serde_json::from_slice(response.body()).unwrap();
        assert!(reviewed["data"]["skipped"].to_string().contains("disabled"));
        let mut apply = upload.clone();
        apply["expected"] = reviewed["data"]["review"]["revision_token"].clone();
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/import")
            .json(&apply)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(snapshot.load().runtime_config.routines.is_empty());
        apply["accept_skipped"] = json!(true);
        let response = warp::test::request()
            .method("POST")
            .path("/migrate/import")
            .json(&apply)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        assert!(!snapshot.load().runtime_config.routines[0].enabled);
    }

    #[test]
    fn migration_review_preserves_omitted_connection_credentials_and_rejects_invalid_input() {
        let (state, _events) = crate::core::event::tests::test_state();
        let mut current = state.runtime_config.clone();
        current.integrations.push(IntegrationRow {
            id: "mqtt".into(),
            plugin: "mqtt".into(),
            enabled: true,
            config: json!({"password":"stored-secret","host":"broker"}),
        });
        let mut upload = Upload {
            toml: "[integrations.mqtt]\nplugin='mqtt'\nhost='new-broker'".into(),
            selection: MigrationSelection {
                groups: false,
                integrations: true,
                ..selection()
            },
        };
        let prepared = prepare(&upload, &current, &DevicesState::default()).unwrap();
        assert_eq!(
            prepared.candidate.integrations[0].config["password"],
            "stored-secret"
        );
        upload.toml.push_str("\npassword=''\n");
        assert_eq!(
            prepare(&upload, &current, &DevicesState::default())
                .unwrap()
                .candidate
                .integrations[0]
                .config["password"],
            ""
        );
        upload.toml = "[integrations.bad]\npassword='uploaded-secret'".into();
        assert!(prepare(&upload, &current, &DevicesState::default())
            .err()
            .unwrap()
            .contains("plugin name"));
        upload.toml = "[integrations.bad]\npassword='uploaded-secret".into();
        assert!(!prepare(&upload, &current, &DevicesState::default())
            .err()
            .unwrap()
            .contains("uploaded-secret"));
    }

    #[test]
    fn migration_review_token_changes_when_discovery_resolves_a_skipped_reference() {
        let (state, _events) = crate::core::event::tests::test_state();
        let current = &state.runtime_config;
        let upload = Upload {
            toml: "[groups.room]\nname='Room'\ndevices=[{integration_id='dummy',name='Sensor'}]"
                .into(),
            selection: selection(),
        };
        let before = prepare(&upload, current, &DevicesState::default()).unwrap();
        assert!(!before.skipped.is_empty());
        let device = Device::new(
            IntegrationId::from("dummy".to_owned()),
            crate::types::device::DeviceId::new("sensor"),
            "Sensor".to_owned(),
            DeviceData::Sensor(SensorDevice::Boolean { value: false }),
            None,
        );
        let devices = DevicesState(BTreeMap::from([(device.get_device_key(), device)]));
        let after = prepare(&upload, current, &devices).unwrap();
        assert!(after.skipped.is_empty());
        assert_ne!(
            token(&upload, current, &before),
            token(&upload, current, &after)
        );
        assert_eq!(after.preview.groups[0].devices[0].device_id, "sensor");
        assert_eq!(
            token(&upload, current, &after),
            token(
                &upload,
                current,
                &prepare(&upload, current, &devices).unwrap()
            )
        );
    }
}
