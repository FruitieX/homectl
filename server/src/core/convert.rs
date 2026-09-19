//! Offline one-time v1 -> v2 conversion runner.
//!
//! Dry-run by default: reads the live database (read-only) or a JSON export,
//! converts legacy v1 routine rows through the strict compiler, and prints a
//! per-row report. `--apply` writes the converted rows in one transaction
//! after archiving the pre-conversion rows to JSON; rows that need manual
//! authoring stay on v1 semantics and keep running. The server must be
//! stopped while applying, and the archive is the rollback path.

use std::path::{Path, PathBuf};
use std::time::Duration;

use eyre::{bail, Result};
use serde::Serialize;

use crate::core::automation::compile::ConfigCatalog;
use crate::core::automation::convert::{
    conversion_summary, convert_routine, ConversionStatus, RoutineConversion,
};
use crate::db::config_queries::{ConfigExport, RoutineRow};

pub const ARCHIVE_FORMAT_VERSION: u32 = 1;

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
    pub integrations: Vec<IntegrationInventory>,
    pub notes: Vec<String>,
}

impl ConversionReport {
    pub fn is_clean(&self) -> bool {
        self.needs_manual == 0 && self.unsupported == 0
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

pub fn build_report(source: &str, export: &ConfigExport) -> ConversionReport {
    let catalog = ConfigCatalog::from_export(export);
    let rows: Vec<RoutineConversion> = export
        .routines
        .iter()
        .map(|row| convert_routine(row, &catalog))
        .collect();

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
                note: format!(
                    "{} integration conversion lands in the cron/timer stage; this run does not modify it",
                    integration.plugin
                ),
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
        integrations,
        notes: vec![
            "device references are not verified offline; a converted routine whose devices are missing at runtime loads as quarantined (visible in diagnostics)".to_string(),
            "cron and timer integrations are inventoried only; their conversion lands in a later stage".to_string(),
        ],
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

/// Converted rows ready for persistence. The legacy `rules`/`actions` columns
/// are preserved verbatim as the archive/reference copy; the revision bumps so
/// superseded results and caches can reject the old generation.
pub fn converted_rows(report: &ConversionReport, export: &ConfigExport) -> Result<Vec<RoutineRow>> {
    let mut rows = Vec::new();
    for (stored, conversion) in export.routines.iter().zip(report.rows.iter()) {
        let Some(definition) = conversion.converted_definition() else {
            continue;
        };
        let mut row = stored.clone();
        row.semantics_version = 2;
        row.revision = stored.revision.saturating_add(1);
        row.definition_v2 =
            Some(serde_json::to_value(definition).map_err(|error| {
                eyre::eyre!("Failed to serialize converted definition: {error}")
            })?);
        rows.push(row);
    }
    Ok(rows)
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

    let archive = ConversionArchive {
        format_version: ARCHIVE_FORMAT_VERSION,
        created_at: chrono::Utc::now().to_rfc3339(),
        source,
        converted_routines: converted_ids,
        routines,
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
    routines: Vec<RoutineRow>,
}

pub fn read_archive(path: &Path) -> Result<Vec<RoutineRow>> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| eyre::eyre!("Failed to read archive {}: {error}", path.display()))?;
    let archive: RestoreArchive = serde_json::from_str(&text)
        .map_err(|error| eyre::eyre!("Failed to parse archive {}: {error}", path.display()))?;
    if archive.format_version != ARCHIVE_FORMAT_VERSION {
        bail!(
            "Archive {} has format version {}, this build supports {}",
            path.display(),
            archive.format_version,
            ARCHIVE_FORMAT_VERSION
        );
    }
    Ok(archive.routines)
}

pub async fn apply_rows(rows: &[RoutineRow]) -> Result<()> {
    crate::db::config_queries::db_apply_routine_rows(rows).await
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
    if !report.integrations.is_empty() {
        output.push_str("Cron/timer integrations (not converted by this run):\n");
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
