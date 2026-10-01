use super::*;
use crate::core::automation::{self, blocks};
use crate::core::state::AppState;
use crate::types::automation_block::AutomationBlock;

#[derive(Deserialize)]
struct BlockUpdate {
    #[serde(flatten)]
    block: AutomationBlock,
    #[serde(default)]
    expected: Option<AutomationBlock>,
    #[serde(default)]
    create_only: bool,
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("blocks")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            ApiResponse::success(snapshot.load().runtime_config.blocks.clone())
        });
    let save = warp::path!("blocks" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(save_block);
    let delete = warp::path!("blocks" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_block);
    list.or(save).or(delete)
}

async fn save_block(
    id: String,
    request: BlockUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    if id != request.block.id {
        return Ok(error_response(
            "The path and block ID must match.",
            StatusCode::BAD_REQUEST,
        ));
    }
    if let Err(error) = blocks::validate_block(&request.block) {
        return Ok(error_response(&error.to_string(), StatusCode::BAD_REQUEST));
    }
    let _guard = match config_write_lock(&handle).await {
        Ok(g) => g,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                write_block(state, request.block, request.expected, request.create_only)
            })
        })
        .await;
    let (block, changed, changed_helpers, changed_sources) = match result {
        Ok(Ok(v)) => v,
        Ok(Err((status, body))) => {
            return Ok(warp::reply::with_status(warp::reply::json(&body), status))
        }
        Err(_) => return Ok(actor_unavailable()),
    };
    let available = db::is_db_connected();
    let persistence =
        config_queries::db_save_block_change(&block, &changed, &changed_helpers, &changed_sources)
            .await;
    Ok(config_write_response(
        block,
        persistence,
        available,
        StatusCode::OK,
    ))
}

/// Shared actor mutation for editor saves and reviewed assistant operations.
/// The caller holds the config write guard and persists the returned changes together.
pub(super) type BlockChange = (
    AutomationBlock,
    Vec<RoutineRow>,
    Vec<crate::types::automation_value::HelperDefinition>,
    Vec<crate::types::automation_source::SourceDefinition>,
);
pub(super) fn write_block(
    state: &mut AppState,
    block: AutomationBlock,
    expected: Option<AutomationBlock>,
    create_only: bool,
) -> Result<BlockChange, (StatusCode, serde_json::Value)> {
    let id = block.id.clone();
    blocks::validate_block(&block).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error":e.to_string()}),
        )
    })?;
    let mut block = block;
    let current = state.runtime_config.blocks.iter().find(|b| b.id == id);
    if create_only && current.is_some() {
        return Err((
            StatusCode::CONFLICT,
            serde_json::json!({"success":false,"error":"This block ID is already in use."}),
        ));
    }
    if let Some(expected) = &expected {
        match current {
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    serde_json::json!({"success":false,"error":"This block was deleted. Your draft is still here."}),
                ))
            }
            Some(current) if current != expected => {
                return Err((
                    StatusCode::CONFLICT,
                    serde_json::json!({"success":false,"error":"This block changed elsewhere.","current":current}),
                ))
            }
            _ => {}
        }
    }
    block.revision = current.map(|b| b.revision.saturating_add(1)).unwrap_or(1);
    let mut config = state.runtime_config.clone();
    config.blocks.retain(|b| b.id != id);
    config.blocks.push(block.clone());
    let catalog = ConfigCatalog::new(state.devices.get_state().0.keys().cloned(), &config);
    blocks::validate_catalog(&catalog).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            serde_json::json!({"success":false,"error":e.to_string()}),
        )
    })?;
    // Resolve indirect users as well, so edits invalidate pending work and
    // every caller is revalidated before the shared definition changes.
    let mut affected = std::collections::HashSet::from([id]);
    loop {
        let before = affected.len();
        for parent in &config.blocks {
            if affected
                .iter()
                .any(|id| blocks::references(&parent.body, id))
            {
                affected.insert(parent.id.clone());
            }
        }
        if affected.len() == before {
            break;
        }
    }
    let mut changed = Vec::new();
    for routine in &mut config.routines {
        if routine
            .definition_v2
            .as_ref()
            .is_some_and(|v| affected.iter().any(|id| blocks::references(v, id)))
        {
            if routine.enabled {
                automation::compile_row(routine,&catalog).map_err(|e| (StatusCode::BAD_REQUEST,serde_json::json!({"success":false,"error":format!("Routine '{}': {}",routine.name,e.summary())})))?;
            }
            routine.revision = automation::next_revision(Some(routine));
            changed.push(routine.clone());
        }
    }
    automation::reuse::validate_helpers(&config, &catalog).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            serde_json::json!({"success":false,"error":error}),
        )
    })?;
    let mut changed_helpers = Vec::new();
    for helper in &mut config.helpers {
        if let Some(compute) = &mut helper.compute {
            if affected.iter().any(|id| {
                blocks::references(
                    &serde_json::to_value(&compute.script).unwrap_or_default(),
                    id,
                )
            }) {
                compute.revision = compute.revision.saturating_add(1);
                changed_helpers.push(helper.clone());
            }
        }
    }
    let mut changed_sources = Vec::new();
    for source in &mut config.sources {
        if affected.iter().any(|id| {
            blocks::references(
                &serde_json::to_value(&source.compute).unwrap_or_default(),
                id,
            )
        }) {
            automation::reuse::resolve_source(&source.compute, &catalog).map_err(|error| {
                (
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"success":false,"error":error}),
                )
            })?;
            source.revision = source.revision.saturating_add(1);
            changed_sources.push(source.clone());
        }
    }
    state.runtime_config = config;
    for helper in &changed_helpers {
        state
            .helpers
            .upsert_definition(helper.clone())
            .map_err(|error| {
                (
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"success":false,"error":error}),
                )
            })?;
    }
    state.scripts.sync_helper_owners(&state.helpers);
    if !changed_sources.is_empty() {
        state.apply_runtime_sources();
    }
    state.apply_runtime_routines();
    state.schedule_ws_broadcast(SnapshotChanges {
        runtime_config: true,
        ..SnapshotChanges::none()
    });
    Ok((block, changed, changed_helpers, changed_sources))
}

async fn delete_block(id: String, handle: StateHandle) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(g) => g,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| Box::pin(async move { remove_block(state, id) }))
        .await;
    let id = match result {
        Ok(Ok(id)) => id,
        Ok(Err((status, message))) => return Ok(error_response(&message, status)),
        Err(_) => return Ok(actor_unavailable()),
    };
    let available = db::is_db_connected();
    let persistence = config_queries::db_delete_block(&id).await;
    Ok(config_write_response(
        serde_json::json!({"id":id}),
        persistence,
        available,
        StatusCode::OK,
    ))
}

pub(super) fn remove_block(
    state: &mut AppState,
    id: String,
) -> Result<String, (StatusCode, String)> {
    if !state.runtime_config.blocks.iter().any(|b| b.id == id) {
        return Err((StatusCode::NOT_FOUND, "Block not found.".to_string()));
    }
    let users: Vec<_> = state
        .runtime_config
        .routines
        .iter()
        .filter(|r| {
            r.definition_v2
                .as_ref()
                .is_some_and(|v| blocks::references(v, &id))
        })
        .map(|r| r.name.clone())
        .chain(
            state
                .runtime_config
                .blocks
                .iter()
                .filter(|b| b.id != id && blocks::references(&b.body, &id))
                .map(|b| b.name.clone()),
        )
        .collect();
    let mut users = users;
    users.extend(
        state
            .runtime_config
            .helpers
            .iter()
            .filter(|helper| {
                helper.compute.as_ref().is_some_and(|compute| {
                    blocks::references(
                        &serde_json::to_value(&compute.script).unwrap_or_default(),
                        &id,
                    )
                })
            })
            .map(|helper| helper.name.clone()),
    );
    users.extend(
        state
            .runtime_config
            .sources
            .iter()
            .filter(|source| {
                blocks::references(
                    &serde_json::to_value(&source.compute).unwrap_or_default(),
                    &id,
                )
            })
            .map(|source| source.name.clone()),
    );
    if !users.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            format!(
                "This block is used by: {}. Remove those calls first.",
                users.join(", ")
            ),
        ));
    }
    state.runtime_config.blocks.retain(|b| b.id != id);
    state.schedule_ws_broadcast(SnapshotChanges {
        runtime_config: true,
        ..SnapshotChanges::none()
    });
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    use serde_json::json;
    fn fixture() -> (AutomationBlock, StateHandle, SnapshotHandle) {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let block:AutomationBlock=serde_json::from_value(json!({"id":"inner","name":"Inner","kind":"condition","body":{"kind":"literal","value":true}})).unwrap();
        let outer:AutomationBlock=serde_json::from_value(json!({"id":"outer","name":"Outer","kind":"condition","body":{"kind":"block","block_id":"inner","inputs":{}}})).unwrap();
        state.runtime_config.blocks = vec![block.clone(), outer];
        state.runtime_config.groups = serde_json::from_value(
            json!([{"id":"room","name":"Room","hidden":false,"devices":[],"linked_groups":[]}]),
        )
        .unwrap();
        let routine:RoutineRow=serde_json::from_value(json!({"id":"caller","name":"Caller","enabled":true,"semantics_version":2,"revision":7,"rules":[],"actions":[],"definition_v2":{"triggers":[{"kind":"manual","id":"start"}],"condition":{"kind":"block","block_id":"outer","inputs":{}},"program":{"kind":"native","steps":[{"action":"dim","id":"power","step":0.1,"targets":{"groups":["room"]}}]}}})).unwrap();
        state.runtime_config.routines = vec![routine];
        state.apply_runtime_routines();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), tx);
        (block, handle, snapshot)
    }
    async fn request(
        handle: &StateHandle,
        block: AutomationBlock,
        expected: Option<AutomationBlock>,
        create_only: bool,
    ) -> warp::reply::Response {
        save_block(
            block.id.clone(),
            BlockUpdate {
                block,
                expected,
                create_only,
            },
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response()
    }
    #[tokio::test]
    async fn edit_revalidates_transitive_callers_bumps_revisions_and_rejects_stale_edits() {
        let (old, handle, snapshot) = fixture();
        let mut next = old.clone();
        next.body = json!({"kind":"literal","value":false});
        assert_eq!(
            request(&handle, next.clone(), Some(old.clone()), false)
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(snapshot.load().runtime_config.routines[0].revision, 8);
        assert_eq!(snapshot.load().runtime_config.blocks[0].id, "outer");
        let saved = snapshot
            .load()
            .runtime_config
            .blocks
            .iter()
            .find(|b| b.id == "inner")
            .unwrap()
            .clone();
        assert_eq!(saved.revision, 2);
        assert_eq!(
            request(&handle, next, Some(old.clone()), false)
                .await
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            request(&handle, old, None, true).await.status(),
            StatusCode::CONFLICT
        );
        assert_eq!(snapshot.load().runtime_config.routines[0].revision, 8);
        let mut breaking = saved.clone();
        breaking.inputs.insert(
            "new".into(),
            serde_json::from_value(json!({"label":"Required","kind":{"kind":"boolean"}})).unwrap(),
        );
        assert_eq!(
            request(&handle, breaking, Some(saved.clone()), false)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            snapshot
                .load()
                .runtime_config
                .blocks
                .iter()
                .find(|b| b.id == "inner"),
            Some(&saved)
        );
        assert_eq!(snapshot.load().runtime_config.routines[0].revision, 8);
    }
    #[tokio::test]
    async fn referenced_definitions_cannot_be_deleted_but_unused_ones_can() {
        let (block, handle, _snapshot) = fixture();
        assert_eq!(
            delete_block("inner".into(), handle.clone())
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            delete_block("outer".into(), handle.clone())
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::CONFLICT
        );
        let unused = AutomationBlock {
            id: "unused".into(),
            ..block
        };
        assert_eq!(
            request(&handle, unused, None, true).await.status(),
            StatusCode::OK
        );
        assert_eq!(
            delete_block("unused".into(), handle.clone())
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            delete_block("unused".into(), handle)
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    #[tokio::test]
    async fn function_edits_invalidate_transitive_routine_helper_and_source_callers() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let inner:AutomationBlock=serde_json::from_value(json!({"id":"inner","name":"Inner","kind":"function","body":{"kind":"javascript","spec":{"api_version":1,"source_body":"return 1;","declarations":[],"limits_profile":"default"},"output":{"kind":"number"}}})).unwrap();
        let outer:AutomationBlock=serde_json::from_value(json!({"id":"outer","name":"Outer","kind":"function","body":{"kind":"javascript","spec":{"api_version":1,"source_body":"return api.functions.call('inner',{});","functions":["inner"],"declarations":[],"limits_profile":"default"},"output":{"kind":"number"}}})).unwrap();
        state.runtime_config.blocks = vec![inner.clone(), outer];
        state.runtime_config.routines=serde_json::from_value(json!([{"id":"routine","name":"Routine","enabled":true,"semantics_version":2,"revision":3,"rules":[],"actions":[],"definition_v2":{"triggers":[{"kind":"manual","id":"manual"}],"program":{"kind":"script","spec":{"api_version":1,"source_body":"api.functions.call('outer',{});return {actions:[]};","functions":["outer"],"declarations":[],"limits_profile":"default"}}}}])).unwrap();
        state.runtime_config.helpers=serde_json::from_value(json!([{"id":"helper","name":"Helper","kind":{"kind":"number"},"initial_value":0,"persistence":"durable","compute":{"enabled":false,"revision":2,"refresh_ms":60000,"helpers":[],"script":{"api_version":1,"source_body":"return api.functions.call('outer',{});","functions":["outer"],"declarations":[],"limits_profile":"default"}}}])).unwrap();
        state.runtime_config.sources=serde_json::from_value(json!([{"id":"source","name":"Source","enabled":false,"revision":4,"timezone":"Europe/Helsinki","refresh_interval_ms":60000,"aliases":[],"compute":{"kind":"script","source_body":"return {value:{brightness:api.functions.call('outer',{})}};","functions":["outer"],"params":{}}}])).unwrap();
        state.apply_runtime_helpers();
        state.apply_runtime_routines();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), tx);
        let mut edited = inner.clone();
        edited.body["spec"]["source_body"] = json!("return 0.5;");
        assert_eq!(
            request(&handle, edited, Some(inner.clone()), false)
                .await
                .status(),
            StatusCode::OK
        );
        let config = &snapshot.load().runtime_config;
        let saved = config
            .blocks
            .iter()
            .find(|block| block.id == "inner")
            .unwrap()
            .clone();
        assert_eq!(saved.revision, 2);
        assert_eq!(config.routines[0].revision, 4);
        assert_eq!(config.helpers[0].compute.as_ref().unwrap().revision, 3);
        assert_eq!(config.sources[0].revision, 5);
        assert_eq!(
            request(&handle, inner.clone(), Some(inner), false)
                .await
                .status(),
            StatusCode::CONFLICT
        );
        let mut invalid = saved.clone();
        invalid.body["spec"]["functions"] = json!(["missing"]);
        assert_eq!(
            request(&handle, invalid, Some(saved.clone()), false)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            snapshot
                .load()
                .runtime_config
                .blocks
                .iter()
                .find(|block| block.id == "inner"),
            Some(&saved)
        );
        assert_eq!(
            delete_block("inner".into(), handle.clone())
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            delete_block("outer".into(), handle)
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::CONFLICT
        );
    }
}
