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
        .and_then(preview_source);

    let upsert = warp::path!("sources" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
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
async fn preview_source(request: SourcePreviewRequest) -> Result<impl Reply, warp::Rejection> {
    match crate::core::automation::sources::preview_source(
        &request,
        chrono::Utc::now().timestamp_millis(),
    ) {
        Ok(preview) => Ok(ApiResponse::success(preview)),
        Err(error) => Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    }
}

/// Shipped preset metadata, including the forkable body. The body is a
/// shipped application asset, not a secret.
async fn list_source_presets() -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(
        crate::core::automation::sources::preset_infos(),
    ))
}

async fn list_sources(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(snap.runtime_config.sources.clone()))
}

async fn upsert_source(
    id: String,
    mut source: SourceDefinition,
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
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

    // Revisions are server-owned so consumers can reject superseded results.
    source.revision = {
        let snap = snapshot.load();
        snap.runtime_config
            .sources
            .iter()
            .find(|existing| existing.id == source.id)
            .map(|existing| existing.revision + 1)
            .unwrap_or(1)
    };

    let source_for_state = source.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_source(source_for_state);
                state.schedule_ws_broadcast(SnapshotChanges {
                    runtime_config: true,
                    ..SnapshotChanges::none()
                });
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

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
