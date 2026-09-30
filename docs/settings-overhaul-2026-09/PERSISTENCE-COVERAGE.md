# Configuration persistence evidence

Updated 2026-09-30. Complements [FIELD-COVERAGE.md](FIELD-COVERAGE.md): browser
fixtures establish authoring/serialization behavior; the tests below exercise real
SQLite queries and migrations. They do not command household devices.

## Current database checkpoint

Command: `nix develop -c cargo test --manifest-path server/Cargo.toml --lib db::config_queries::consistency_tests`

Result: **17 passed, 0 failed**. Exact output:
[database consistency log](implementation-evidence/collections/group-database-tests.log).
Test implementations are in `server/src/db/config_queries.rs`.

| Stored contract | Exact test | Scope proved |
| --- | --- | --- |
| Group memberships and raw scene/routine definitions | `raw_automation_definitions_survive_database_reopen_and_json_restore` | File-backed close/reopen and JSON restore preserve empty/single/multiple groups, hidden true/false, ordered device/group memberships and unresolved references; scene target maps/order, links/scopes, script text, false/zero/null/omitted values and opaque extension data; native branches, mixed and whole scripts, stable node IDs, routine revision/version and unknown action payloads. Legacy rows retain default v1/revision 1 with no v2 body; old scenes default to empty ordering. Storage accepts raw definitions independently of compiler/resolver validity; this is not runtime acceptance of unknown actions or missing references. |
| Computed sources | `computed_source_fields_survive_database_reopen_and_json_restore` | Closes a file-backed database, reopens it, exports JSON and imports into a second database. Preserves built-in/custom/pinned computation representations, revision, enabled state, Helsinki zone, 1001 ms refresh, ordered aliases, zero versus omitted brightness, script body and structured parameters including null/false/empty text. Older exports omitting `sources` deserialize empty and replace old source rows. This is storage coverage, not evaluation of the supplied scripts/preset parameters. |
| Sensors, timers, floorplans and everyday widgets | `everyday_collections_survive_database_reopen_and_json_restore` | Same close/reopen/JSON restore path. Preserves sensor list, group list and member order; disabled sensors and extension data; all three user-timer modes, device/group/scene targets, icons and Helsinki date/repeat settings; multiple floorplans, image bytes/metadata, absent images and grid JSON; stable dashboard IDs, fractional dimensions/order and room/scene/climate/timer options. This does not assert image decoding, live timer execution or widget rendering. |
| Helper definitions and values | `helper_definitions_and_durable_values_round_trip` | All four types, numeric bounds, false/zero/empty initial values, ordered enum options and hidden true/false/omitted fields. Durable current value/revision exports; session values do not. Missing helper collections default empty. |
| Shared advanced preference | `shared_settings_preferences_database_export_import_round_trip` | The reserved `settings_ui` row preserves false and unknown preference fields; an empty database has no invented preference row. |
| Reporting policies | `reporting_policy_database_export_import_round_trip_and_validation` | Integration custom interval, device Ignore/Inherit, legacy missing settings and rejection of invalid policies. |
| Device metadata and sensor configuration | `device_settings_save_is_atomic_and_preserves_sensor_payload` | Name/sensor/reporting changes roll back together on an injected database failure; nested sensor payload survives; explicit clearing removes rows. |
| Integration settings and policy | `integration_reporting_policy_failure_rolls_back_connection_settings` | Injected policy failure also rolls back connection configuration. |
| Dashboard identity/selections | `dashboard_assigned_ids_and_widget_selections_round_trip` | Assigned IDs, selected-empty sensor list, fractional size, stored credentials/extension options and single default layout. |
| Dashboard arrangement | `dashboard_arrangement_transaction_rolls_back_sizes_order_and_removals` | Resize/order/removal transaction rollback and successful commit preserve widget contents. |
| Backup replacement | `backup_restore_replaces_absent_rows_and_rolls_back_the_entire_snapshot` | Removed rows stay absent; failure rolls back earlier deletions/writes; earlier snapshots restore IDs, secrets and linked groups. |
| Legacy per-device color calibration | `color_calibration_database_export_import_round_trip` | Calibration points and default-empty compatibility. Profile/assignment persistence has separate evidence below. |
| Routine rename | `routine_rename_failure_rolls_back_new_row_and_references` | Failed dependent rewrite cannot leave a partially renamed configuration. |
| Shared service settings | `service_setting_failure_rolls_back_core_and_prior_settings` | Core and earlier setting writes roll back after a later write fails. |
| Routine history | `routine_history_round_trips_and_prunes_to_newest_entries` | Database records reload and are pruned to the newest retained entries. |
| Scenario suite | `scenario_suite_database_export_import_round_trip` | Stored suite round trip, explicit removal and legacy omission. |
| Routine timer jobs | `timer_jobs_upsert_delete_and_import_clears` | Job replacement/deletion and exclusion from configuration exports. An actual configuration import clears the previously stored jobs; this assertion now exercises the import path, not just the clearing helper. |

## Separate contracts and remaining reconciliation

- Calibration profiles/assignments use
  `db::config_queries::calibration::tests::profiles_and_assignments_round_trip_and_failed_batch_rolls_back`;
  their prior checkpoint is recorded in IMPLEMENTATION.md. They are outside the
  17-test command above.
- User-timer runtime checkpoints and routine timer jobs are distinct stores.
  Runtime scheduling/restart behavior has its own tests in `core/user_timers.rs`
  and the timer acceptance ledger; persisting timer definitions is not proof of
  executing them.
- API expected-value conflicts, secret redaction/preservation, rejected writes,
  integration reload failures and backup review tokens have separate API tests.
  Their UI recovery paths still belong to the cross-family acceptance audit.
- Grid/image bytes persisting does not replace floorplan Fit/placement/preview
  tests, already linked from WORK-QUEUE.md.
- This checkpoint uses SQLite. It neither runs nor claims PostgreSQL coverage.
- Remaining reconciliation includes each widget's option defaults, backup
  lifecycle failures and the
  named accessibility/viewport gates. The full overhaul is not signed off here.

Widget follow-up: the everyday collection test now includes edited and empty option
objects for all 17 widget types. Its targeted rerun passes; exact fields/default
mapping and evidence are in [WIDGET-OPTIONS.md](WIDGET-OPTIONS.md). The broader
17-test checkpoint above remains a historical suite result.

## Repairable linked-group persistence

Migration `m20260930000000_repairable_group_links` removes only the child
foreign key from group links. Parent ownership/cascade, uniqueness, stored order
and indexes remain. This aligns durable storage with the API contract permitting
missing references for repair. Both `sqlite_group_links_remain_repairable` and
`postgres_group_links_remain_repairable` pass in `server/tests/group_link_migration.rs`.
They cover populated upgrades, child deletion, missing references, transactional
downgrade failure, repaired downgrade/re-upgrade, duplicate rejection, missing
parent rejection and parent deletion cleanup. PostgreSQL runs in a local
testcontainer; this is migration coverage rather than a full PostgreSQL API audit.
See `implementation-evidence/collections/group-migration-tests.log`.
