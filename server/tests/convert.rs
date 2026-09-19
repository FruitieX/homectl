//! Integration coverage for the offline v1 -> v2 converter runner: report,
//! archive, transactional apply, and archive restore.

use homectl_server::core::convert;
use homectl_server::db::{self, config_queries::RoutineRow};
use serde_json::json;

use std::time::{SystemTime, UNIX_EPOCH};

fn convertible_row() -> RoutineRow {
    RoutineRow {
        id: "pulse_button".to_string(),
        name: "Pulse Button".to_string(),
        enabled: true,
        semantics_version: 1,
        revision: 1,
        definition_v2: None,
        rules: json!([
            {"integration_id": "dummy", "device_id": "button", "state": {"value": true}}
        ]),
        actions: json!([{"action": "ActivateScene", "scene_id": "night"}]),
    }
}

fn manual_row() -> RoutineRow {
    RoutineRow {
        id: "level_lamp".to_string(),
        name: "Level Lamp".to_string(),
        enabled: true,
        semantics_version: 1,
        revision: 1,
        definition_v2: None,
        rules: json!([{"integration_id": "dummy", "device_id": "lamp", "power": true}]),
        actions: json!([{"action": "ActivateScene", "scene_id": "night"}]),
    }
}

#[tokio::test]
async fn conversion_applies_convertible_rows_and_archive_restores_them() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_convert_test_{}_{}",
        std::process::id(),
        unique
    ));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let database_url = format!("sqlite://{}", temp_dir.join("convert.db").display());

    db::init_db(Some(&database_url))
        .await
        .expect("initialize test database");

    db::config_queries::db_upsert_routine(&convertible_row())
        .await
        .expect("store v1 routine");
    db::config_queries::db_upsert_routine(&manual_row())
        .await
        .expect("store level-only v1 routine");

    let mut export = db::config_queries::db_export_config()
        .await
        .expect("export config");
    export
        .scenes
        .push(homectl_server::db::config_queries::SceneRow {
            id: "night".to_string(),
            name: "Night".to_string(),
            hidden: false,
            script: None,
            device_states: Default::default(),
            group_states: Default::default(),
            group_state_order: Vec::new(),
        });
    let report = convert::build_report("test-db", &export);

    assert_eq!(report.total, 2);
    assert_eq!(report.converted, 1);
    assert_eq!(report.needs_manual, 1);
    assert_eq!(report.unsupported, 0);
    assert_eq!(report.already_v2, 0);
    assert!(!report.is_clean());

    let text = convert::render_report(&report);
    assert!(text.contains("converted (triggers: report dummy/button"));
    assert!(text.contains("level-only routine"));

    let rows = convert::converted_rows(&report, &export).expect("converted rows");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "pulse_button");
    assert_eq!(rows[0].semantics_version, 2);
    assert_eq!(rows[0].revision, 2);
    assert!(rows[0].definition_v2.is_some());
    assert_eq!(rows[0].rules, convertible_row().rules);

    let archive_path = temp_dir.join("archive.json");
    convert::write_archive(&archive_path, "test-db", &export, &report).expect("write archive");
    assert!(archive_path.exists());

    convert::apply_rows(&rows).await.expect("apply conversion");

    let after = db::config_queries::db_export_config()
        .await
        .expect("export after apply");
    let converted = after
        .routines
        .iter()
        .find(|row| row.id == "pulse_button")
        .expect("converted row present");
    assert_eq!(converted.semantics_version, 2);
    assert_eq!(converted.revision, 2);
    assert!(converted.definition_v2.is_some());
    let manual = after
        .routines
        .iter()
        .find(|row| row.id == "level_lamp")
        .expect("manual row present");
    assert_eq!(manual.semantics_version, 1);
    assert!(manual.definition_v2.is_none());

    let archived = convert::read_archive(&archive_path).expect("read archive");
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].id, "pulse_button");
    assert_eq!(archived[0].semantics_version, 1);

    convert::apply_rows(&archived)
        .await
        .expect("restore archive");

    let restored = db::config_queries::db_export_config()
        .await
        .expect("export after restore");
    let restored_row = restored
        .routines
        .iter()
        .find(|row| row.id == "pulse_button")
        .expect("restored row present");
    assert_eq!(restored_row.semantics_version, 1);
    assert!(restored_row.definition_v2.is_none());
    assert_eq!(restored_row.rules, convertible_row().rules);

    std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
}
