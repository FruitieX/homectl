//! REST API endpoints for configuration management
//!
//! Provides CRUD endpoints for:
//! - Integrations: GET/POST/PUT/DELETE /api/v1/config/integrations
//! - Groups: GET/POST/PUT/DELETE /api/v1/config/groups
//! - Scenes: GET/POST/PUT/DELETE /api/v1/config/scenes
//! - Routines: GET/POST/PUT/DELETE /api/v1/config/routines
//! - Import/Export: GET/POST /api/v1/config/export, /api/v1/config/import

use std::sync::Arc;

use crate::core::state::AppState;
use crate::db::config_queries::{
    self, ConfigExport, DashboardLayoutRow, DashboardWidgetRow, DevicePositionRow, FloorplanRow,
    GroupRow, IntegrationRow, RoutineRow, SceneRow,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use warp::{http::StatusCode, Filter, Reply};

use super::with_state;

// ============================================================================
// Response Types
// ============================================================================

#[derive(Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> warp::reply::WithStatus<warp::reply::Json> {
        warp::reply::with_status(
            warp::reply::json(&ApiResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
            StatusCode::OK,
        )
    }

    fn created(data: T) -> warp::reply::WithStatus<warp::reply::Json> {
        warp::reply::with_status(
            warp::reply::json(&ApiResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
            StatusCode::CREATED,
        )
    }
}

fn error_response(msg: &str, status: StatusCode) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(&ApiResponse::<()> {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        }),
        status,
    )
}

fn not_found(entity: &str) -> warp::reply::WithStatus<warp::reply::Json> {
    error_response(&format!("{entity} not found"), StatusCode::NOT_FOUND)
}

fn internal_error(e: impl std::fmt::Display) -> warp::reply::WithStatus<warp::reply::Json> {
    error_response(&e.to_string(), StatusCode::INTERNAL_SERVER_ERROR)
}

// ============================================================================
// Main Config Routes
// ============================================================================

pub fn config(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("config").and(
        integrations_routes(app_state)
            .or(groups_routes(app_state))
            .or(scenes_routes(app_state))
            .or(routines_routes(app_state))
            .or(floorplan_routes(app_state))
            .or(dashboard_routes(app_state))
            .or(export_import_routes(app_state)),
    )
}

// ============================================================================
// Integrations
// ============================================================================

fn integrations_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_integrations);

    let get = warp::path!("integrations" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_integration);

    let create = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_integration);

    let update = warp::path!("integrations" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_integration);

    let delete = warp::path!("integrations" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_integration);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_integrations(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_integrations().await {
        Ok(integrations) => Ok(ApiResponse::success(integrations)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_integration(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_integration(&id).await {
        Ok(Some(integration)) => Ok(ApiResponse::success(integration)),
        Ok(None) => Ok(not_found("Integration")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_integration(
    integration: IntegrationRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_integration(&integration).await {
        Ok(()) => {
            // Trigger hot-reload
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_integrations().await {
                warn!("Failed to hot-reload integrations: {e}");
            }
            Ok(ApiResponse::created(integration))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_integration(
    id: String,
    mut integration: IntegrationRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    integration.id = id;
    match config_queries::db_upsert_integration(&integration).await {
        Ok(()) => {
            // Trigger hot-reload
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_integrations().await {
                warn!("Failed to hot-reload integrations: {e}");
            }
            Ok(ApiResponse::success(integration))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_integration(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_integration(&id).await {
        Ok(true) => {
            // Trigger hot-reload
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_integrations().await {
                warn!("Failed to hot-reload integrations: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Integration")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Groups
// ============================================================================

fn groups_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("groups")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_groups);

    let get = warp::path!("groups" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_group);

    let create = warp::path("groups")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_group);

    let update = warp::path!("groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_group);

    let delete = warp::path!("groups" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_group);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_groups(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_groups().await {
        Ok(groups) => Ok(ApiResponse::success(groups)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_group(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_group(&id).await {
        Ok(Some(group)) => Ok(ApiResponse::success(group)),
        Ok(None) => Ok(not_found("Group")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_group(
    group: GroupRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_group(&group).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_groups().await {
                warn!("Failed to hot-reload groups: {e}");
            }
            Ok(ApiResponse::created(group))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_group(
    id: String,
    mut group: GroupRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    group.id = id;
    match config_queries::db_upsert_group(&group).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_groups().await {
                warn!("Failed to hot-reload groups: {e}");
            }
            Ok(ApiResponse::success(group))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_group(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_group(&id).await {
        Ok(true) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_groups().await {
                warn!("Failed to hot-reload groups: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Group")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Scenes
// ============================================================================

fn scenes_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_scenes);

    let get = warp::path!("scenes" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_scene);

    let create = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_scene);

    let update = warp::path!("scenes" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_scene);

    let delete = warp::path!("scenes" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_scene);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_scenes(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_config_scenes().await {
        Ok(scenes) => Ok(ApiResponse::success(scenes)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_scene(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_config_scene(&id).await {
        Ok(Some(scene)) => Ok(ApiResponse::success(scene)),
        Ok(None) => Ok(not_found("Scene")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_scene(
    scene: SceneRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_config_scene(&scene).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_scenes().await {
                warn!("Failed to hot-reload scenes: {e}");
            }
            Ok(ApiResponse::created(scene))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_scene(
    id: String,
    mut scene: SceneRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    scene.id = id;
    match config_queries::db_upsert_config_scene(&scene).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_scenes().await {
                warn!("Failed to hot-reload scenes: {e}");
            }
            Ok(ApiResponse::success(scene))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_scene(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_config_scene(&id).await {
        Ok(true) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_scenes().await {
                warn!("Failed to hot-reload scenes: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Scene")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Routines
// ============================================================================

fn routines_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("routines")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_routines);

    let get = warp::path!("routines" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_routine);

    let create = warp::path("routines")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_routine);

    let update = warp::path!("routines" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_routine);

    let delete = warp::path!("routines" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_routine);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_routines(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_routines().await {
        Ok(routines) => Ok(ApiResponse::success(routines)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_routine(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_routine(&id).await {
        Ok(Some(routine)) => Ok(ApiResponse::success(routine)),
        Ok(None) => Ok(not_found("Routine")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_routine(
    routine: RoutineRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_routine(&routine).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_routines().await {
                warn!("Failed to hot-reload routines: {e}");
            }
            Ok(ApiResponse::created(routine))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_routine(
    id: String,
    mut routine: RoutineRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    routine.id = id;
    match config_queries::db_upsert_routine(&routine).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_routines().await {
                warn!("Failed to hot-reload routines: {e}");
            }
            Ok(ApiResponse::success(routine))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_routine(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_routine(&id).await {
        Ok(true) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_routines().await {
                warn!("Failed to hot-reload routines: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Routine")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Floorplan
// ============================================================================

fn floorplan_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_floorplan);

    let upload_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::bytes())
        .and(warp::header::optional::<String>("content-type"))
        .and(with_state(app_state))
        .and_then(upload_floorplan);

    let get_positions = warp::path!("floorplan" / "devices")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_device_positions);

    let upsert_position = warp::path!("floorplan" / "devices" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_position);

    let delete_position = warp::path!("floorplan" / "devices" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_position);

    get_floorplan
        .or(upload_floorplan)
        .or(get_positions)
        .or(upsert_position)
        .or(delete_position)
}

async fn get_floorplan(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_floorplan().await {
        Ok(Some(floorplan)) => Ok(ApiResponse::success(floorplan)),
        Ok(None) => Ok(not_found("Floorplan")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upload_floorplan(
    body: bytes::Bytes,
    content_type: Option<String>,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    // TODO: Get width/height from image metadata
    let floorplan = FloorplanRow {
        image_data: Some(body.to_vec()),
        image_mime_type: content_type,
        width: None,
        height: None,
    };

    match config_queries::db_upsert_floorplan(&floorplan).await {
        Ok(()) => Ok(ApiResponse::success(())),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_device_positions(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_device_positions().await {
        Ok(positions) => Ok(ApiResponse::success(positions)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_device_position(
    device_key: String,
    mut pos: DevicePositionRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    pos.device_key = device_key;
    match config_queries::db_upsert_device_position(&pos).await {
        Ok(()) => Ok(ApiResponse::success(pos)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_device_position(
    device_key: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_device_position(&device_key).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Device position")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Dashboard
// ============================================================================

fn dashboard_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_layouts = warp::path!("dashboard" / "layouts")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_dashboard_layouts);

    let upsert_layout = warp::path!("dashboard" / "layouts")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_dashboard_layout);

    let delete_layout = warp::path!("dashboard" / "layouts" / i32)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_dashboard_layout);

    let get_widgets = warp::path!("dashboard" / "layouts" / i32 / "widgets")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_dashboard_widgets);

    let upsert_widget = warp::path!("dashboard" / "widgets")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_dashboard_widget);

    let delete_widget = warp::path!("dashboard" / "widgets" / i32)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_dashboard_widget);

    get_layouts
        .or(upsert_layout)
        .or(delete_layout)
        .or(get_widgets)
        .or(upsert_widget)
        .or(delete_widget)
}

async fn get_dashboard_layouts(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_dashboard_layouts().await {
        Ok(layouts) => Ok(ApiResponse::success(layouts)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_dashboard_layout(
    layout: DashboardLayoutRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_dashboard_layout(&layout).await {
        Ok(id) => Ok(ApiResponse::success(DashboardLayoutRow {
            id,
            name: layout.name,
            is_default: layout.is_default,
        })),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_dashboard_layout(
    id: i32,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_dashboard_layout(id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Dashboard layout")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_dashboard_widgets(
    layout_id: i32,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_dashboard_widgets(layout_id).await {
        Ok(widgets) => Ok(ApiResponse::success(widgets)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_dashboard_widget(
    widget: DashboardWidgetRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_dashboard_widget(&widget).await {
        Ok(id) => Ok(ApiResponse::success(DashboardWidgetRow { id, ..widget })),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_dashboard_widget(
    id: i32,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_dashboard_widget(id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Dashboard widget")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Export / Import
// ============================================================================

#[derive(Deserialize)]
struct ImportQuery {
    #[serde(default)]
    save_version: bool,
}

fn export_import_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let export = warp::path("export")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(export_config);

    let import = warp::path("import")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::query::<ImportQuery>())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(import_config);

    export.or(import)
}

async fn export_config(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_export_config().await {
        Ok(config) => Ok(ApiResponse::success(config)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn import_config(
    query: ImportQuery,
    config: ConfigExport,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    // Optionally save version before import
    if query.save_version {
        if let Err(e) = config_queries::db_save_config_version(&config, Some("Before import")).await
        {
            warn!("Failed to save config version before import: {e}");
        }
    }

    match config_queries::db_import_config(&config).await {
        Ok(()) => {
            // Hot-reload all config
            let mut state = app_state.write().await;
            let _ = state.reload_integrations().await;
            let _ = state.reload_groups().await;
            let _ = state.reload_scenes().await;
            let _ = state.reload_routines().await;
            Ok(ApiResponse::success(()))
        }
        Err(e) => Ok(internal_error(e)),
    }
}
