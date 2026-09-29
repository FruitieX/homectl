use super::*;
use serde_json::{json, Value};
use std::hash::BuildHasher;

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn dashboard_arrangement_batches_geometry_and_explicit_removal_with_preconditions() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        state.upsert_dashboard_layout(DashboardLayoutRow {
            id: 1,
            name: "Home".into(),
            is_default: true,
        });
        for id in 1..=3 {
            state.upsert_dashboard_widget(DashboardWidgetRow {
                id,
                layout_id: 1,
                widget_type: "sensors".into(),
                config: json!({"options":{"influxToken":"keep-secret","future":["a","b"]}}),
                grid_x: 0,
                grid_y: 0,
                grid_w: 2.0,
                grid_h: 2.0,
                sort_order: id,
            });
        }
        let original = arrangement(1, &state.runtime_config.dashboard_widgets);
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        let routes = routes(&snapshot, &handle);
        let mut value = original.clone();
        value.placements.get_mut("1").unwrap().grid_w = 3.25;
        value.placements.get_mut("2").unwrap().sort_order = 0;
        value.removed_ids = vec![3];
        let mut invalid = value.clone();
        invalid.placements.get_mut("2").unwrap().grid_h = -1.0;
        let response = warp::test::request()
            .method("PUT")
            .path("/dashboard/layouts/1/arrangement")
            .json(&json!({"value":invalid,"expected":original}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(arrangement(1, &snapshot.load().runtime_config.dashboard_widgets) == original);
        let mut omission = value.clone();
        omission.placements.remove("3");
        omission.removed_ids.clear();
        let response = warp::test::request()
            .method("PUT")
            .path("/dashboard/layouts/1/arrangement")
            .json(&json!({"value":omission,"expected":original}))
            .reply(&routes)
            .await;
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "omitted widgets are never silently removed"
        );
        let response = warp::test::request()
            .method("PUT")
            .path("/dashboard/layouts/1/arrangement")
            .json(&json!({"value":value,"expected":original}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let snap = snapshot.load();
        assert_eq!(snap.runtime_config.dashboard_widgets.len(), 2);
        let first = snap
            .runtime_config
            .dashboard_widgets
            .iter()
            .find(|row| row.id == 1)
            .unwrap();
        assert_eq!(first.grid_w, 3.25);
        assert_eq!(first.config["options"]["influxToken"], "keep-secret");
        assert!(!String::from_utf8_lossy(response.body()).contains("keep-secret"));
        let response = warp::test::request()
            .method("PUT")
            .path("/dashboard/layouts/1/arrangement")
            .json(&json!({"value":value,"expected":original}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
    #[tokio::test]
    async fn dashboard_edits_preserve_credentials_extensions_and_reject_stale_writes() {
        let (state, _events) = crate::core::event::tests::test_state();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        let routes = routes(&snapshot, &handle);
        let response = warp::test::request()
            .method("POST")
            .path("/dashboard/layouts")
            .json(&json!({"id":0,"name":"Test layout","is_default":true}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = serde_json::from_slice(response.body()).unwrap();
        assert!(body.get("write").is_some());
        let layout_id = body["data"]["id"].as_i64().unwrap();
        assert_eq!(
            snapshot.load().runtime_config.dashboard_layouts[0].id,
            layout_id as i32
        );
        let response=warp::test::request().method("POST").path("/dashboard/widgets").json(&json!({"id":0,"layout_id":layout_id,"widget_type":"sensors","config":{"title":"Readings","options":{"influxToken":"private-token","future":["b","a"],"sensorSelection":"selected","sensorIds":[]}},"grid_x":0,"grid_y":0,"grid_w":2.25,"grid_h":1.5,"sort_order":0})).reply(&routes).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = serde_json::from_slice(response.body()).unwrap();
        assert!(!body.to_string().contains("private-token"));
        assert_eq!(body["data"]["secret_fields"], json!(["influxToken"]));
        let mut update = body["data"].clone();
        update["expected"] = update["revision_token"].clone();
        update["config"]["title"] = json!("New title");
        let response = warp::test::request()
            .method("POST")
            .path("/dashboard/widgets")
            .json(&update)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let saved = snapshot.load().runtime_config.dashboard_widgets[0].clone();
        assert_eq!(options(&saved)["influxToken"], "private-token");
        assert_eq!(options(&saved)["future"], json!(["b", "a"]));
        assert_eq!(options(&saved)["sensorIds"], json!([]));
        let response = warp::test::request()
            .method("POST")
            .path("/dashboard/widgets")
            .json(&update)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(!String::from_utf8_lossy(response.body()).contains("private-token"));
        let mut export = snapshot.load().runtime_config.as_ref().clone();
        let original = export.clone();
        redact_widget_secrets(&mut export);
        assert!(options(&export.dashboard_widgets[0])
            .get("influxToken")
            .is_none());
        preserve_omitted_widget_secrets(&mut export, &original);
        assert_eq!(
            options(&export.dashboard_widgets[0])["influxToken"],
            "private-token"
        );
        let mut clear = public_widget(&saved);
        clear["expected"] = clear["revision_token"].clone();
        clear["config"]["options"]["influxToken"] = json!("");
        let response = warp::test::request()
            .method("POST")
            .path("/dashboard/widgets")
            .json(&clear)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            options(&snapshot.load().runtime_config.dashboard_widgets[0])["influxToken"],
            ""
        );
        let widget_id = saved.id;
        assert!(crate::api::widgets::saved_widget_options(&snapshot, widget_id, "clock").is_err());
        assert_eq!(
            crate::api::widgets::saved_widget_options(&snapshot, widget_id, "sensors").unwrap()
                ["future"],
            json!(["b", "a"])
        );
        let widget_routes = crate::api::widgets::widgets(snapshot.clone());
        let response = warp::test::request()
            .path(&format!(
                "/api/influxdb/temp-sensors?widget_id={widget_id}&url=http://other.example"
            ))
            .reply(&widget_routes)
            .await;
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "saved tokens cannot be sent to a caller-selected URL"
        );
        let response = warp::test::request()
            .method("DELETE")
            .path(&format!("/dashboard/layouts/{layout_id}"))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(snapshot.load().runtime_config.dashboard_widgets.is_empty());
    }
}

pub(crate) fn options(widget: &DashboardWidgetRow) -> &Value {
    widget
        .config
        .get("options")
        .filter(|value| value.is_object())
        .unwrap_or(&widget.config)
}
pub(crate) fn secret_fields(kind: &str) -> &'static [&'static str] {
    match kind {
        "sensors" => &["influxToken"],
        "clock" => &["calendarUrl"],
        _ => &[],
    }
}
fn token<T: Serialize>(value: &T) -> String {
    static HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
        once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);
    format!(
        "{:016x}",
        HASHER.hash_one(serde_json::to_string(value).unwrap())
    )
}
pub(super) fn redact(widget: &mut DashboardWidgetRow) {
    let fields = secret_fields(&widget.widget_type);
    // Remove both representations, including obsolete root values in mixed exports.
    for field in fields {
        if let Some(config) = widget.config.as_object_mut() {
            config.remove(*field);
        }
        if let Some(options) = widget
            .config
            .get_mut("options")
            .and_then(Value::as_object_mut)
        {
            options.remove(*field);
        }
    }
}
pub(super) fn preserve_omitted_secrets(
    widget: &mut DashboardWidgetRow,
    current: &DashboardWidgetRow,
) {
    if widget.widget_type != current.widget_type {
        return;
    }
    for field in secret_fields(&widget.widget_type) {
        if options(widget).get(field).is_none() {
            if let Some(value) = options(current).get(field).cloned() {
                if widget.config.get("options").is_some_and(Value::is_object) {
                    widget.config["options"][*field] = value;
                } else if widget.config.is_object() {
                    widget.config[*field] = value;
                }
            }
        }
    }
}
fn public_widget(widget: &DashboardWidgetRow) -> Value {
    let fields = secret_fields(&widget.widget_type)
        .iter()
        .filter(|field| {
            options(widget)
                .get(**field)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
        })
        .copied()
        .collect::<Vec<_>>();
    let mut clean = widget.clone();
    redact(&mut clean);
    let mut value = serde_json::to_value(clean).unwrap();
    value["secret_fields"] = json!(fields);
    value["revision_token"] = json!(token(widget));
    value
}
fn public_layout(layout: &DashboardLayoutRow) -> Value {
    let mut value = serde_json::to_value(layout).unwrap();
    value["revision_token"] = json!(token(layout));
    value
}
#[derive(Deserialize)]
struct LayoutWrite {
    #[serde(flatten)]
    value: DashboardLayoutRow,
    expected: Option<String>,
}
#[derive(Deserialize)]
struct WidgetWrite {
    #[serde(flatten)]
    value: DashboardWidgetRow,
    expected: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
struct Placement {
    grid_x: i32,
    grid_y: i32,
    grid_w: f32,
    grid_h: f32,
    sort_order: i32,
    revision_token: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
struct Arrangement {
    layout_id: i32,
    placements: BTreeMap<String, Placement>,
    #[serde(default)]
    removed_ids: Vec<i32>,
}
fn arrangement(layout_id: i32, widgets: &[DashboardWidgetRow]) -> Arrangement {
    Arrangement {
        layout_id,
        removed_ids: vec![],
        placements: widgets
            .iter()
            .filter(|row| row.layout_id == layout_id)
            .map(|row| {
                (
                    row.id.to_string(),
                    Placement {
                        grid_x: row.grid_x,
                        grid_y: row.grid_y,
                        grid_w: row.grid_w,
                        grid_h: row.grid_h,
                        sort_order: row.sort_order,
                        revision_token: token(row),
                    },
                )
            })
            .collect(),
    }
}
#[derive(Deserialize)]
struct ArrangementWrite {
    value: Arrangement,
    expected: Arrangement,
}
async fn save_arrangement(
    id: i32,
    request: ArrangementWrite,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result=handle.mutate(move |state|Box::pin(async move {
        if !state.runtime_config.dashboard_layouts.iter().any(|row|row.id==id) {return Err(failure(StatusCode::NOT_FOUND,"The dashboard layout was removed.",None));}
        let current=arrangement(id,&state.runtime_config.dashboard_widgets);
        if current!=request.expected {return Err(failure(StatusCode::CONFLICT,"Widgets in this layout changed. Review the saved arrangement.",Some(serde_json::to_value(current).unwrap())));}
        let value=request.value;
        let removed:HashSet<i32>=value.removed_ids.iter().copied().collect();
        if value.layout_id!=id || value.placements.keys().ne(current.placements.keys()) || removed.len()!=value.removed_ids.len() || removed.iter().any(|id| !current.placements.contains_key(&id.to_string())) {
            return Err(failure(StatusCode::BAD_REQUEST,"The arrangement must include every current widget, with removals listed explicitly.",None));
        }
        for placement in value.placements.values() {
            if !placement.grid_w.is_finite() || !placement.grid_h.is_finite() || placement.grid_w<=0.0 || placement.grid_w>8.0 || placement.grid_h<=0.0 || placement.grid_h>64.0 || placement.grid_x<0 || placement.grid_y<0 || placement.sort_order<0 {
                return Err(failure(StatusCode::BAD_REQUEST,"Widget dimensions and positions are invalid.",None));
            }
        }
        let widgets=state.runtime_config.dashboard_widgets.iter().filter(|row|row.layout_id==id && !removed.contains(&row.id)).map(|row| {
            let placement=&value.placements[&row.id.to_string()];
            DashboardWidgetRow {grid_x:placement.grid_x,grid_y:placement.grid_y,grid_w:placement.grid_w,grid_h:placement.grid_h,sort_order:placement.sort_order,..row.clone()}
        }).collect::<Vec<_>>();
        let available=db::is_db_connected();
        let persistence=config_queries::db_save_dashboard_arrangement(id,&widgets,&value.removed_ids).await;
        // A connected database failure leaves both runtime and database intact.
        // Memory-only operation retains the application's normal explicit warning.
        if available && persistence.is_err() {return Err(failure(StatusCode::INTERNAL_SERVER_ERROR,"The arrangement was not applied because its database transaction failed. Your draft is kept.",None));}
        for id in value.removed_ids {state.delete_dashboard_widget(id);}
        for widget in widgets {state.upsert_dashboard_widget(widget);}
        Ok((arrangement(id,&state.runtime_config.dashboard_widgets),persistence,available))
    })).await;
    match result {
        Ok(Ok((value, persistence, available))) => Ok(config_write_response(
            value,
            persistence,
            available,
            StatusCode::OK,
        )),
        Ok(Err(reply)) => Ok(reply),
        Err(_) => Ok(actor_unavailable()),
    }
}
fn failure(
    status: StatusCode,
    message: &str,
    current: Option<Value>,
) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(&json!({"success":false,"error":message,"current":current})),
        status,
    )
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_layouts = warp::path!("dashboard" / "layouts")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_dashboard_layouts);

    let upsert_layout = warp::path!("dashboard" / "layouts")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_dashboard_layout);

    let delete_layout = warp::path!("dashboard" / "layouts" / i32)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_dashboard_layout);

    let get_widgets = warp::path!("dashboard" / "layouts" / i32 / "widgets")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_dashboard_widgets);

    let upsert_widget = warp::path!("dashboard" / "widgets")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_dashboard_widget);

    let upsert_widget_legacy = warp::path!("dashboard")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(upsert_dashboard_widget);

    let delete_widget = warp::path!("dashboard" / "widgets" / i32)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_dashboard_widget);

    let get_arrangement = warp::path!("dashboard" / "layouts" / i32 / "arrangement")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|id: i32, snapshot: SnapshotHandle| {
            ApiResponse::success(arrangement(
                id,
                &snapshot.load().runtime_config.dashboard_widgets,
            ))
        });
    let put_arrangement = warp::path!("dashboard" / "layouts" / i32 / "arrangement")
        .and(warp::put())
        .and(warp::body::content_length_limit(1024 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(save_arrangement);

    get_layouts
        .or(upsert_layout)
        .or(delete_layout)
        .or(get_widgets)
        .or(upsert_widget)
        .or(upsert_widget_legacy)
        .or(delete_widget)
        .or(get_arrangement)
        .or(put_arrangement)
}

async fn get_dashboard_layouts(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config
            .dashboard_layouts
            .iter()
            .map(public_layout)
            .collect::<Vec<_>>(),
    ))
}

async fn upsert_dashboard_layout(
    request: LayoutWrite,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(value) => value,
        Err(_) => return Ok(actor_unavailable()),
    };
    if request.value.name.trim().is_empty() {
        return Ok(failure(
            StatusCode::BAD_REQUEST,
            "Enter a layout name.",
            None,
        ));
    }
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let current = state
                    .runtime_config
                    .dashboard_layouts
                    .iter()
                    .find(|row| row.id == request.value.id);
                if request
                    .expected
                    .as_ref()
                    .is_some_and(|expected| current.is_none_or(|row| token(row) != *expected))
                {
                    return Err(failure(
                        StatusCode::CONFLICT,
                        "This layout changed or was deleted.",
                        current.map(public_layout),
                    ));
                }
                if request.value.id > 0 && current.is_none() {
                    return Err(failure(StatusCode::NOT_FOUND, "Layout not found.", None));
                }
                Ok(state.upsert_dashboard_layout(request.value))
            })
        })
        .await;
    let layout = match result {
        Ok(Ok(value)) => value,
        Ok(Err(reply)) => return Ok(reply),
        Err(_) => return Ok(actor_unavailable()),
    };
    let available = db::is_db_connected();
    let persistence = config_queries::db_upsert_dashboard_layout(&layout).await;
    Ok(config_write_response(
        public_layout(&layout),
        persistence,
        available,
        StatusCode::OK,
    ))
}

async fn delete_dashboard_layout(
    id: i32,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(value) => value,
        Err(_) => return Ok(actor_unavailable()),
    };
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.delete_dashboard_layout(id) }))
        .await
        .unwrap_or(false);

    if !deleted {
        return Ok(failure(
            StatusCode::NOT_FOUND,
            "Dashboard layout not found.",
            None,
        ));
    }

    let available = db::is_db_connected();
    let persistence = config_queries::db_delete_dashboard_layout(id).await;
    Ok(config_write_response(
        (),
        persistence,
        available,
        StatusCode::OK,
    ))
}

async fn get_dashboard_widgets(
    layout_id: i32,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config
            .dashboard_widgets
            .iter()
            .filter(|widget| widget.layout_id == layout_id)
            .map(public_widget)
            .collect::<Vec<_>>(),
    ))
}

async fn upsert_dashboard_widget(
    mut request: WidgetWrite,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(value) => value,
        Err(_) => return Ok(actor_unavailable()),
    };
    let widget = &request.value;
    if !widget.config.is_object()
        || widget
            .config
            .get("options")
            .is_some_and(|value| !value.is_object())
    {
        return Ok(failure(
            StatusCode::BAD_REQUEST,
            "Widget configuration and options must be objects.",
            None,
        ));
    }
    if !widget.grid_w.is_finite()
        || !widget.grid_h.is_finite()
        || widget.grid_w <= 0.0
        || widget.grid_w > 8.0
        || widget.grid_h <= 0.0
        || widget.grid_h > 64.0
        || widget.grid_x < 0
        || widget.grid_y < 0
    {
        return Ok(failure(
            StatusCode::BAD_REQUEST,
            "Use a positive widget width up to 8, height up to 64, and nonnegative positions.",
            None,
        ));
    }
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let current = state
                    .runtime_config
                    .dashboard_widgets
                    .iter()
                    .find(|row| row.id == request.value.id);
                if request
                    .expected
                    .as_ref()
                    .is_some_and(|expected| current.is_none_or(|row| token(row) != *expected))
                {
                    return Err(failure(
                        StatusCode::CONFLICT,
                        "This widget changed or was deleted.",
                        current.map(public_widget),
                    ));
                }
                if request.value.id > 0 && current.is_none() {
                    return Err(failure(StatusCode::NOT_FOUND, "Widget not found.", None));
                }
                if !state
                    .runtime_config
                    .dashboard_layouts
                    .iter()
                    .any(|row| row.id == request.value.layout_id)
                {
                    return Err(failure(
                        StatusCode::BAD_REQUEST,
                        "Choose an existing layout.",
                        None,
                    ));
                }
                if let Some(current) = current {
                    preserve_omitted_secrets(&mut request.value, current);
                }
                Ok(state.upsert_dashboard_widget(request.value))
            })
        })
        .await;
    let widget = match result {
        Ok(Ok(value)) => value,
        Ok(Err(reply)) => return Ok(reply),
        Err(_) => return Ok(actor_unavailable()),
    };
    let available = db::is_db_connected();
    let persistence = config_queries::db_upsert_dashboard_widget(&widget).await;
    Ok(config_write_response(
        public_widget(&widget),
        persistence,
        available,
        StatusCode::OK,
    ))
}

async fn delete_dashboard_widget(
    id: i32,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(value) => value,
        Err(_) => return Ok(actor_unavailable()),
    };
    let deleted = handle
        .mutate(move |state| Box::pin(async move { state.delete_dashboard_widget(id) }))
        .await
        .unwrap_or(false);

    if !deleted {
        return Ok(failure(
            StatusCode::NOT_FOUND,
            "Dashboard widget not found.",
            None,
        ));
    }

    let available = db::is_db_connected();
    let persistence = config_queries::db_delete_dashboard_widget(id).await;
    Ok(config_write_response(
        (),
        persistence,
        available,
        StatusCode::OK,
    ))
}
