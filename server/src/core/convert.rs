//! Offline one-time v1 -> v2 conversion runner.
//!
//! Dry-run by default: reads the live database (read-only) or a JSON export,
//! converts legacy v1 routine rows and cron schedules through the strict
//! compiler, and prints a per-row report. `--apply` writes the converted rows
//! in one transaction after archiving the pre-conversion rows; rows that need
//! manual authoring stay on v1 semantics and keep running. Converted cron
//! integrations are quiesced in the same transaction so the old scheduler and
//! the new schedule triggers cannot both fire. The server must be stopped
//! while applying, and the archive is the rollback path.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use eyre::{bail, Result};
use serde::Serialize;
use serde_json::Value;

use crate::core::automation::compile::ConfigCatalog;
use crate::core::automation::convert::{
    conversion_summary, convert_cron_schedule, convert_routine, cron_routine_id,
    parse_cron_schedules, ConversionStatus, ConvertOptions, CronConversion, RoutineConversion,
};
use crate::db::config_queries::{ConfigExport, IntegrationRow, RoutineRow};

pub const ARCHIVE_FORMAT_VERSION: u32 = 2;

const SUPPORTED_ARCHIVE_FORMATS: &[u32] = &[1, 2];

/// Per-integration inventory for the parts of the migration (cron/timer)
/// that are converted in a later stage.
#[derive(Clone, Debug, Serialize)]
pub struct IntegrationInventory {
    pub id: String,
    pub plugin: String,
    pub enabled: bool,
    pub entries: usize,
    pub note: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ConversionReport {
    pub source: String,
    pub total: usize,
    pub converted: usize,
    pub needs_manual: usize,
    pub unsupported: usize,
    pub already_v2: usize,
    pub rows: Vec<RoutineConversion>,
    pub cron_total: usize,
    pub cron_converted: usize,
    pub cron_needs_manual: usize,
    pub cron_unsupported: usize,
    pub cron: Vec<CronConversion>,
    /// Cron/timer integration ids that `--apply` sets to disabled because
    /// nothing on v1 semantics still uses them.
    pub disable_integrations: Vec<String>,
    pub integrations: Vec<IntegrationInventory>,
    pub notes: Vec<String>,
}

impl ConversionReport {
    pub fn is_clean(&self) -> bool {
        self.needs_manual == 0
            && self.unsupported == 0
            && self.cron_needs_manual == 0
            && self.cron_unsupported == 0
    }
}

pub async fn load_source_export(
    source_db: Option<&str>,
    source_export: Option<&str>,
) -> Result<(String, ConfigExport)> {
    if let Some(path) = source_export {
        let text = std::fs::read_to_string(path)
            .map_err(|error| eyre::eyre!("Failed to read export {path}: {error}"))?;
        let parsed = crate::api::config::parse_config_backup(&text)
            .map_err(|error| eyre::eyre!("Failed to parse export {path}: {error}"))?;
        return Ok((path.to_string(), parsed.to_config_export()));
    }

    let source = source_db
        .map(str::to_string)
        .unwrap_or_else(|| crate::db::DEFAULT_SQLITE_DATABASE_FILE.to_string());
    let read_source = sqlite_source_path(&source);
    let export =
        crate::core::simulate::prepare_simulation_config(Some(read_source.as_ref()), None).await?;
    Ok((source, export))
}

/// `--source-db` accepts the same `sqlite://` URLs as `DATABASE_URL`, but the
/// read-only simulation reader wants a plain SQLite path.
fn sqlite_source_path(source: &str) -> std::borrow::Cow<'_, str> {
    if let Some(path) = source.strip_prefix("sqlite://") {
        return std::borrow::Cow::Borrowed(path);
    }
    if let Some(path) = source.strip_prefix("sqlite:") {
        return std::borrow::Cow::Borrowed(path);
    }
    std::borrow::Cow::Borrowed(source)
}

pub fn build_report(
    source: &str,
    export: &ConfigExport,
    cron_timezone: Option<String>,
) -> ConversionReport {
    let catalog = ConfigCatalog::from_export(export);
    let timer_integrations: BTreeSet<String> = export
        .integrations
        .iter()
        .filter(|integration| integration.plugin == "timer")
        .map(|integration| integration.id.clone())
        .collect();
    let options = ConvertOptions {
        timer_integrations,
        cron_timezone,
    };

    let rows: Vec<RoutineConversion> = export
        .routines
        .iter()
        .map(|row| convert_routine(row, &catalog, &options))
        .collect();

    let existing_routine_ids = routine_ids(export);
    let mut cron = Vec::new();
    let mut skipped_cron_integrations = BTreeSet::new();
    for integration in export
        .integrations
        .iter()
        .filter(|integration| integration.plugin == "cron")
    {
        let schedules =
            match parse_cron_schedules(&integration.id, integration.enabled, &integration.config) {
                Ok(schedules) => schedules,
                Err(error) => {
                    cron.push(CronConversion {
                        integration_id: integration.id.clone(),
                        schedule_id: "*".to_string(),
                        routine_id: String::new(),
                        name: integration.id.clone(),
                        enabled: false,
                        status: ConversionStatus::Unsupported {
                            reasons: vec![error],
                        },
                    });
                    continue;
                }
            };

        // An integration that is already off and whose routines all exist was
        // converted by an earlier run; re-listing it as a routine-id conflict
        // would force `--force` on every subsequent apply.
        let already_converted = !integration.enabled
            && !schedules.is_empty()
            && schedules.iter().all(|schedule| {
                existing_routine_ids.contains(&cron_routine_id(
                    &schedule.integration_id,
                    &schedule.schedule_id,
                ))
            });
        if already_converted {
            skipped_cron_integrations.insert(integration.id.clone());
            continue;
        }

        let integration_id = integration.id.clone();
        let all_schedules_convertible = schedules.iter().all(|schedule| {
            convert_cron_schedule(schedule, &catalog, &options, &existing_routine_ids)
                .is_converted()
        });
        for schedule in &schedules {
            let mut conversion =
                convert_cron_schedule(schedule, &catalog, &options, &existing_routine_ids);
            if conversion.is_converted() && !all_schedules_convertible {
                conversion.status = ConversionStatus::NeedsManual {
                    reasons: vec![format!(
                        "another schedule of cron integration {integration_id} needs manual authoring; converting only part of the integration would double-fire while the old scheduler stays enabled"
                    )],
                };
            }
            cron.push(conversion);
        }
    }

    let converted_ids: BTreeSet<&str> = rows
        .iter()
        .filter(|row| row.is_converted())
        .map(|row| row.id.as_str())
        .collect();
    let all_cron_converted =
        !cron.is_empty() && cron.iter().all(|schedule| schedule.is_converted());
    let cron_integrations: BTreeSet<&str> = cron
        .iter()
        .map(|schedule| schedule.integration_id.as_str())
        .collect();

    let mut disable_integrations = Vec::new();
    if all_cron_converted {
        for integration_id in &cron_integrations {
            if integration_is_enabled(export, integration_id) {
                disable_integrations.push(integration_id.to_string());
            }
        }
    }
    for integration in export
        .integrations
        .iter()
        .filter(|integration| integration.plugin == "timer" && integration.enabled)
    {
        if integration_used_by_v1_rows(export, &integration.id)
            && !integration_used_by_unconverted_rows(export, &converted_ids, &integration.id)
        {
            disable_integrations.push(integration.id.clone());
        }
    }

    let converted = rows.iter().filter(|row| row.is_converted()).count();
    let needs_manual = rows
        .iter()
        .filter(|row| matches!(row.status, ConversionStatus::NeedsManual { .. }))
        .count();
    let unsupported = rows
        .iter()
        .filter(|row| matches!(row.status, ConversionStatus::Unsupported { .. }))
        .count();
    let already_v2 = rows
        .iter()
        .filter(|row| matches!(row.status, ConversionStatus::AlreadyV2))
        .count();
    let cron_converted = cron.iter().filter(|row| row.is_converted()).count();
    let cron_needs_manual = cron
        .iter()
        .filter(|row| matches!(row.status, ConversionStatus::NeedsManual { .. }))
        .count();
    let cron_unsupported = cron
        .iter()
        .filter(|row| matches!(row.status, ConversionStatus::Unsupported { .. }))
        .count();

    let integrations = export
        .integrations
        .iter()
        .filter(|integration| integration.plugin == "cron" || integration.plugin == "timer")
        .map(|integration| {
            let entries = cron_or_timer_entries(&integration.plugin, &integration.config);
            IntegrationInventory {
                id: integration.id.clone(),
                plugin: integration.plugin.clone(),
                enabled: integration.enabled,
                entries,
                note: if skipped_cron_integrations.contains(&integration.id) {
                    "disabled and already converted by an earlier run; skipping".to_string()
                } else if disable_integrations.contains(&integration.id) {
                    "converted; apply will disable this integration so the old scheduler cannot double-fire".to_string()
                } else {
                    "partially converted or still referenced; this run does not modify it".to_string()
                },
            }
        })
        .collect();

    ConversionReport {
        source: source.to_string(),
        total: export.routines.len(),
        converted,
        needs_manual,
        unsupported,
        already_v2,
        rows,
        cron_total: cron.len(),
        cron_converted,
        cron_needs_manual,
        cron_unsupported,
        cron,
        disable_integrations,
        integrations,
        notes: vec![
            "device references are not verified offline; a converted routine whose devices are missing at runtime loads as quarantined (visible in diagnostics)".to_string(),
            "converted cron integrations are disabled on apply; timer integrations are disabled only when no v1 routine still reads them".to_string(),
        ],
    }
}

fn routine_ids(export: &ConfigExport) -> BTreeSet<String> {
    export.routines.iter().map(|row| row.id.clone()).collect()
}

fn integration_is_enabled(export: &ConfigExport, integration_id: &str) -> bool {
    export
        .integrations
        .iter()
        .any(|integration| integration.id == integration_id && integration.enabled)
}

fn integration_used_by_v1_rows(export: &ConfigExport, integration_id: &str) -> bool {
    export.routines.iter().any(|row| {
        row.semantics_version == 1
            && (json_mentions_integration(&row.rules, integration_id)
                || json_mentions_integration(&row.actions, integration_id))
    })
}

fn integration_used_by_unconverted_rows(
    export: &ConfigExport,
    converted_ids: &BTreeSet<&str>,
    integration_id: &str,
) -> bool {
    export.routines.iter().any(|row| {
        row.semantics_version == 1
            && !converted_ids.contains(row.id.as_str())
            && (json_mentions_integration(&row.rules, integration_id)
                || json_mentions_integration(&row.actions, integration_id))
    })
}

fn json_mentions_integration(value: &Value, integration_id: &str) -> bool {
    match value {
        Value::Object(map) => {
            if map.get("integration_id").and_then(Value::as_str) == Some(integration_id) {
                return true;
            }
            map.values()
                .any(|value| json_mentions_integration(value, integration_id))
        }
        Value::Array(items) => items
            .iter()
            .any(|value| json_mentions_integration(value, integration_id)),
        _ => false,
    }
}

fn cron_or_timer_entries(plugin: &str, config: &serde_json::Value) -> usize {
    match plugin {
        "cron" => config
            .get("schedules")
            .and_then(|value| value.as_object())
            .map(|schedules| schedules.len())
            .unwrap_or(0),
        "timer" => 1,
        _ => 0,
    }
}

/// Converted rows ready for persistence, including converted cron schedules
/// as new v2 routines. The legacy `rules`/`actions` columns are preserved
/// verbatim as the archive/reference copy; revisions bump so superseded
/// results and caches can reject the old generation.
pub fn converted_rows(report: &ConversionReport, export: &ConfigExport) -> Result<Vec<RoutineRow>> {
    let mut rows = Vec::new();
    for (stored, conversion) in export.routines.iter().zip(report.rows.iter()) {
        let Some(definition) = conversion.converted_definition() else {
            continue;
        };
        let mut row = stored.clone();
        row.semantics_version = 2;
        row.revision = stored.revision.saturating_add(1);
        row.definition_v2 = Some(serialize_definition(definition)?);
        rows.push(row);
    }
    for conversion in &report.cron {
        let Some(definition) = conversion.converted_definition() else {
            continue;
        };
        rows.push(RoutineRow {
            id: conversion.routine_id.clone(),
            name: conversion.name.clone(),
            enabled: conversion.enabled,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(serialize_definition(definition)?),
            rules: Value::Array(Vec::new()),
            actions: Value::Array(Vec::new()),
        });
    }
    Ok(rows)
}

fn serialize_definition(
    definition: &crate::types::automation_definition::RoutineDefinitionV2,
) -> Result<Value> {
    serde_json::to_value(definition)
        .map_err(|error| eyre::eyre!("Failed to serialize converted definition: {error}"))
}

/// Integration rows to disable as part of an apply, copied from the export.
pub fn integrations_to_disable(
    report: &ConversionReport,
    export: &ConfigExport,
) -> Vec<IntegrationRow> {
    report
        .disable_integrations
        .iter()
        .filter_map(|id| {
            export
                .integrations
                .iter()
                .find(|integration| &integration.id == id)
        })
        .map(|integration| {
            let mut disabled = integration.clone();
            disabled.enabled = false;
            disabled
        })
        .collect()
}

#[derive(Serialize)]
struct ConversionArchive<'a> {
    format_version: u32,
    created_at: String,
    source: &'a str,
    converted_routines: Vec<&'a str>,
    /// Full pre-conversion rows, newest schema, so a restore is a plain
    /// upsert back to v1 semantics.
    routines: Vec<&'a RoutineRow>,
    /// New routines created from cron schedules; a restore deletes them.
    #[serde(default)]
    created_routines: Vec<String>,
    /// Pre-disable integration rows (enabled state) for quiesced cron/timer
    /// integrations; a restore upserts them.
    #[serde(default)]
    integrations: Vec<&'a IntegrationRow>,
}

pub fn archive_json(source: &str, export: &ConfigExport, report: &ConversionReport) -> String {
    let converted_ids: Vec<&str> = report
        .rows
        .iter()
        .filter(|row| row.is_converted())
        .map(|row| row.id.as_str())
        .collect();
    let routines: Vec<&RoutineRow> = export
        .routines
        .iter()
        .filter(|row| converted_ids.contains(&row.id.as_str()))
        .collect();
    let created_routines: Vec<String> = report
        .cron
        .iter()
        .filter(|row| row.is_converted())
        .map(|row| row.routine_id.clone())
        .collect();
    let integrations: Vec<&IntegrationRow> = export
        .integrations
        .iter()
        .filter(|integration| report.disable_integrations.contains(&integration.id))
        .collect();

    let archive = ConversionArchive {
        format_version: ARCHIVE_FORMAT_VERSION,
        created_at: chrono::Utc::now().to_rfc3339(),
        source,
        converted_routines: converted_ids,
        routines,
        created_routines,
        integrations,
    };
    serde_json::to_string_pretty(&archive).unwrap_or_else(|_| "{}".to_string())
}

pub fn write_archive(
    path: &Path,
    source: &str,
    export: &ConfigExport,
    report: &ConversionReport,
) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|error| eyre::eyre!("Failed to create archive directory: {error}"))?;
        }
    }
    std::fs::write(path, archive_json(source, export, report))
        .map_err(|error| eyre::eyre!("Failed to write archive {}: {error}", path.display()))?;
    Ok(())
}

pub fn default_archive_path() -> PathBuf {
    PathBuf::from(format!(
        "homectl-convert-archive-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ))
}

#[derive(serde::Deserialize)]
struct RestoreArchive {
    format_version: u32,
    #[serde(default)]
    routines: Vec<RoutineRow>,
    #[serde(default)]
    created_routines: Vec<String>,
    #[serde(default)]
    integrations: Vec<IntegrationRow>,
}

/// Rollback plan read from an archive: rows to restore, converter-created
/// routines to delete, and integrations to re-enable.
pub struct RestorePlan {
    pub routines: Vec<RoutineRow>,
    pub created_routines: Vec<String>,
    pub integrations: Vec<IntegrationRow>,
}

pub fn read_archive(path: &Path) -> Result<RestorePlan> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| eyre::eyre!("Failed to read archive {}: {error}", path.display()))?;
    let archive: RestoreArchive = serde_json::from_str(&text)
        .map_err(|error| eyre::eyre!("Failed to parse archive {}: {error}", path.display()))?;
    if !SUPPORTED_ARCHIVE_FORMATS.contains(&archive.format_version) {
        bail!(
            "Archive {} has format version {}, this build supports {:?}",
            path.display(),
            archive.format_version,
            SUPPORTED_ARCHIVE_FORMATS
        );
    }
    Ok(RestorePlan {
        routines: archive.routines,
        created_routines: archive.created_routines,
        integrations: archive.integrations,
    })
}

pub async fn apply_conversion(
    routine_upserts: &[RoutineRow],
    routine_deletes: &[String],
    integration_upserts: &[IntegrationRow],
) -> Result<()> {
    crate::db::config_queries::db_apply_conversion(
        routine_upserts,
        routine_deletes,
        integration_upserts,
    )
    .await
}

/// Plain routine upsert without integration changes (kept for callers that
/// only need the routine half of an apply).
pub async fn apply_rows(routines: &[RoutineRow]) -> Result<()> {
    apply_conversion(routines, &[], &[]).await
}

/// Best-effort check that no homectl server owns the database port.
pub async fn server_reachable(port: u16) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
    else {
        return false;
    };
    client
        .get(format!("http://127.0.0.1:{port}/health/live"))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

pub fn render_report(report: &ConversionReport) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "Routine conversion report (source: {})\n",
        report.source
    ));
    output.push_str(&format!(
        "  total {} | converted {} | needs manual {} | unsupported {} | already v2 {}\n",
        report.total, report.converted, report.needs_manual, report.unsupported, report.already_v2
    ));
    for row in &report.rows {
        let flag = if row.enabled { "enabled" } else { "disabled" };
        output.push_str(&format!(
            "  - {} ({flag}): {}\n",
            row.id,
            conversion_summary(row)
        ));
    }
    if report.cron_total > 0 {
        output.push_str(&format!(
            "Cron schedules: total {} | converted {} | needs manual {} | unsupported {}\n",
            report.cron_total,
            report.cron_converted,
            report.cron_needs_manual,
            report.cron_unsupported
        ));
        for schedule in &report.cron {
            output.push_str(&format!(
                "  - {} ({}): {}\n",
                schedule.routine_id,
                schedule.schedule_id,
                conversion_summary(&RoutineConversion {
                    id: schedule.routine_id.clone(),
                    name: schedule.name.clone(),
                    enabled: schedule.enabled,
                    status: schedule.status.clone(),
                })
            ));
        }
    }
    if !report.integrations.is_empty() {
        output.push_str("Cron/timer integrations:\n");
        for integration in &report.integrations {
            output.push_str(&format!(
                "  - {} ({}): {} entries, enabled={} - {}\n",
                integration.id,
                integration.plugin,
                integration.entries,
                integration.enabled,
                integration.note
            ));
        }
    }
    for note in &report.notes {
        output.push_str(&format!("note: {note}\n"));
    }
    output
}
