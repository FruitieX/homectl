use super::*;
use crate::core::automation::sources::{CircadianCompatCurve, CIRCADIAN_COMPAT_PRESET_VERSION};
use crate::types::automation_definition::SourceId;
use crate::types::automation_source::{SourceCompute, SourceDefinition, SourcePreviewRequest};

/// Refresh cadence bounds. Startup always computes once regardless.
const MIN_SOURCE_REFRESH_INTERVAL_MS: u64 = 1_000;
const MAX_SOURCE_REFRESH_INTERVAL_MS: u64 = 86_400_000;

/// Validate a source definition before it can be stored. Definitions are
/// versioned and validated strictly; ambiguous parameters are reported, never
/// silently normalized.
pub(super) fn validate_source(source: &SourceDefinition) -> Result<(), String> {
    if source.id.0.trim().is_empty() {
        return Err("id must not be empty.".to_string());
    }
    if source.name.trim().is_empty() {
        return Err("name must not be empty.".to_string());
    }
    if crate::core::automation::calendar::parse_schedule_zone(&source.timezone).is_none() {
        return Err(format!("timezone: unknown timezone {:?}.", source.timezone));
    }
    if !(MIN_SOURCE_REFRESH_INTERVAL_MS..=MAX_SOURCE_REFRESH_INTERVAL_MS)
        .contains(&source.refresh_interval_ms)
    {
        return Err(format!(
            "refresh_interval_ms: must be within {MIN_SOURCE_REFRESH_INTERVAL_MS}..={MAX_SOURCE_REFRESH_INTERVAL_MS}, got {}.",
            source.refresh_interval_ms
        ));
    }

    let mut seen_aliases = std::collections::BTreeSet::new();
    for alias in &source.aliases {
        let key = format!("{}/{}", alias.integration_id, alias.device_id);
        if !seen_aliases.insert(key.clone()) {
            return Err(format!("aliases: duplicate alias {key:?}."));
        }
    }

    match &source.compute {
        SourceCompute::CircadianCompat {
            preset_version,
            params,
        } => {
            if *preset_version != CIRCADIAN_COMPAT_PRESET_VERSION {
                return Err(format!(
                    "compute.preset_version: unsupported circadian preset version {preset_version}; this build supports {CIRCADIAN_COMPAT_PRESET_VERSION}."
                ));
            }
            CircadianCompatCurve::from_params(params)
                .map_err(|error| format!("compute.params: {error}"))?;
        }
        script @ SourceCompute::Script { .. } => {
            crate::core::automation::sources::validate_script_compute(script)?;
        }
    }

    Ok(())
}

pub(super) fn sources_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("sources")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_sources);

    let presets = warp::path("source-presets")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(list_source_presets);

    let preview = warp::path("source-preview")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and_then(preview_source);

    let upsert = warp::path!("sources" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_source);

    let delete = warp::path!("sources" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_source);

    list.or(presets).or(preview).or(upsert).or(delete)
}

/// Stateless preview of a draft source definition. The request is validated
/// with the same rules as saving; nothing is persisted.
async fn preview_source(
    request: SourcePreviewRequest,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    if matches!(&request.compute, SourceCompute::Script { .. }) {
        return preview_script_source(request, snapshot).await;
    }
    match crate::core::automation::sources::preview_source(
        &request,
        chrono::Utc::now().timestamp_millis(),
    ) {
        Ok(preview) => Ok(ApiResponse::success(preview).into_response()),
        Err(error) => Ok(error_response(&error, StatusCode::BAD_REQUEST).into_response()),
    }
}

/// Shipped preset metadata, including the forkable body. The body is a
/// shipped application asset, not a secret.
async fn list_source_presets() -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(
        crate::core::automation::sources::preset_infos(),
    ))
}

async fn preview_script_source(
    request: SourcePreviewRequest,
    snapshot: SnapshotHandle,
) -> Result<warp::reply::Response, warp::Rejection> {
    use crate::types::automation_source::{
        SourcePreview, SourcePreviewSample, DEFAULT_SOURCE_PREVIEW_SAMPLES,
    };
    let result: Result<SourcePreview, String> = async {
        let now = chrono::Utc::now().timestamp_millis();
        // The synchronous preview validates sampling/timezone and supplies the local day boundaries.
        let mut preview = automation::sources::preview_source(&request, now)?;
        let config = snapshot.load().runtime_config.clone();
        let catalog = ConfigCatalog::from_export(&config);
        let body = automation::reuse::resolve_source(&request.compute, &catalog)?;
        let definition = SourceDefinition {
            id: crate::types::automation_definition::SourceId("preview".into()),
            name: "Preview".into(),
            enabled: true,
            revision: 1,
            timezone: request.timezone.clone(),
            refresh_interval_ms: 60000,
            aliases: vec![],
            compute: request.compute.clone(),
        };
        let mut samples = Vec::new();
        for index in 0..request.samples.unwrap_or(DEFAULT_SOURCE_PREVIEW_SAMPLES) {
            let time_ms = preview.day_start_ms + i64::from(index) * preview.step_ms;
            let (context, label) = automation::sources::script_context(&definition, time_ms)?;
            let result = automation::reuse::preview_execute(&body, context).await?;
            let result = automation::parse_computed_source_outcome(
                &result,
                automation::MAX_SCRIPT_STATE_BYTES,
            )?;
            let profile: crate::types::automation_source::LightProfile =
                serde_json::from_value(result.value).map_err(|error| error.to_string())?;
            profile.validate()?;
            samples.push(SourcePreviewSample {
                time_ms,
                local_time: label[..5].into(),
                profile,
            });
        }
        preview.samples = samples;
        preview.unsupported_reason = None;
        preview.note = None;
        Ok(preview)
    }
    .await;
    Ok(match result {
        Ok(preview) => ApiResponse::success(preview).into_response(),
        Err(error) => error_response(&error, StatusCode::BAD_REQUEST).into_response(),
    })
}

async fn list_sources(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(snap.runtime_config.sources.clone()))
}

#[derive(Deserialize)]
struct SourceUpdate {
    #[serde(flatten)]
    source: SourceDefinition,
    #[serde(default)]
    expected: Option<SourceDefinition>,
    #[serde(default)]
    create_only: bool,
}

async fn upsert_source(
    id: String,
    request: SourceUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let SourceUpdate {
        mut source,
        expected,
        create_only,
    } = request;
    if source.id.0 != id {
        return Ok(error_response(
            "Source id in the path does not match the body.",
            StatusCode::BAD_REQUEST,
        ));
    }
    if let Err(error) = validate_source(&source) {
        return Ok(error_response(&error, StatusCode::BAD_REQUEST));
    }

    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let outcome = handle.mutate(move |state| Box::pin(async move {
        let current = state.runtime_config.sources.iter().find(|row| row.id == source.id);
        if create_only && current.is_some() {
            return Err((StatusCode::CONFLICT, serde_json::json!({"success": false, "error": "This source ID is already in use."})));
        }
        if let Some(expected) = expected.as_ref() {
            match current {
                None => return Err((StatusCode::NOT_FOUND, serde_json::json!({"success": false, "error": "This source was deleted. Your draft has not been saved."}))),
                Some(current) if current != expected => return Err((StatusCode::CONFLICT, serde_json::json!({"success": false, "error": "This source changed elsewhere.", "current": current}))),
                _ => {}
            }
        }
        if matches!(source.compute,SourceCompute::Script { .. }) {
            let catalog=ConfigCatalog::new(state.devices.get_state().0.keys().cloned(),&state.runtime_config);
            automation::reuse::resolve_source(&source.compute,&catalog).map_err(|error|(StatusCode::BAD_REQUEST,serde_json::json!({"success":false,"error":error})))?;
        }
        source.revision = current.map(|row| row.revision + 1).unwrap_or(1);
        state.upsert_source(source.clone());
        state.schedule_ws_broadcast(SnapshotChanges { runtime_config: true, ..SnapshotChanges::none() });
        Ok(source)
    })).await;
    let source = match outcome {
        Ok(Ok(source)) => source,
        Ok(Err((status, body))) => {
            return Ok(warp::reply::with_status(warp::reply::json(&body), status))
        }
        Err(_) => return Ok(actor_unavailable()),
    };

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_source(&source).await;
    Ok(config_write_response(
        source,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

async fn delete_source(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let source_id = SourceId(id.clone());
    let deleted = handle
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
        .await;
    let deleted = match deleted {
        Ok(deleted) => deleted,
        Err(_) => return Ok(actor_unavailable()),
    };

    if !deleted {
        return Ok(not_found("Source"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_source(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::automation_source::CircadianCompatParams;
    use crate::types::color::DeviceColor;
    use crate::types::device::{DeviceId, DeviceKey};
    use crate::types::integration::IntegrationId;

    fn valid_source() -> SourceDefinition {
        SourceDefinition {
            id: SourceId("circadian".to_string()),
            name: "Circadian".to_string(),
            enabled: true,
            revision: 1,
            timezone: "Europe/Helsinki".to_string(),
            refresh_interval_ms: 60_000,
            aliases: vec![DeviceKey::new(
                IntegrationId::from("circadian".to_string()),
                DeviceId::new("color"),
            )],
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
        }
    }

    #[tokio::test]
    async fn source_edits_compare_the_baseline_and_increment_revision_atomically() {
        use crate::core::state::actor::spawn_state_actor;
        let (state, _events) = crate::core::event::tests::test_state();
        let snapshot = state.snapshot.clone();
        let (deferred_tx, _deferred_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), deferred_tx);
        let routes = sources_routes(&snapshot, &handle);
        let mut source = valid_source();
        source.revision = 900;
        let mut create = serde_json::to_value(&source).unwrap();
        create["create_only"] = serde_json::json!(true);
        let response = warp::test::request()
            .method("PUT")
            .path("/sources/circadian")
            .json(&create)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let saved: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(saved["data"]["revision"], 1);
        assert_eq!(saved["data"]["compute"]["params"]["day_color"]["ct"], 3000);
        let response = warp::test::request()
            .method("PUT")
            .path("/sources/circadian")
            .json(&create)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let baseline = saved["data"].clone();
        let mut update = baseline.clone();
        update["expected"] = baseline;
        update["name"] = serde_json::json!("New source name");
        let response = warp::test::request()
            .method("PUT")
            .path("/sources/circadian")
            .json(&update)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let saved: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(saved["data"]["revision"], 2);
        let response = warp::test::request()
            .method("PUT")
            .path("/sources/circadian")
            .json(&update)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let conflict: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(conflict["current"]["name"], "New source name");
        assert_eq!(conflict["current"]["revision"], 2);
    }

    #[test]
    fn valid_definitions_pass_and_ambiguous_ones_are_reported() {
        validate_source(&valid_source()).unwrap();

        let mut unsupported_preset = valid_source();
        let SourceCompute::CircadianCompat { preset_version, .. } = &mut unsupported_preset.compute
        else {
            panic!("fixture is the built-in preset");
        };
        *preset_version = 99;
        assert!(validate_source(&unsupported_preset)
            .unwrap_err()
            .contains("unsupported circadian preset version"));

        let mut overlapping = valid_source();
        let SourceCompute::CircadianCompat { params, .. } = &mut overlapping.compute else {
            panic!("fixture is the built-in preset");
        };
        params.day_fade_duration_hours = 16;
        assert!(validate_source(&overlapping)
            .unwrap_err()
            .contains("overlap"));

        let mut unknown_zone = valid_source();
        unknown_zone.timezone = "Mars/Olympus".to_string();
        assert!(validate_source(&unknown_zone)
            .unwrap_err()
            .contains("unknown timezone"));

        let mut too_fast = valid_source();
        too_fast.refresh_interval_ms = 10;
        assert!(validate_source(&too_fast)
            .unwrap_err()
            .contains("refresh_interval_ms"));

        let mut duplicate_aliases = valid_source();
        let first_alias = duplicate_aliases.aliases[0].clone();
        duplicate_aliases.aliases.push(first_alias);
        assert!(validate_source(&duplicate_aliases)
            .unwrap_err()
            .contains("duplicate alias"));

        let mut empty_name = valid_source();
        empty_name.name = "  ".to_string();
        assert!(validate_source(&empty_name).unwrap_err().contains("name"));
    }
}
