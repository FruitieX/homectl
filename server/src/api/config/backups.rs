//! Read-only restore review. Only identities and changed field names leave this
//! endpoint; uploaded or stored credential values never appear in a preview.
use super::*;
use serde_json::{json, Value};
use std::hash::{BuildHasher, Hash, Hasher};

static REVIEW_HASHER: once_cell::sync::Lazy<std::collections::hash_map::RandomState> =
    once_cell::sync::Lazy::new(std::collections::hash_map::RandomState::new);

// Every collection in ConfigExport belongs to the replacement scope. Keeping
// this inventory explicit also makes new export fields fail review until their
// import semantics have been considered.
const COLLECTIONS: &[(&str, &str, &str)] = &[
    ("integrations", "Connections", "id"),
    ("groups", "Rooms & groups", "id"),
    ("scenes", "Scenes", "id"),
    ("routines", "Routines", "id"),
    ("helpers", "Helpers", "id"),
    ("helper_values", "Saved helper values", "id"),
    ("sources", "Computed sources", "id"),
    ("floorplans", "Floorplans", "id"),
    ("group_positions", "Room positions", "group_id"),
    ("device_display_overrides", "Device names", "device_key"),
    (
        "device_color_calibrations",
        "Device calibrations",
        "device_key",
    ),
    ("color_calibration_profiles", "Calibration profiles", "id"),
    (
        "color_calibration_assignments",
        "Calibration assignments",
        "device_key",
    ),
    ("device_sensor_configs", "Device controls", "device_ref"),
    ("widget_settings", "Shared settings & widget sources", "key"),
    ("dashboard_layouts", "Dashboards", "id"),
    ("dashboard_widgets", "Dashboard widgets", "id"),
];

pub(super) fn parse(raw: Value) -> Result<ConfigExport, String> {
    let object = raw
        .as_object()
        .ok_or("Choose a homectl JSON backup containing an object.")?;
    for key in object.keys() {
        if !["version", "core", "floorplan", "scenario_suite"].contains(&key.as_str())
            && !COLLECTIONS.iter().any(|(field, _, _)| field == key)
        {
            return Err(format!("This backup contains an unsupported section ({key}). Use a server version that supports it."));
        }
    }
    let config: ConfigExport = serde_json::from_value(raw)
        .map_err(|error| format!("The file does not match the homectl backup format: {error}"))?;
    if config.version != 1 {
        return Err(format!(
            "Unsupported backup version {}. This server supports version 1.",
            config.version
        ));
    }
    validate(&config)?;
    Ok(config)
}

fn validate(config: &ConfigExport) -> Result<(), String> {
    let value = serde_json::to_value(config).map_err(|error| error.to_string())?;
    for (field, label, key) in COLLECTIONS {
        let mut ids = HashSet::new();
        for row in value[field].as_array().into_iter().flatten() {
            let id = row
                .get(key)
                .ok_or_else(|| format!("{label}: an entry has no {key}."))?;
            if id.is_null()
                || id.as_str().is_some_and(|id| id.trim().is_empty())
                || !ids.insert(id.to_string())
            {
                return Err(format!(
                    "{label}: entries must have unique, nonempty identifiers."
                ));
            }
        }
    }
    if config.core.warmup_time_seconds < 0 {
        return Err("Warmup time cannot be negative.".into());
    }
    for row in &config.groups {
        groups::validate_group_change(&config.groups, row)?;
        for link in &row.linked_groups {
            if !config.groups.iter().any(|group| group.id == *link) {
                return Err(format!(
                    "Room/group '{}' links to '{}' which is absent from the backup.",
                    row.id, link
                ));
            }
        }
    }
    for row in &config.helpers {
        row.validate()?;
    }
    for row in &config.helper_values {
        let helper = config
            .helpers
            .iter()
            .find(|h| h.id.as_str() == row.id)
            .ok_or_else(|| format!("Saved helper value '{}' has no definition.", row.id))?;
        if helper.persistence != crate::types::automation_value::HelperPersistence::Durable {
            return Err(format!(
                "Helper '{}' is not durable and cannot restore a saved value.",
                row.id
            ));
        }
        helper.kind.validate_value(&row.value)?;
    }
    for row in &config.sources {
        sources::validate_source(row)?;
    }
    config.validate_calibration_profiles()?;
    for row in &config.device_color_calibrations {
        row.validate()?;
    }
    for row in &config.widget_settings {
        crate::types::device_health::ReportingPolicy::validate_setting(&row.key, &row.config)?;
        if row.key == SENSOR_CATALOG_SETTING_KEY {
            let catalog: SensorCatalog = serde_json::from_value(row.config.clone())
                .map_err(|e| format!("Invalid sensor catalog: {e}"))?;
            validate_sensor_catalog(&catalog)?;
        }
    }
    if config
        .dashboard_layouts
        .iter()
        .filter(|row| row.is_default)
        .count()
        > 1
    {
        return Err("Only one dashboard can be the default.".into());
    }
    for row in &config.dashboard_layouts {
        if row.id <= 0 {
            return Err("Dashboard IDs in a backup must be positive.".into());
        }
    }
    for row in &config.dashboard_widgets {
        if row.id <= 0
            || !config
                .dashboard_layouts
                .iter()
                .any(|layout| layout.id == row.layout_id)
        {
            return Err(
                "Each widget must have a positive ID and a dashboard included in the backup."
                    .into(),
            );
        }
        if !row.grid_w.is_finite()
            || !row.grid_h.is_finite()
            || row.grid_w <= 0.0
            || row.grid_w > 8.0
            || row.grid_h <= 0.0
            || row.grid_h > 64.0
            || row.grid_x < 0
            || row.grid_y < 0
            || row.sort_order < 0
        {
            return Err(format!(
                "Widget {} has invalid dimensions or placement.",
                row.id
            ));
        }
    }
    if let Some(suite) = &config.scenario_suite {
        let suite: ScenarioSuite = serde_json::from_value(suite.clone())
            .map_err(|e| format!("Invalid scenario suite: {e}"))?;
        if suite.version != 1 || suite.scenarios.is_empty() {
            return Err(
                "Scenario suite must use version 1 and contain at least one scenario.".into(),
            );
        }
    }
    Ok(())
}

pub(super) fn review_token(current: &ConfigExport, candidate: &ConfigExport) -> String {
    let mut hasher = REVIEW_HASHER.build_hasher();
    serde_json::to_value(current)
        .unwrap()
        .to_string()
        .hash(&mut hasher);
    serde_json::to_value(candidate)
        .unwrap()
        .to_string()
        .hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn identity(row: &Value, key: &str) -> String {
    row[key]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| row[key].to_string())
}
fn changed_fields(before: &Value, after: &Value) -> Vec<String> {
    let mut keys = std::collections::BTreeSet::new();
    for value in [before, after] {
        if let Some(object) = value.as_object() {
            keys.extend(object.keys().cloned());
        }
    }
    keys.into_iter()
        .filter(|key| before.get(key) != after.get(key))
        .collect()
}
fn collection_review(field: &str, label: &str, key: &str, before: &Value, after: &Value) -> Value {
    let empty = vec![];
    let before = before.as_array().unwrap_or(&empty);
    let after = after.as_array().unwrap_or(&empty);
    let previous: BTreeMap<_, _> = before.iter().map(|row| (identity(row, key), row)).collect();
    let next: BTreeMap<_, _> = after.iter().map(|row| (identity(row, key), row)).collect();
    let mut changes = Vec::new();
    let mut unchanged = 0;
    for (id, row) in &next {
        let old = previous.get(id);
        let moved = field == "floorplans"
            && old.is_some()
            && before.iter().position(|r| identity(r, key) == *id)
                != after.iter().position(|r| identity(r, key) == *id);
        if old.is_some_and(|old| *old == *row) && !moved {
            unchanged += 1;
            continue;
        }
        let mut fields = old.map(|old| changed_fields(old, row)).unwrap_or_default();
        if moved {
            fields.push("order".into());
        }
        changes.push(json!({"id":id,"name":row.get("name").or_else(|| row.get("display_name")).and_then(Value::as_str).unwrap_or(id),"action":if old.is_some(){"update"}else{"add"},"fields":fields}));
    }
    for (id, row) in &previous {
        if !next.contains_key(id) {
            changes.push(json!({"id":id,"name":row.get("name").and_then(Value::as_str).unwrap_or(id),"action":"remove","fields":[]}));
        }
    }
    json!({"key":field,"label":label,"before":before.len(),"after":after.len(),"unchanged":unchanged,"changes":changes})
}
pub(super) fn review(current: &ConfigExport, candidate: &ConfigExport) -> Value {
    let comparable = |config: &ConfigExport| {
        let mut value = serde_json::to_value(config).unwrap();
        if config.floorplans.is_empty() && config.floorplan.is_some() {
            value["floorplans"] = json!([legacy_default_floorplan(config).unwrap()]);
        }
        value
    };
    let before = comparable(current);
    let after = comparable(candidate);
    let mut sections: Vec<Value> = COLLECTIONS
        .iter()
        .map(|(field, label, key)| {
            collection_review(field, label, key, &before[field], &after[field])
        })
        .collect();
    for (field, label) in [
        ("core", "System behavior"),
        ("scenario_suite", "Scenario tests"),
    ] {
        let rows = |value: &Value| {
            if value[field].is_null() {
                json!([])
            } else {
                json!([{"id":field,"name":label,"value":value[field]}])
            }
        };
        sections.push(collection_review(
            field,
            label,
            "id",
            &rows(&before),
            &rows(&after),
        ));
    }
    let destructive = sections.iter().any(|section| {
        section["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["action"] != "add")
    });
    let legacy = candidate
        .routines
        .iter()
        .filter(|row| automation::row_semantics(row) == RoutineSemantics::V1)
        .count();
    json!({"revision_token":review_token(current,candidate),"sections":sections,"destructive":destructive,
        "legacy_routines":legacy,"warnings":["Restore replaces the saved setup, including sections missing from an older backup. Pending routine timers are canceled.","Credentials omitted for matching entries are kept. New connections or widget sources may need credentials after restore."]})
}

pub(super) async fn preview(
    raw: Value,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let mut candidate = match parse(raw) {
        Ok(value) => value,
        Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    };
    let snap = snapshot.load();
    preserve_omitted_widget_secrets(&mut candidate, &snap.runtime_config);
    let catalog = ConfigCatalog::new(snap.devices.0.keys().cloned(), &candidate);
    if let Err(error) = validate_routine_catalog(&candidate, &catalog) {
        return Ok(error_response(&error.to_string(), StatusCode::BAD_REQUEST));
    }
    Ok(ApiResponse::success(review(
        &snap.runtime_config,
        &candidate,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn backup_review_is_read_only_secret_safe_and_rejects_stale_restore() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        state.runtime_config.groups = serde_json::from_value(json!([
            {"id":"keep","name":"Kitchen","hidden":false,"devices":[],"linked_groups":[]},
            {"id":"remove","name":"Old room","hidden":false,"devices":[],"linked_groups":[]}
        ]))
        .unwrap();
        state
            .runtime_config
            .widget_settings
            .push(config_queries::WidgetSettingRow {
                key: CALENDAR_SETTING_KEY.into(),
                config: json!({ICS_URL_FIELD:"private-calendar-token"}),
            });
        let original = state.runtime_config.clone();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = crate::core::state::actor::spawn_state_actor(state, snapshot.clone(), tx);
        // Publish the initialized test state before reading its snapshot.
        handle.mutate(|_| Box::pin(async {})).await.unwrap();
        let routes = export_import_routes(&snapshot, &handle);
        let mut candidate = original.clone();
        candidate.groups.remove(1);
        candidate.groups[0].name = "New kitchen".into();
        redact_widget_secrets(&mut candidate);
        let response = warp::test::request()
            .method("POST")
            .path("/import/preview")
            .json(&candidate)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let result: Value = serde_json::from_slice(response.body()).unwrap();
        assert!(!result.to_string().contains("private-calendar-token"));
        let groups = result["data"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .find(|section| section["key"] == "groups")
            .unwrap();
        assert_eq!(groups["changes"][0]["action"], "update");
        assert_eq!(groups["changes"][1]["action"], "remove");
        assert_eq!(result["data"]["destructive"], true);
        assert_eq!(
            serde_json::to_value(&*snapshot.load().runtime_config).unwrap(),
            serde_json::to_value(&original).unwrap(),
            "Review must not apply the uploaded backup"
        );
        let token = result["data"]["revision_token"].as_str().unwrap();
        handle
            .mutate(|state| {
                Box::pin(async move {
                    state
                        .runtime_config
                        .widget_settings
                        .iter_mut()
                        .find(|row| row.key == CALENDAR_SETTING_KEY)
                        .unwrap()
                        .config[ICS_URL_FIELD] = json!("changed-secret");
                })
            })
            .await
            .unwrap();
        let response = warp::test::request()
            .method("POST")
            .path(&format!("/import?expected={token}"))
            .json(&candidate)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(!String::from_utf8_lossy(response.body()).contains("changed-secret"));
        assert_eq!(snapshot.load().runtime_config.groups.len(), 2);
        let response = warp::test::request()
            .method("POST")
            .path("/import/preview")
            .json(&candidate)
            .reply(&routes)
            .await;
        let next: Value = serde_json::from_slice(response.body()).unwrap();
        assert_ne!(next["data"]["revision_token"], token);
        // The same token also binds the exact backup, so a different payload
        // cannot be applied under an earlier review of this runtime baseline.
        candidate.core.warmup_time_seconds += 1;
        let response = warp::test::request()
            .method("POST")
            .path(&format!(
                "/import?expected={}",
                next["data"]["revision_token"].as_str().unwrap()
            ))
            .json(&candidate)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let response = warp::test::request()
            .method("POST")
            .path("/import/preview")
            .json(&candidate)
            .reply(&routes)
            .await;
        let reviewed: Value = serde_json::from_slice(response.body()).unwrap();
        let response = warp::test::request()
            .method("POST")
            .path(&format!(
                "/import?expected={}",
                reviewed["data"]["revision_token"].as_str().unwrap()
            ))
            .json(&candidate)
            .reply(&routes)
            .await;
        assert_eq!(response.status(), StatusCode::OK, "{:?}", response.body());
        let applied: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(applied["write"]["applied"], true);
        assert_eq!(applied["write"]["persistence"], "memory_only");
        assert_eq!(snapshot.load().runtime_config.groups.len(), 1);
        assert_eq!(snapshot.load().runtime_config.groups[0].name, "New kitchen");
        assert_eq!(
            snapshot
                .load()
                .runtime_config
                .widget_settings
                .iter()
                .find(|row| row.key == CALENDAR_SETTING_KEY)
                .unwrap()
                .config[ICS_URL_FIELD],
            "changed-secret"
        );
        assert!(!String::from_utf8_lossy(response.body()).contains("changed-secret"));
    }

    #[test]
    fn backup_review_rejects_unsupported_sections_versions_duplicates_and_broken_links() {
        let (state, _events) = crate::core::event::tests::test_state();
        let original = serde_json::to_value(&state.runtime_config).unwrap();
        let mut raw = original.clone();
        raw["version"] = json!(99);
        assert!(parse(raw)
            .unwrap_err()
            .contains("Unsupported backup version"));
        let mut raw = original.clone();
        raw["future_section"] = json!({});
        assert!(parse(raw).unwrap_err().contains("unsupported section"));
        let mut raw = original.clone();
        raw["groups"] = json!([
            {"id":"same","name":"One","hidden":false,"devices":[],"linked_groups":[]},
            {"id":"same","name":"Two","hidden":false,"devices":[],"linked_groups":[]}
        ]);
        assert!(parse(raw).unwrap_err().contains("unique"));
        let mut raw = original;
        raw["groups"] = json!([{ "id":"room","name":"Room","hidden":false,"devices":[],"linked_groups":["missing"] }]);
        assert!(parse(raw).unwrap_err().contains("absent from the backup"));
    }
}
