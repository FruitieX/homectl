use super::*;

pub(super) fn scenes_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_scenes);

    let get = warp::path!("scenes" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_scene);

    let create = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_scene);

    let update = warp::path!("scenes" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_scene);

    let delete = warp::path!("scenes" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_scene);

    let preview = warp::path!("scenes" / "preview")
        .and(warp::post())
        .and(warp::body::content_length_limit(2 * 1024 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(preview_scene);
    list.or(get).or(create).or(update).or(delete).or(preview)
}

pub(super) async fn list_scenes(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(snap.runtime_config.scenes.clone()))
}

pub(super) async fn get_scene(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .scenes
        .iter()
        .find(|scene| scene.id == id)
        .cloned()
    {
        Some(scene) => Ok(ApiResponse::success(scene)),
        None => Ok(not_found("Scene")),
    }
}

#[derive(Deserialize)]
pub(super) struct SceneUpdate {
    #[serde(flatten)]
    scene: SceneRow,
    expected: Option<SceneRow>,
}

pub(super) async fn create_scene(
    scene: SceneRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    write_scene(scene, None, true, handle).await
}
pub(super) async fn update_scene(
    id: String,
    mut request: SceneUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    request.scene.id = id;
    write_scene(request.scene, request.expected, false, handle).await
}
async fn write_scene(
    scene: SceneRow,
    expected: Option<SceneRow>,
    create: bool,
    handle: StateHandle,
) -> Result<warp::reply::WithStatus<warp::reply::Json>, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    if scene.id.trim().is_empty() || scene.name.trim().is_empty() {
        return Ok(error_response(
            "Give the scene a name and an ID",
            StatusCode::BAD_REQUEST,
        ));
    }
    let next = scene.clone();
    let outcome = handle.mutate(move |state| Box::pin(async move {
        let current = state.runtime_config.scenes.iter().find(|row| row.id == next.id);
        if create && current.is_some() { return Err((StatusCode::CONFLICT, serde_json::json!({ "success": false, "error": "This scene ID is already in use." }))); }
        if !create && current.is_none() { return Err((StatusCode::NOT_FOUND, serde_json::json!({ "success": false, "error": "This scene was deleted. Your draft has not been saved." }))); }
        if let (Some(expected), Some(current)) = (expected.as_ref(), current) {
            if serde_json::to_value(expected).ok() != serde_json::to_value(current).ok() {
                return Err((StatusCode::CONFLICT, serde_json::json!({ "success": false, "error": "This scene changed elsewhere.", "current": current })));
            }
        }
        state.upsert_scene(next);
        state.apply_runtime_scenes();
        Ok(())
    })).await;
    match outcome {
        Err(_) => return Ok(actor_unavailable()),
        Ok(Err((status, body))) => {
            return Ok(warp::reply::with_status(warp::reply::json(&body), status))
        }
        Ok(Ok(())) => {}
    }
    let available = db::is_db_connected();
    let persistence = config_queries::db_upsert_config_scene(&scene).await;
    Ok(config_write_response(
        scene,
        persistence,
        available,
        if create {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
    ))
}

/// Read-only authoring preview. All scene materialization occurs on private
/// copies; no event sender is invoked and no configuration is persisted.
async fn preview_scene(
    scene: SceneRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    preview_scene_with_pool(scene, handle, None).await
}

async fn preview_scene_with_pool(
    scene: SceneRow,
    handle: StateHandle,
    pool: Option<&crate::core::js_worker::JsWorkerPool>,
) -> Result<impl Reply, warp::Rejection> {
    use crate::core::js_worker::{JsWorkerPool, SupervisorConfig};
    use crate::types::scene::SceneId;
    static PREVIEW_POOL: tokio::sync::OnceCell<JsWorkerPool> = tokio::sync::OnceCell::const_new();
    let cloned = handle
        .mutate(|state| {
            Box::pin(async move {
                (
                    state.scenes.clone(),
                    state.devices.clone(),
                    state.groups.clone(),
                    state.runtime_config.scenes.clone(),
                )
            })
        })
        .await;
    let (mut scenes, devices, groups, mut rows) = match cloned {
        Ok(value) => value,
        Err(_) => return Ok(actor_unavailable()),
    };
    let scene_id = SceneId::new(scene.id.clone());
    rows.retain(|row| row.id != scene.id);
    rows.push(scene.clone());
    let overrides = scenes.get_scene_overrides();
    scenes.load_config_rows(&rows, overrides);
    scenes.force_invalidate(&devices, &groups);
    let requests = scenes.take_scene_materialization_requests();
    let mut script_evaluated = false;
    if let Some(request) = requests
        .into_iter()
        .find(|request| request.scene_id == scene_id)
    {
        let pool = match pool {
            Some(pool) => pool,
            None => match PREVIEW_POOL
                .get_or_try_init(|| {
                    JsWorkerPool::new(SupervisorConfig {
                        workers: 1,
                        max_outstanding_requests: 8,
                        ..Default::default()
                    })
                })
                .await
            {
                Ok(pool) => pool,
                Err(error) => {
                    return Ok(error_response(
                        &format!("Could not preview the script: {error}"),
                        StatusCode::SERVICE_UNAVAILABLE,
                    ))
                }
            },
        };
        match pool
            .execute_legacy_scene(&request.script, request.context)
            .await
        {
            Ok(value) => {
                scenes.apply_scene_script_result(
                    &devices,
                    &groups,
                    &scene_id,
                    request.revision,
                    Some(&value),
                    None,
                );
                script_evaluated = true;
            }
            Err(error) => {
                return Ok(error_response(
                    &format!("Script preview failed: {error}"),
                    StatusCode::BAD_REQUEST,
                ))
            }
        }
        scenes.force_invalidate(&devices, &groups);
    }
    let mut resolved = BTreeMap::new();
    for (key, device) in &devices.get_state().0 {
        if let Some((state, source)) =
            scenes.get_device_scene_state_details(&scene_id, device, &devices)
        {
            resolved.insert(
                key.to_string(),
                serde_json::json!({ "state": state, "source": source }),
            );
        }
    }
    let active_overrides = scenes
        .get_scene_overrides()
        .get(&scene_id)
        .map(|rows| rows.keys().map(ToString::to_string).collect::<Vec<_>>())
        .unwrap_or_default();
    Ok(ApiResponse::success(serde_json::json!({
        "devices": resolved, "active_overrides": active_overrides, "script_evaluated": script_evaluated,
        "evaluated_at": chrono::Utc::now().to_rfc3339(),
    })))
}

pub(super) async fn delete_scene(
    id: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let id_for_state = id.clone();
    let deleted = handle
        .mutate(move |state| {
            Box::pin(async move {
                let deleted = state.delete_scene(&id_for_state);
                if deleted {
                    state.apply_runtime_scenes();
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
        return Ok(not_found("Scene"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_config_scene(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Routines
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    use crate::types::{
        color::Capabilities,
        device::{ControllableDevice, DeviceId, ManageKind},
    };
    fn row(id: &str) -> SceneRow {
        SceneRow {
            id: id.into(),
            name: id.into(),
            hidden: false,
            script: None,
            device_states: HashMap::new(),
            group_states: HashMap::new(),
            group_state_order: vec![],
        }
    }
    fn handle() -> StateHandle {
        let (mut state, _events) = crate::core::event::tests::test_state();
        for id in ["lamp", "source"] {
            let device = Device::new(
                "dummy".to_string().into(),
                DeviceId::new(id),
                id.into(),
                DeviceData::Controllable(ControllableDevice::new(
                    None,
                    true,
                    Some(0.6),
                    None,
                    None,
                    Capabilities::default(),
                    ManageKind::Unmanaged,
                )),
                None,
            );
            state.devices.set_state(&device, true, true);
        }
        for id in ["a", "b"] {
            state.upsert_group(GroupRow {
                id: id.into(),
                name: id.into(),
                hidden: false,
                devices: vec![GroupDeviceRow {
                    integration_id: "dummy".into(),
                    device_id: "lamp".into(),
                }],
                linked_groups: vec![],
            });
        }
        state.apply_runtime_groups();
        let mut source = row("source_scene");
        source.group_states.insert(
            "a".into(),
            serde_json::json!({ "power": true, "brightness": 0.75, "color": { "ct": 250 } }),
        );
        state.upsert_scene(source);
        state.apply_runtime_scenes();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        spawn_state_actor(state, snapshot, tx)
    }
    async fn body(reply: impl Reply) -> serde_json::Value {
        serde_json::from_slice(
            &warp::hyper::body::to_bytes(reply.into_response().into_body())
                .await
                .unwrap(),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn draft_preview_uses_actual_links_order_and_does_not_change_runtime() {
        let handle = handle();
        let before = handle.mutate(|state| Box::pin(async move { serde_json::json!({ "config": state.runtime_config, "devices": state.devices.get_state() }) })).await.unwrap();
        let mut draft = row("draft");
        draft.device_states.insert("dummy/lamp".into(), serde_json::json!({ "integration_id": "dummy", "device_id": "source", "brightness": 0.5 }));
        let result = body(preview_scene(draft.clone(), handle.clone()).await.unwrap()).await;
        assert!(
            (result["data"]["devices"]["dummy/lamp"]["state"]["brightness"]
                .as_f64()
                .unwrap()
                - 0.3)
                .abs()
                < 0.00001
        );
        draft.device_states.insert(
            "dummy/lamp".into(),
            serde_json::json!({ "scene_id": "source_scene", "transition": 0.8 }),
        );
        let result = body(preview_scene(draft.clone(), handle.clone()).await.unwrap()).await;
        assert_eq!(
            result["data"]["devices"]["dummy/lamp"]["state"]["brightness"],
            0.75
        );
        assert_eq!(
            result["data"]["devices"]["dummy/lamp"]["state"]["color"]["ct"],
            250
        );
        draft.device_states.clear();
        draft
            .group_states
            .insert("b".into(), serde_json::json!({ "brightness": 0.8 }));
        draft
            .group_states
            .insert("a".into(), serde_json::json!({ "brightness": 0.2 }));
        let result = body(preview_scene(draft.clone(), handle.clone()).await.unwrap()).await;
        assert!(
            (result["data"]["devices"]["dummy/lamp"]["state"]["brightness"]
                .as_f64()
                .unwrap()
                - 0.8)
                .abs()
                < 0.00001
        );
        draft.group_state_order = vec!["b".into(), "a".into()];
        let result = body(preview_scene(draft.clone(), handle.clone()).await.unwrap()).await;
        assert!(
            (result["data"]["devices"]["dummy/lamp"]["state"]["brightness"]
                .as_f64()
                .unwrap()
                - 0.2)
                .abs()
                < 0.00001
        );
        draft
            .device_states
            .insert("dummy/lamp".into(), serde_json::json!({}));
        let result = body(preview_scene(draft.clone(), handle.clone()).await.unwrap()).await;
        assert_eq!(
            result["data"]["devices"]["dummy/lamp"]["state"]["power"],
            true
        );
        assert!(result["data"]["devices"]["dummy/lamp"]["state"]["brightness"].is_null());
        draft.device_states.insert(
            "dummy/lamp".into(),
            serde_json::json!({ "scene_id": "draft" }),
        );
        let result = body(preview_scene(draft, handle.clone()).await.unwrap()).await;
        assert_eq!(result["data"]["devices"], serde_json::json!({}));
        let after = handle.mutate(|state| Box::pin(async move { serde_json::json!({ "config": state.runtime_config, "devices": state.devices.get_state() }) })).await.unwrap();
        assert_eq!(before, after);
    }
    #[tokio::test]
    #[ignore = "requires cargo build --bin script-worker; run explicitly with --ignored"]
    async fn script_preview_executes_isolated_worker_and_preserves_runtime() {
        use crate::core::js_worker::{JsWorkerPool, SupervisorConfig};
        let binary = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(format!("script-worker{}", std::env::consts::EXE_SUFFIX));
        assert!(
            binary.exists(),
            "Build the script-worker binary before this integration test"
        );
        let pool = JsWorkerPool::new(SupervisorConfig {
            worker_binary: Some(binary),
            workers: 1,
            ..Default::default()
        })
        .await
        .unwrap();
        let handle = handle();
        let before = handle.mutate(|state| Box::pin(async move { serde_json::json!({ "config": state.runtime_config, "devices": state.devices.get_state() }) })).await.unwrap();
        let mut draft = row("script_preview");
        draft.device_states.insert(
            "dummy/lamp".into(),
            serde_json::json!({ "brightness": 0.1 }),
        );
        draft.script = Some("defineSceneScript(function () { return { 'dummy/lamp': { power: true, brightness: 0.9, color: { h: 120, s: 0.8 } } }; })".into());
        let result = body(
            preview_scene_with_pool(draft.clone(), handle.clone(), Some(&pool))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(result["data"]["script_evaluated"], true, "{result}");
        assert!(
            (result["data"]["devices"]["dummy/lamp"]["state"]["brightness"]
                .as_f64()
                .unwrap()
                - 0.9)
                .abs()
                < 0.00001
        );
        assert_eq!(
            result["data"]["devices"]["dummy/lamp"]["state"]["color"]["h"],
            120.0
        );
        draft.script = Some("(() => { throw new Error('Deliberate preview error'); })()".into());
        let reply = preview_scene_with_pool(draft, handle.clone(), Some(&pool))
            .await
            .unwrap()
            .into_response();
        assert_eq!(reply.status(), StatusCode::BAD_REQUEST);
        assert!(body(reply).await["error"]
            .as_str()
            .unwrap()
            .contains("Deliberate preview error"));
        let after = handle.mutate(|state| Box::pin(async move { serde_json::json!({ "config": state.runtime_config, "devices": state.devices.get_state() }) })).await.unwrap();
        assert_eq!(before, after);
    }
    #[tokio::test]
    async fn unrelated_scene_edits_preserve_malformed_raw_targets() {
        let handle = handle();
        let mut original = row("raw-scene");
        original.device_states = serde_json::from_value(serde_json::json!({
            "dummy/lamp":null,"dummy/source":{"color":{"future":123},"future":[false,null,0]},
            "missing/device":false
        }))
        .unwrap();
        let input = original.clone();
        handle
            .mutate(move |state| {
                Box::pin(async move {
                    state.upsert_scene(input);
                    state.apply_runtime_scenes();
                })
            })
            .await
            .unwrap();
        let mut edited = original.clone();
        edited.name = "Renamed without losing targets".into();
        let expected = serde_json::to_value(&edited).unwrap();
        let response = body(
            update_scene(
                edited.id.clone(),
                SceneUpdate {
                    scene: edited,
                    expected: Some(original),
                },
                handle.clone(),
            )
            .await
            .unwrap(),
        )
        .await;
        assert_eq!(response["data"], expected);
        let after = handle
            .mutate(|state| {
                Box::pin(async move {
                    serde_json::to_value(
                        state
                            .runtime_config
                            .scenes
                            .iter()
                            .find(|s| s.id == "raw-scene")
                            .unwrap(),
                    )
                    .unwrap()
                })
            })
            .await
            .unwrap();
        assert_eq!(after, expected);
    }

    #[tokio::test]
    async fn stale_scene_save_returns_current_and_preserves_configuration() {
        let handle = handle();
        let original = row("source_scene");
        let reply = update_scene(
            original.id.clone(),
            SceneUpdate {
                scene: original.clone(),
                expected: Some(original),
            },
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(reply.status(), StatusCode::CONFLICT);
        let result = body(reply).await;
        assert_eq!(result["current"]["group_states"]["a"]["brightness"], 0.75);
    }
}
