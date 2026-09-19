//! Schedule occurrence previews shared by the editor API.
//!
//! The runtime resolves the next due time for a schedule trigger in
//! `core::state` (K: intervals are monotonic-relative, calendar occurrences
//! resolve in the stored zone). This module answers the editor's "when would
//! this fire next?" question without touching runtime state: it walks the
//! same calendar rules forward from a wall-clock reference instant.

use crate::core::automation::calendar::{next_cron_occurrence, parse_schedule_zone};
use crate::types::automation_definition::ScheduleSpec;

/// Upper bound on previewed occurrences per request.
pub const MAX_PREVIEW_OCCURRENCES: usize = 16;

/// Wall-clock timestamps (ms since the Unix epoch) of the next `count`
/// occurrences strictly after `from_wall_ms`, in ascending order.
///
/// Interval schedules step by `every_ms` from the reference instant; calendar
/// schedules resolve cron occurrences in the stored zone. A schedule with
/// neither `every_ms` nor `cron` yields no occurrences. Unknown timezones and
/// unparseable cron expressions return the same messages the runtime uses.
pub fn preview_occurrences(
    schedule: &ScheduleSpec,
    from_wall_ms: i64,
    count: usize,
) -> Result<Vec<i64>, String> {
    let count = count.clamp(1, MAX_PREVIEW_OCCURRENCES);
    let mut occurrences = Vec::with_capacity(count);

    if let Some(every_ms) = schedule.every_ms {
        let mut cursor = from_wall_ms;
        for _ in 0..count {
            cursor = cursor.saturating_add(every_ms.min(i64::MAX as u64) as i64);
            occurrences.push(cursor);
        }
        return Ok(occurrences);
    }

    let Some(cron) = schedule.cron.as_deref() else {
        return Ok(occurrences);
    };
    let zone_name = schedule.timezone.as_deref().unwrap_or("UTC");
    let zone =
        parse_schedule_zone(zone_name).ok_or_else(|| format!("unknown timezone {zone_name:?}"))?;
    let mut cursor = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(from_wall_ms)
        .ok_or_else(|| "wall clock out of range".to_string())?;
    for _ in 0..count {
        let Some(occurrence) = next_cron_occurrence(cron, zone, cursor)? else {
            break;
        };
        occurrences.push(occurrence.instant.timestamp_millis());
        cursor = occurrence.instant;
    }
    Ok(occurrences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::automation_definition::BacklogPolicy;

    fn schedule(cron: Option<&str>, every_ms: Option<u64>, timezone: Option<&str>) -> ScheduleSpec {
        ScheduleSpec {
            cron: cron.map(str::to_string),
            every_ms,
            timezone: timezone.map(str::to_string),
            backlog: BacklogPolicy::Skip,
            catch_up_lateness_ms: None,
        }
    }

    fn instant(rfc3339: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .timestamp_millis()
    }

    #[test]
    fn intervals_step_forward_from_the_reference_instant() {
        let spec = schedule(None, Some(3_600_000), None);
        let from = instant("2026-01-01T00:00:00Z");
        let occurrences = preview_occurrences(&spec, from, 3).unwrap();
        assert_eq!(
            occurrences,
            vec![from + 3_600_000, from + 7_200_000, from + 10_800_000]
        );
    }

    #[test]
    fn calendar_occurrences_resolve_in_the_stored_zone() {
        let spec = schedule(Some("0 0 18 * * *"), None, Some("Europe/Helsinki"));
        let from = instant("2026-07-01T00:00:00Z");
        let occurrences = preview_occurrences(&spec, from, 3).unwrap();
        assert_eq!(
            occurrences,
            vec![
                instant("2026-07-01T15:00:00Z"),
                instant("2026-07-02T15:00:00Z"),
                instant("2026-07-03T15:00:00Z"),
            ]
        );
    }

    #[test]
    fn calendar_occurrences_are_strictly_after_the_reference_instant() {
        let spec = schedule(Some("0 0 18 * * *"), None, Some("UTC"));
        let from = instant("2026-01-01T18:00:00Z");
        let occurrences = preview_occurrences(&spec, from, 2).unwrap();
        assert_eq!(
            occurrences,
            vec![
                instant("2026-01-02T18:00:00Z"),
                instant("2026-01-03T18:00:00Z"),
            ]
        );
    }

    #[test]
    fn previews_are_clamped_to_the_maximum() {
        let spec = schedule(None, Some(1_000), None);
        let occurrences = preview_occurrences(&spec, 0, 100).unwrap();
        assert_eq!(occurrences.len(), MAX_PREVIEW_OCCURRENCES);
    }

    #[test]
    fn empty_schedule_yields_no_occurrences() {
        let spec = schedule(None, None, None);
        assert!(preview_occurrences(&spec, 0, 5).unwrap().is_empty());
    }

    #[test]
    fn unknown_timezones_and_bad_cron_are_rejected() {
        let unknown_zone = schedule(Some("0 0 18 * * *"), None, Some("Mars/Olympus"));
        assert!(preview_occurrences(&unknown_zone, 0, 1)
            .unwrap_err()
            .contains("unknown timezone"));

        let bad_cron = schedule(Some("not a cron"), None, Some("UTC"));
        assert!(preview_occurrences(&bad_cron, 0, 1).is_err());
    }
}
