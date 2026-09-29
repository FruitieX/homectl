//! Shared dashboard data sources; widget selections remain on each widget.
use super::*;
use serde_json::{json, Value};
use std::hash::{BuildHasher, Hash, Hasher};

fn fields(key: &str) -> Option<&'static [(&'static str, &'static str)]> {
    match key {
        WEATHER_SETTING_KEY => Some(&[(API_URL_FIELD, "WEATHER_API_URL")]),
        TRAIN_SCHEDULE_SETTING_KEY => Some(&[(API_URL_FIELD, "TRAIN_API_URL")]),
        INFLUXDB_SETTING_KEY => Some(&[(URL_FIELD, "INFLUX_URL"), (TOKEN_FIELD, "INFLUX_TOKEN")]),
        CALENDAR_SETTING_KEY => Some(&[(ICS_URL_FIELD, "GOOGLE_CALENDAR_ICS_URL")]),
        _ => None,
    }
}

fn view(key: &str, settings: &[config_queries::WidgetSettingRow]) -> Value {
    static HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
        once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);
    let mut config = serde_json::Map::new();
    let mut credentials = serde_json::Map::new();
    let mut origins = serde_json::Map::new();
    let mut hasher = HASHER.build_hasher();
    key.hash(&mut hasher);
    let stored = settings.iter().find(|row| row.key == key);
    stored.map(|row| row.config.to_string()).hash(&mut hasher);
    for (field, env) in fields(key).into_iter().flatten() {
        let value = widget_setting_string_or_env(settings, key, field, env).unwrap_or_default();
        value.hash(&mut hasher);
        origins.insert(
            (*field).into(),
            json!(
                if stored.is_some_and(|row| row.config.get(field).is_some()) {
                    "saved"
                } else if !value.is_empty() {
                    "environment"
                } else {
                    "unset"
                }
            ),
        );
        if secret_widget_field(key) == Some(*field) {
            credentials.insert((*field).into(), json!(!value.is_empty()));
        } else {
            config.insert((*field).into(), json!(value));
        }
    }
    json!({"key":key,"config":config,"credentials":credentials,"origins":origins,
        "invalidStoredConfig":stored.is_some_and(|row| !row.config.is_object() || fields(key).unwrap().iter().any(|(field, _)| row.config.get(field).is_some_and(|value| !value.is_string()))),
        "revisionToken":format!("{:016x}",hasher.finish())})
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceWrite {
    config: BTreeMap<String, String>,
    expected: String,
}

pub(super) fn routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path!("widget-sources")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            let snap = snapshot.load();
            ApiResponse::success(
                [
                    WEATHER_SETTING_KEY,
                    TRAIN_SCHEDULE_SETTING_KEY,
                    INFLUXDB_SETTING_KEY,
                    CALENDAR_SETTING_KEY,
                ]
                .map(|key| view(key, &snap.runtime_config.widget_settings)),
            )
        });
    let put = warp::path!("widget-sources" / String)
        .and(warp::put())
        .and(warp::body::content_length_limit(65536))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update);
    get.or(put)
}

async fn update(
    key: String,
    request: SourceWrite,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let Some(known_fields) = fields(&key) else {
        return Ok(warp::reply::with_status(
            warp::reply::json(&json!({"success":false,"error":"Unknown widget source."})),
            StatusCode::NOT_FOUND,
        ));
    };
    for (field, value) in &request.config {
        if !known_fields.iter().any(|(known, _)| known == field) {
            return Ok(warp::reply::with_status(
                warp::reply::json(&json!({"success":false,"error":"Unknown source field."})),
                StatusCode::BAD_REQUEST,
            ));
        }
        if field != TOKEN_FIELD
            && !value.trim().is_empty()
            && !reqwest::Url::parse(value.trim()).is_ok_and(|url| {
                matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
            })
        {
            return Ok(warp::reply::with_status(
                warp::reply::json(
                    &json!({"success":false,"error":"Source URLs must use HTTP or HTTPS."}),
                ),
                StatusCode::BAD_REQUEST,
            ));
        }
    }
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let outcome = handle.mutate(move |state| Box::pin(async move {
        let current = view(&key, &state.runtime_config.widget_settings);
        if current["revisionToken"].as_str() != Some(&request.expected) {
            return Err((StatusCode::CONFLICT, "This source changed elsewhere.", current));
        }
        let mut setting = state.runtime_config.widget_settings.iter().find(|row| row.key == key).cloned()
            .unwrap_or(config_queries::WidgetSettingRow {key:key.clone(),config:json!({})});
        let Some(config) = setting.config.as_object_mut() else {
            return Err((StatusCode::BAD_REQUEST,"Stored source settings are not an object. Repair the configuration before saving.", current));
        };
        for (field,value) in request.config {
            let value = if field == TOKEN_FIELD { value } else { value.trim().to_owned() };
            config.insert(field,json!(value));
        }
        state.upsert_widget_setting(setting.clone());
        Ok((view(&key,&state.runtime_config.widget_settings),setting))
    })).await;
    let (value, setting) = match outcome {
        Err(_) => return Ok(actor_unavailable()),
        Ok(Err((status, error, current))) => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&json!({"success":false,"error":error,"current":current})),
                status,
            ))
        }
        Ok(Ok(value)) => value,
    };
    let available = db::is_db_connected();
    let persistence = config_queries::db_upsert_widget_setting(&setting).await;
    Ok(config_write_response(
        value,
        persistence,
        available,
        StatusCode::OK,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn widget_source_updates_are_scoped_preserve_secrets_and_detect_secret_conflicts() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        state.upsert_widget_setting(config_queries::WidgetSettingRow {
            key: INFLUXDB_SETTING_KEY.into(),
            config: json!({"url":"http://old.example","token":"original-secret","future":[1,2]}),
        });
        state.upsert_widget_setting(config_queries::WidgetSettingRow {
            key: CALENDAR_SETTING_KEY.into(),
            config: json!({"icsUrl":"https://calendar.example/private-secret"}),
        });
        let original = view(INFLUXDB_SETTING_KEY, &state.runtime_config.widget_settings);
        assert_eq!(original["credentials"]["token"], true);
        assert!(!original.to_string().contains("original-secret"));
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        let routes = routes(&snapshot, &handle);
        let response = warp::test::request()
            .path("/widget-sources")
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let public = String::from_utf8_lossy(response.body());
        assert!(!public.contains("private-secret"));
        assert!(!public.contains("original-secret"));
        let response = warp::test::request().method("PUT").path("/widget-sources/influxdb")
            .json(&json!({"config":{"url":"http://new.example"},"expected":original["revisionToken"]})).reply(&routes).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = serde_json::from_slice(response.body()).unwrap();
        assert!(!body.to_string().contains("original-secret"));
        let setting = snapshot
            .load()
            .runtime_config
            .widget_settings
            .iter()
            .find(|row| row.key == INFLUXDB_SETTING_KEY)
            .unwrap()
            .clone();
        assert_eq!(setting.config["token"], "original-secret");
        assert_eq!(setting.config["future"], json!([1, 2]));
        let response = warp::test::request().method("PUT").path("/widget-sources/influxdb")
            .json(&json!({"config":{"token":"replacement-secret"},"expected":body["data"]["revisionToken"]})).reply(&routes).await;
        assert_eq!(response.status(), StatusCode::OK);
        let response = warp::test::request().method("PUT").path("/widget-sources/influxdb")
            .json(&json!({"config":{"url":"http://stale.example"},"expected":body["data"]["revisionToken"]})).reply(&routes).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(!String::from_utf8_lossy(response.body()).contains("replacement-secret"));
        let latest = view(
            INFLUXDB_SETTING_KEY,
            &snapshot.load().runtime_config.widget_settings,
        );
        let response = warp::test::request()
            .method("PUT")
            .path("/widget-sources/influxdb")
            .json(&json!({"config":{"token":""},"expected":latest["revisionToken"]}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        let latest = view(
            INFLUXDB_SETTING_KEY,
            &snapshot.load().runtime_config.widget_settings,
        );
        assert_eq!(latest["credentials"]["token"], false);
        let response = warp::test::request()
            .method("PUT")
            .path("/widget-sources/influxdb")
            .json(&json!({"config":{"url":"file:///secret"},"expected":latest["revisionToken"]}))
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            view(
                INFLUXDB_SETTING_KEY,
                &snapshot.load().runtime_config.widget_settings
            ),
            latest
        );
    }
}
