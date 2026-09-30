use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::hash::{BuildHasher, Hash};

static HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
    once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);
fn token(value: impl Hash) -> String {
    format!("{:016x}", HASHER.hash_one(value))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Image {
    None,
    Stored {
        revision: String,
        mime_type: Option<String>,
        bytes: usize,
    },
    Upload {
        mime_type: String,
        data_base64: String,
    },
}
#[derive(Clone, Serialize, Deserialize)]
struct View {
    id: String,
    name: String,
    grid_data: Option<String>,
    image: Image,
    revision_token: String,
}
#[derive(Deserialize)]
struct Write {
    name: String,
    grid_data: Option<String>,
    image: Image,
    expected: Option<String>,
    #[serde(default)]
    create_only: bool,
}
fn view(row: &FloorplanExportRow) -> View {
    View {
        id: row.id.clone(),
        name: row.name.clone(),
        grid_data: row.grid_data.clone(),
        image: match &row.image_data {
            Some(data) => Image::Stored {
                revision: token((data, &row.image_mime_type)),
                mime_type: row.image_mime_type.clone(),
                bytes: data.len(),
            },
            None => Image::None,
        },
        revision_token: token(serde_json::to_string(row).unwrap()),
    }
}
fn conflict(row: &FloorplanExportRow) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(
            &serde_json::json!({"success":false,"error":"This floorplan changed elsewhere. Review the latest version before saving.","current":view(row)}),
        ),
        StatusCode::CONFLICT,
    )
}
fn image_bytes(image: &Image) -> Result<Option<Vec<u8>>, String> {
    let Image::Upload {
        mime_type,
        data_base64,
    } = image
    else {
        return Ok(None);
    };
    if !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].contains(&mime_type.as_str()) {
        return Err("Choose a PNG, JPEG, WebP or SVG image.".into());
    }
    if data_base64.len() > 14 * 1024 * 1024 {
        return Err("The background image must be at most 10 MB.".into());
    }
    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|_| "The background image could not be decoded.".to_string())?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err("The background image must contain data and be at most 10 MB.".into());
    }
    let valid = match mime_type.as_str() {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "image/svg+xml" => std::str::from_utf8(&bytes).is_ok_and(|svg| svg.contains("<svg")),
        _ => false,
    };
    if !valid {
        return Err("The file does not match its image type.".into());
    }
    Ok(Some(bytes))
}
fn validate_grid(raw: &str) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(raw).map_err(|_| "The layout must contain valid JSON.".to_string())?;
    let width = value["width"]
        .as_u64()
        .filter(|n| (1..=1024).contains(n))
        .ok_or("Layout width must be a whole number from 1 to 1024.")?;
    let height = value["height"]
        .as_u64()
        .filter(|n| (1..=1024).contains(n))
        .ok_or("Layout height must be a whole number from 1 to 1024.")?;
    if width * height > 1_000_000 {
        return Err("The layout cannot contain more than one million tiles.".into());
    }
    if !value["tileSize"]
        .as_f64()
        .is_some_and(|v| v > 0.0 && v.is_finite())
    {
        return Err("Tile size must be positive.".into());
    }
    let tiles = value["tiles"]
        .as_array()
        .ok_or("Layout tiles must be a collection of rows.")?;
    if tiles.len() != height as usize
        || tiles.iter().any(|row| {
            row.as_array().is_none_or(|row| {
                row.len() != width as usize
                    || row.iter().any(|tile| {
                        !matches!(
                            tile.as_str(),
                            Some("empty" | "floor" | "wall" | "door" | "window")
                        )
                    })
            })
        })
    {
        return Err(
            "Layout tiles must match the canvas dimensions and use supported tile types.".into(),
        );
    }
    if let Some(devices) = value.get("devices") {
        let devices = devices
            .as_array()
            .ok_or("Device placements must be an array.")?;
        let mut keys = HashSet::new();
        for device in devices {
            if !device["deviceKey"]
                .as_str()
                .is_some_and(|key| !key.trim().is_empty() && keys.insert(key))
                || device["deviceName"].as_str().is_none()
                || !device["x"]
                    .as_f64()
                    .is_some_and(|v| v >= 0.0 && v < width as f64)
                || !device["y"]
                    .as_f64()
                    .is_some_and(|v| v >= 0.0 && v < height as f64)
            {
                return Err(
                    "Device placements need unique keys, names and positions inside the canvas."
                        .into(),
                );
            }
        }
    }
    if let Some(groups) = value.get("groups") {
        for points in groups
            .as_object()
            .ok_or("Room masks must be an object.")?
            .values()
        {
            for point in points
                .as_array()
                .ok_or("Each room mask must be a collection of points.")?
            {
                if !point["x"].as_u64().is_some_and(|x| x < width)
                    || !point["y"].as_u64().is_some_and(|y| y < height)
                {
                    return Err(
                        "Room mask points must be whole tile coordinates inside the canvas.".into(),
                    );
                }
            }
        }
    }
    if let Some(scale) = value.get("deviceScale") {
        if !scale.as_f64().is_some_and(|v| v > 0.0 && v.is_finite()) {
            return Err("Device scale must be positive.".into());
        }
    }
    if let Some(mode) = value.get("labelMode") {
        if !matches!(mode.as_str(), Some("none" | "sensors" | "lights" | "all")) {
            return Err("This layout uses an unsupported label mode.".into());
        }
    }
    if let Some(labels) = value.get("labelVisibility") {
        if !labels.is_object()
            || ["lights", "sensors", "groups"]
                .iter()
                .any(|key| !labels[*key].is_boolean())
        {
            return Err(
                "Label visibility must specify lights, sensors and groups as on/off values.".into(),
            );
        }
    }
    Ok(())
}
pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path!("floorplans" / String / "editor")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|id: String, snapshot: SnapshotHandle| {
            let id = percent_decode_str(&id).decode_utf8_lossy();
            match get_runtime_floorplan(&snapshot.load().runtime_config, &id) {
                Some(row) => ApiResponse::success(view(&row)),
                None => not_found("Floorplan"),
            }
        });
    let put = warp::path!("floorplans" / String / "editor")
        .and(warp::put())
        .and(warp::body::content_length_limit(32 * 1024 * 1024))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(save);
    let delete = warp::path!("floorplans" / String / "editor")
        .and(warp::delete())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(remove);
    get.or(put).or(delete)
}
async fn save(
    id: String,
    request: Write,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let id = percent_decode_str(&id).decode_utf8_lossy().into_owned();
    if id.trim().is_empty() || id.len() > 128 || request.name.trim().is_empty() {
        return Ok(error_response(
            "Give the floorplan a name and an ID of at most 128 characters.",
            StatusCode::BAD_REQUEST,
        ));
    }
    let bytes = match image_bytes(&request.image) {
        Ok(bytes) => bytes,
        Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    };
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let current = get_runtime_floorplan(&state.runtime_config, &id);
                if request.create_only && current.is_some() {
                    return Err(error_response(
                        "This floorplan ID is already in use.",
                        StatusCode::CONFLICT,
                    ));
                }
                if !request.create_only && current.is_none() {
                    return Err(not_found("Floorplan"));
                }
                if let Some(row) = &current {
                    if request.expected.as_deref() != Some(&view(row).revision_token) {
                        return Err(conflict(row));
                    }
                } else if request.expected.is_some() {
                    return Err(not_found("Floorplan"));
                }
                // Preserve an existing unknown/legacy grid during metadata-only edits.
                // Replacing the grid always validates its full structure.
                if current.as_ref().and_then(|r| r.grid_data.as_ref()) != request.grid_data.as_ref()
                {
                    if let Some(raw) = &request.grid_data {
                        if let Err(error) = validate_grid(raw) {
                            return Err(error_response(&error, StatusCode::BAD_REQUEST));
                        }
                    }
                }
                let mut next = current.unwrap_or(FloorplanExportRow {
                    id: id.clone(),
                    name: request.name.clone(),
                    image_data: None,
                    image_mime_type: None,
                    width: None,
                    height: None,
                    grid_data: None,
                });
                next.name = request.name;
                next.grid_data = request.grid_data;
                match request.image {
                    Image::None => {
                        next.image_data = None;
                        next.image_mime_type = None;
                        next.width = None;
                        next.height = None;
                    }
                    Image::Upload { mime_type, .. } => {
                        next.image_data = bytes;
                        next.image_mime_type = Some(mime_type);
                        next.width = None;
                        next.height = None;
                    }
                    Image::Stored { .. } => {}
                }
                let response = view(&next);
                let order = state.set_floorplan_editor_config(next.clone());
                let available = db::is_db_connected();
                let persistence =
                    config_queries::db_upsert_floorplan_export(&next, order as i32).await;
                Ok(config_write_response(
                    response,
                    persistence,
                    available,
                    if request.create_only {
                        StatusCode::CREATED
                    } else {
                        StatusCode::OK
                    },
                ))
            })
        })
        .await;
    Ok(match result {
        Ok(Ok(response)) | Ok(Err(response)) => response,
        Err(_) => actor_unavailable(),
    })
}

#[derive(Deserialize)]
struct Delete {
    expected: String,
}
async fn remove(
    id: String,
    request: Delete,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let id = percent_decode_str(&id).decode_utf8_lossy().into_owned();
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result = handle
        .mutate(move |state| {
            Box::pin(async move {
                let Some(current) = get_runtime_floorplan(&state.runtime_config, &id) else {
                    return not_found("Floorplan");
                };
                if view(&current).revision_token != request.expected {
                    return conflict(&current);
                }
                state.delete_floorplan(&id);
                let available = db::is_db_connected();
                let persistence = config_queries::db_delete_floorplan(&id).await.map(|_| ());
                config_write_response((), persistence, available, StatusCode::OK)
            })
        })
        .await;
    Ok(result.unwrap_or_else(|_| actor_unavailable()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn grid() -> String {
        json!({"width":2,"height":2,"tileSize":20,"tiles":[["wall","window"],["floor","door"]],"devices":[],"groups":{},"labelMode":"all","labelVisibility":{"lights":true,"sensors":false,"groups":true},"future":{"keep":[2,1]}}).to_string()
    }
    #[tokio::test]
    async fn floorplan_editor_saves_one_scope_preserves_unknown_grid_and_checks_image_conflicts() {
        let (state, _events) = crate::core::event::tests::test_state();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        handle.mutate(|_| Box::pin(async {})).await.unwrap();
        let routes = routes(&snapshot, &handle);
        let path = "/floorplans/upstairs/editor";
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"></svg>";
        let mut request = json!({"name":"Upstairs","grid_data":grid(),"image":{"kind":"upload","mime_type":"image/svg+xml","data_base64":STANDARD.encode(svg)},"create_only":true});
        let response = warp::test::request()
            .method("PUT")
            .path(path)
            .json(&request)
            .reply(&routes)
            .await;
        assert_eq!(
            response.status(),
            StatusCode::CREATED,
            "{:?}",
            response.body()
        );
        let created: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(created["write"]["persistence"], "memory_only");
        assert!(!created.to_string().contains("data_base64"));
        assert_eq!(created["data"]["grid_data"], grid());
        let duplicate = warp::test::request()
            .method("PUT")
            .path(path)
            .json(&request)
            .reply(&routes)
            .await;
        assert_eq!(duplicate.status(), StatusCode::CONFLICT);
        request["create_only"] = json!(false);
        request["expected"] = created["data"]["revision_token"].clone();
        request["image"] = created["data"]["image"].clone();
        request["name"] = json!("Upper floor");
        let response = warp::test::request()
            .method("PUT")
            .path(path)
            .json(&request)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let renamed: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(renamed["data"]["image"], created["data"]["image"]);
        let row = get_runtime_floorplan(&snapshot.load().runtime_config, "upstairs").unwrap();
        assert_eq!(row.image_data.as_deref(), Some(svg.as_slice()));
        assert_eq!(row.grid_data.as_deref(), Some(grid().as_str()));
        request["image"] = json!({"kind":"none"});
        let response = warp::test::request()
            .method("PUT")
            .path(path)
            .json(&request)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        request["expected"] = renamed["data"]["revision_token"].clone();
        request["grid_data"] = json!("{\"width\":-3}");
        let response = warp::test::request()
            .method("PUT")
            .path(path)
            .json(&request)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(
            get_runtime_floorplan(&snapshot.load().runtime_config, "upstairs")
                .unwrap()
                .image_data
                .is_some(),
            "Invalid grids cannot partly apply image removal"
        );
        request["grid_data"] = json!(grid());
        let response = warp::test::request()
            .method("PUT")
            .path(path)
            .json(&request)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let removed: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(removed["data"]["image"]["kind"], "none");
        let response = warp::test::request()
            .method("DELETE")
            .path(path)
            .json(&json!({"expected":renamed["data"]["revision_token"]}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let response = warp::test::request()
            .method("DELETE")
            .path(path)
            .json(&json!({"expected":removed["data"]["revision_token"]}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            list_runtime_floorplans(&snapshot.load().runtime_config).is_empty(),
            "Deleting the last floorplan must not invent an empty default"
        );
    }
    #[test]
    fn floorplan_editor_validates_placement_without_dropping_extensions() {
        assert!(validate_grid(&grid()).is_ok());
        let mut value: Value = serde_json::from_str(&grid()).unwrap();
        value["labelVisibility"] = json!({"lights":false,"sensors":true,"groups":true});
        assert!(validate_grid(&value.to_string()).is_ok());
        value["labelVisibility"]["groups"] = json!("yes");
        assert!(validate_grid(&value.to_string()).is_err());
        value.as_object_mut().unwrap().remove("labelVisibility");
        assert!(
            validate_grid(&value.to_string()).is_ok(),
            "Older layouts need no label visibility field"
        );
        value["devices"] =
            json!([{"deviceKey":"dummy/lamp","deviceName":"Lamp","x":1,"y":0,"future":42}]);
        assert!(validate_grid(&value.to_string()).is_ok());
        value["devices"][0]["x"] = json!(2);
        assert!(validate_grid(&value.to_string()).is_err());
        value["devices"] = json!([]);
        value["groups"] = json!({"room":[{"x":0.5,"y":1}]});
        assert!(validate_grid(&value.to_string()).is_err());
        value["groups"] = json!({});
        value["tiles"][0][0] = json!("unknown");
        assert!(validate_grid(&value.to_string()).is_err());
        assert!(image_bytes(&Image::Upload {
            mime_type: "image/png".into(),
            data_base64: STANDARD.encode(b"not an image")
        })
        .is_err());
    }
}
