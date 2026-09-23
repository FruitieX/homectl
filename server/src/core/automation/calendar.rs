//! Civil-time occurrence generation for calendar schedules (K01–K06).
//!
//! croner parses the pinned six-field grammar and iterates *civil* candidates
//! only (they are carried as UTC-labeled instants, so no timezone resolution
//! happens inside croner). Each candidate is then resolved in the stored IANA
//! zone with our own DST policy:
//!
//! - a nonexistent spring-forward local is skipped, and
//! - a repeated fall-back local runs once, at the earlier instant.
//!
//! Keeping candidate generation and timezone resolution separate is what makes
//! that policy testable and independent of the host timezone.

use chrono::{DateTime, LocalResult, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

/// A cron match resolved to one concrete instant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScheduleOccurrence {
    /// The local civil time the grammar matched.
    pub civil: NaiveDateTime,
    /// The resolved UTC instant that should fire.
    pub instant: DateTime<Utc>,
}

/// Upper bound on skipped candidates before giving up (a six-field grammar
/// always matches well within this; the bound only guards corrupt input).
const MAX_CANDIDATES: usize = 4_096;

impl ScheduleOccurrence {
    fn new(civil: NaiveDateTime, instant: DateTime<Utc>) -> Self {
        Self { civil, instant }
    }
}

/// A schedule's stored zone: an IANA zone (DST-aware) or a fixed offset
/// (never DST-aware). Compile validation accepts both.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScheduleZone {
    Tz(Tz),
    Fixed(chrono::FixedOffset),
}

/// Parse a stored zone name the same way compile validation does.
pub fn parse_schedule_zone(name: &str) -> Option<ScheduleZone> {
    if let Ok(zone) = name.parse::<Tz>() {
        return Some(ScheduleZone::Tz(zone));
    }
    if let Ok(offset) = name.parse::<chrono::FixedOffset>() {
        return Some(ScheduleZone::Fixed(offset));
    }
    None
}

impl ScheduleZone {
    /// Civil time of an instant in this zone. Computed sources evaluate
    /// against this injected local time (P11).
    pub fn local_time_at(&self, instant: DateTime<Utc>) -> chrono::NaiveTime {
        match self {
            ScheduleZone::Tz(zone) => instant.with_timezone(zone).time(),
            ScheduleZone::Fixed(offset) => instant.with_timezone(offset).time(),
        }
    }

    /// Instant of local midnight for the civil day containing `instant`,
    /// resolved with the same DST policy as schedules. A nonexistent local
    /// midnight (rare midnight-shifting DST transitions) falls back to the
    /// zone offset in effect at `instant`.
    pub fn local_midnight(&self, instant: DateTime<Utc>) -> DateTime<Utc> {
        let civil = match self {
            ScheduleZone::Tz(zone) => instant.with_timezone(zone).date_naive(),
            ScheduleZone::Fixed(offset) => instant.with_timezone(offset).date_naive(),
        }
        .and_hms_opt(0, 0, 0);
        let Some(civil) = civil else {
            return instant;
        };
        if let Some(resolved) = resolve_civil(*self, civil) {
            return resolved;
        }
        let seconds_since_midnight =
            i64::from(self.local_time_at(instant).num_seconds_from_midnight());
        instant - chrono::Duration::seconds(seconds_since_midnight)
    }
}

/// Resolve a civil time in a zone under the fixed DST policy.
fn resolve_civil(zone: ScheduleZone, civil: NaiveDateTime) -> Option<DateTime<Utc>> {
    match zone {
        ScheduleZone::Tz(zone) => match zone.from_local_datetime(&civil) {
            LocalResult::Single(instant) => Some(instant.with_timezone(&Utc)),
            LocalResult::Ambiguous(earlier, _later) => Some(earlier.with_timezone(&Utc)),
            LocalResult::None => None,
        },
        ScheduleZone::Fixed(offset) => Some(
            offset
                .from_local_datetime(&civil)
                .single()?
                .with_timezone(&Utc),
        ),
    }
}

/// Next cron occurrence strictly after `after`.
pub fn next_cron_occurrence(
    cron: &str,
    zone: ScheduleZone,
    after: DateTime<Utc>,
) -> Result<Option<ScheduleOccurrence>, String> {
    let parser = croner::parser::CronParser::builder()
        .seconds(croner::parser::Seconds::Required)
        .build();
    let parsed = parser.parse(cron).map_err(|error| error.to_string())?;

    let mut cursor = after;
    let mut inclusive = false;
    for _ in 0..MAX_CANDIDATES {
        let candidate = parsed
            .find_next_occurrence(&cursor, inclusive)
            .map_err(|error| error.to_string())?;
        let civil = candidate.naive_utc();
        if let Some(instant) = resolve_civil(zone, civil) {
            if instant > after {
                return Ok(Some(ScheduleOccurrence::new(civil, instant)));
            }
        }
        // The candidate resolved before the reference instant (fall-back
        // shift) or does not exist (spring-forward skip); keep scanning.
        cursor = candidate;
        inclusive = false;
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(text: &str) -> DateTime<Utc> {
        text.parse().expect("valid RFC 3339 instant")
    }

    // K02/K03: the same civil grammar resolves independently of the host
    // timezone, and a missing spring-forward local is skipped.
    #[test]
    fn spring_forward_missing_local_is_skipped() {
        let zone = ScheduleZone::Tz("Europe/Helsinki".parse().unwrap());
        // 2026-03-29 03:30 local does not exist (03:00 EET -> 04:00 EEST).
        let next = next_cron_occurrence("0 30 3 * * *", zone, utc("2026-03-28T12:00:00Z"))
            .unwrap()
            .expect("a next occurrence exists");
        assert_eq!(next.civil.to_string(), "2026-03-30 03:30:00");
        assert_eq!(next.instant, utc("2026-03-30T00:30:00Z"));
    }

    // K04: a repeated fall-back local runs once, at the earlier instant, and
    // is not emitted again for the later instant.
    #[test]
    fn fall_back_repeated_local_runs_once_at_the_earlier_instant() {
        let zone = ScheduleZone::Tz("Europe/Helsinki".parse().unwrap());
        // 2026-10-25: 04:00 EEST -> 03:00 EET, so 03:30 local happens twice.
        let first = next_cron_occurrence("0 30 3 * * *", zone, utc("2026-10-24T12:00:00Z"))
            .unwrap()
            .expect("first occurrence");
        assert_eq!(first.civil.to_string(), "2026-10-25 03:30:00");
        assert_eq!(first.instant, utc("2026-10-25T00:30:00Z"));

        let second = next_cron_occurrence("0 30 3 * * *", zone, first.instant)
            .unwrap()
            .expect("second occurrence");
        assert_eq!(second.civil.to_string(), "2026-10-26 03:30:00");
        assert_eq!(second.instant, utc("2026-10-26T01:30:00Z"));
    }

    #[test]
    fn daily_civil_time_resolves_in_the_stored_zone() {
        let helsinki = ScheduleZone::Tz("Europe/Helsinki".parse().unwrap());
        let new_york = ScheduleZone::Tz("America/New_York".parse().unwrap());
        let start = utc("2026-01-01T00:00:00Z");

        let winter = next_cron_occurrence("0 0 8 * * *", helsinki, start)
            .unwrap()
            .unwrap();
        assert_eq!(winter.instant, utc("2026-01-01T06:00:00Z"));

        let across = next_cron_occurrence("0 0 8 * * *", new_york, start)
            .unwrap()
            .unwrap();
        assert_eq!(across.instant, utc("2026-01-01T13:00:00Z"));
    }

    #[test]
    fn fixed_offsets_resolve_without_dst() {
        let zone = parse_schedule_zone("+02:00").expect("fixed offset parses");
        let next = next_cron_occurrence("0 0 8 * * *", zone, utc("2026-01-01T00:00:00Z"))
            .unwrap()
            .unwrap();
        assert_eq!(next.instant, utc("2026-01-01T06:00:00Z"));
    }

    #[test]
    fn seconds_are_required_and_bad_grammar_is_an_error() {
        let zone = ScheduleZone::Tz("UTC".parse().unwrap());
        assert!(next_cron_occurrence("0 8 * * *", zone, utc("2026-01-01T00:00:00Z")).is_err());
        assert!(next_cron_occurrence("nope", zone, utc("2026-01-01T00:00:00Z")).is_err());
    }
}
