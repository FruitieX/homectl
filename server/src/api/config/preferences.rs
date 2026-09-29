use super::*;

pub(crate) const SETTINGS_UI_KEY: &str = "settings_ui";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct SettingsPreferences {
    #[serde(default = "default_true")]
    pub show_advanced_details: bool,
    // Preserve fields written by a newer client during rolling upgrades.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}
impl Default for SettingsPreferences {
    fn default() -> Self {
        Self {
            show_advanced_details: true,
            extra: BTreeMap::new(),
        }
    }
}
fn read_preferences(settings: &[config_queries::WidgetSettingRow]) -> SettingsPreferences {
    settings
        .iter()
        .find(|row| row.key == SETTINGS_UI_KEY)
        .and_then(|row| serde_json::from_value(row.config.clone()).ok())
        .unwrap_or_default()
}
#[derive(Deserialize)]
struct PreferencesUpdate {
    #[serde(flatten)]
    value: SettingsPreferences,
    expected: Option<SettingsPreferences>,
}
pub(super) fn preferences_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path!("preferences")
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .map(|snapshot: SnapshotHandle| {
            ApiResponse::success(read_preferences(
                &snapshot.load().runtime_config.widget_settings,
            ))
        });
    let put = warp::path!("preferences")
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_preferences);
    get.or(put)
}
async fn update_preferences(
    request: PreferencesUpdate,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    let setting = config_queries::WidgetSettingRow {
        key: SETTINGS_UI_KEY.into(),
        config: serde_json::to_value(&request.value).unwrap(),
    };
    let for_actor = setting.clone();
    let outcome = handle
        .mutate(move |state| {
            Box::pin(async move {
                let current = read_preferences(&state.runtime_config.widget_settings);
                if request.expected.is_some_and(|expected| expected != current) {
                    return Err(current);
                }
                state.upsert_widget_setting(for_actor);
                Ok(request.value)
            })
        })
        .await;
    let value = match outcome {
        Err(_) => return Ok(actor_unavailable()),
        Ok(Err(current)) => {
            return Ok(warp::reply::with_status(
                warp::reply::json(
                    &serde_json::json!({ "success": false, "error": "Preferences changed elsewhere.", "current": current }),
                ),
                StatusCode::CONFLICT,
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
    #[test]
    fn older_exports_have_useful_defaults_and_unknown_fields_survive() {
        assert!(read_preferences(&[]).show_advanced_details);
        let value =
            serde_json::json!({ "show_advanced_details": false, "future": { "mode": "example" } });
        let parsed: SettingsPreferences = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        let request: PreferencesUpdate = serde_json::from_value(serde_json::json!({ "show_advanced_details": false, "expected": { "show_advanced_details": true } })).unwrap();
        assert!(!request.value.extra.contains_key("expected"));
    }
}
