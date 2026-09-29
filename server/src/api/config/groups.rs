use super::*;

pub(super) fn groups_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("groups")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_groups);

    let get = warp::path!("groups" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_group);

    let create = warp::path("groups")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_group);

    let update = warp::path!("groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_group);

    let delete = warp::path!("groups" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_group);

    list.or(get).or(create).or(update).or(delete)
}

pub(super) async fn list_groups(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config
            .groups
            .iter()
            .cloned()
            .map(|group| group_response_row(&snap.flattened_groups, group))
            .collect::<Vec<_>>(),
    ))
}

pub(super) async fn get_group(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .groups
        .iter()
        .find(|group| group.id == id)
        .cloned()
    {
        Some(group) => Ok(ApiResponse::success(group_response_row(
            &snap.flattened_groups,
            group,
        ))),
        None => Ok(not_found("Group")),
    }
}

#[derive(Deserialize)]
pub(super) struct GroupUpdate {
    #[serde(flatten)]
    group: GroupRow,
    #[serde(default)]
    expected: Option<GroupRow>,
}

pub(super) fn validate_group_change(groups: &[GroupRow], group: &GroupRow) -> Result<(), String> {
    if group.id.trim().is_empty() || group.name.trim().is_empty() {
        return Err("Give the room or group a name and an ID".into());
    }
    // Follow only the newly written row's outgoing paths. Existing missing
    // references remain editable; a cycle involving this row is never saved.
    let mut visited = std::collections::HashSet::new();
    let mut pending = group.linked_groups.clone();
    while let Some(id) = pending.pop() {
        if id == group.id {
            return Err("Linked rooms and groups would create a nesting loop".into());
        }
        if visited.insert(id.clone()) {
            if let Some(next) = groups.iter().find(|row| row.id == id) {
                pending.extend(next.linked_groups.iter().cloned());
            }
        }
    }
    Ok(())
}

pub(super) async fn create_group(
    group: GroupRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    write_group(group, None, true, handle).await
}

pub(super) async fn update_group(
    id: String,
    mut request: GroupUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    request.group.id = id;
    write_group(request.group, request.expected, false, handle).await
}

async fn write_group(
    group: GroupRow,
    expected: Option<GroupRow>,
    create: bool,
    handle: StateHandle,
) -> Result<warp::reply::WithStatus<warp::reply::Json>, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let next = group.clone();
    let outcome = handle.mutate(move |state| Box::pin(async move {
        let rows = &state.runtime_config.groups;
        let current = rows.iter().find(|row| row.id == next.id);
        if create && current.is_some() {
            return Err((StatusCode::CONFLICT, serde_json::json!({
                "success": false, "error": "This ID is already in use. Choose another ID."
            })));
        }
        if !create && current.is_none() {
            return Err((StatusCode::NOT_FOUND, serde_json::json!({
                "success": false, "error": "This room or group was deleted. Your draft has not been saved."
            })));
        }
        if let (Some(expected), Some(current)) = (expected.as_ref(), current) {
            if serde_json::to_value(expected).ok() != serde_json::to_value(current).ok() {
                return Err((StatusCode::CONFLICT, serde_json::json!({
                    "success": false, "error": "This room or group changed elsewhere.", "current": current
                })));
            }
        }
        if let Err(message) = validate_group_change(rows, &next) {
            return Err((StatusCode::BAD_REQUEST, serde_json::json!({ "success": false, "error": message })));
        }
        state.upsert_group(next);
        state.apply_runtime_groups();
        Ok(())
    })).await;
    match outcome {
        Err(_) => return Ok(actor_unavailable()),
        Ok(Err((status, body))) => {
            return Ok(warp::reply::with_status(warp::reply::json(&body), status))
        }
        Ok(Ok(())) => {}
    }
    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_group(&group).await;
    Ok(config_write_response(
        group,
        persistence,
        database_available,
        if create {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
    ))
}

pub(super) async fn delete_group(
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
                let deleted = state.delete_group(&id_for_state);
                if deleted {
                    state.apply_runtime_groups();
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
        return Ok(not_found("Group"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_group(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Scenes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: &str, links: &[&str]) -> GroupRow {
        GroupRow {
            id: id.into(),
            name: id.into(),
            hidden: false,
            devices: vec![],
            linked_groups: links.iter().map(|id| (*id).into()).collect(),
        }
    }
    #[test]
    fn validates_transitive_nesting_and_keeps_missing_references() {
        let rows = vec![row("a", &["b"]), row("b", &["c"]), row("c", &[])];
        assert!(validate_group_change(&rows, &row("c", &["a"])).is_err());
        assert!(validate_group_change(&rows, &row("a", &["a"])).is_err());
        assert!(validate_group_change(&rows, &row("a", &["b", "missing"])).is_ok());
    }
    #[tokio::test]
    async fn concurrent_edits_return_current_without_changing_state() {
        use crate::core::state::actor::spawn_state_actor;
        let (mut state, _events) = crate::core::event::tests::test_state();
        let original = row("room", &[]);
        state.upsert_group(original.clone());
        state.apply_runtime_groups();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot, tx);
        let mut latest = original.clone();
        latest.name = "Changed in another browser".into();
        let latest_for_actor = latest.clone();
        handle
            .mutate(move |state| {
                Box::pin(async move {
                    state.upsert_group(latest_for_actor);
                    state.apply_runtime_groups();
                })
            })
            .await
            .unwrap();
        let response = update_group(
            "room".into(),
            GroupUpdate {
                group: original.clone(),
                expected: Some(original.clone()),
            },
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = warp::hyper::body::to_bytes(response.into_body())
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["current"]["name"], latest.name);
        let duplicate = create_group(original, handle.clone())
            .await
            .unwrap()
            .into_response();
        assert_eq!(duplicate.status(), StatusCode::CONFLICT);
        let after = handle
            .mutate(|state| {
                Box::pin(async move {
                    state
                        .runtime_config
                        .groups
                        .iter()
                        .find(|row| row.id == "room")
                        .unwrap()
                        .name
                        .clone()
                })
            })
            .await
            .unwrap();
        assert_eq!(after, latest.name);
    }
}
