//! Actor-owned registry of computed source definitions and outputs (P11).
//!
//! Definitions are DB-backed runtime config; the last computed output, its
//! freshness, and the refresh cursor live only in actor state. Publication
//! goes through a read-only synthetic sensor device keyed `computed/<id>`, so
//! existing scene device links, group expansion, and dependency invalidation
//! keep working without introducing a second entity for the same source.
//!
//! Legacy device keys listed in `aliases` resolve to the same canonical
//! device (D07); the registry exposes the alias map and the device store
//! consults it at lookup time instead of publishing duplicate devices.

use std::collections::BTreeMap;

use log::warn;
use ordered_float::OrderedFloat;

use crate::core::automation::calendar::parse_schedule_zone;
use crate::core::automation::sources::{CircadianCompatCurve, CIRCADIAN_COMPAT_PRESET_VERSION};
use crate::types::automation_definition::SourceId;
use crate::types::automation_source::{
    LightProfile, SourceCompute, SourceDefinition, SourceOutput, SourceQuality,
};
use crate::types::device::{
    ControllableState, Device, DeviceData, DeviceId, DeviceKey, SensorDevice,
};
use crate::types::integration::IntegrationId;

/// Integration id of the synthetic device adapter. No integration row uses
/// this id, so integration reload never removes computed devices (D08).
pub const COMPUTED_SOURCE_INTEGRATION_ID: &str = "computed";

/// Canonical device key of a source's synthetic device.
pub fn source_device_key(id: &SourceId) -> DeviceKey {
    DeviceKey::new(
        IntegrationId::from(COMPUTED_SOURCE_INTEGRATION_ID.to_string()),
        DeviceId::new(&id.0),
    )
}

/// Result of one successful evaluation.
#[derive(Debug)]
pub struct SourceEvaluation {
    pub profile: LightProfile,
    /// Injected civil time the profile was computed against.
    pub local_time: Option<String>,
}

/// Evaluate one source at a wall-clock instant. Pure apart from the injected
/// time; validation and freshness bookkeeping belong to the caller.
pub fn evaluate_source(
    definition: &SourceDefinition,
    now_wall_ms: i64,
) -> Result<SourceEvaluation, String> {
    let zone = parse_schedule_zone(&definition.timezone)
        .ok_or_else(|| format!("unknown timezone {:?}", definition.timezone))?;
    let instant = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_wall_ms)
        .ok_or_else(|| format!("invalid wall time {now_wall_ms}"))?;
    let local = zone.local_time_at(instant);

    match &definition.compute {
        SourceCompute::CircadianCompat {
            preset_version,
            params,
        } => {
            if *preset_version != CIRCADIAN_COMPAT_PRESET_VERSION {
                return Err(format!(
                    "unsupported circadian preset version {preset_version}"
                ));
            }
            let curve = CircadianCompatCurve::from_params(params)?;
            let profile = curve.profile_at(local);
            profile.validate()?;
            Ok(SourceEvaluation {
                profile,
                local_time: Some(local.format("%H:%M:%S").to_string()),
            })
        }
    }
}

/// Evaluate every enabled source whose cadence has elapsed, recording
/// successes and failures. Returns the definitions and profiles that should
/// be published; startup seeding and the actor refresh path share this so
/// cadence and freshness bookkeeping cannot drift.
pub fn evaluate_due_sources(
    registry: &mut Sources,
    now_wall_ms: i64,
) -> Vec<(SourceDefinition, LightProfile)> {
    let mut publishable = Vec::new();
    for definition in registry.due_sources(now_wall_ms) {
        match evaluate_source(&definition, now_wall_ms) {
            Ok(evaluation) => {
                registry.record_success(
                    &definition,
                    evaluation.profile.clone(),
                    evaluation.local_time,
                    now_wall_ms,
                );
                publishable.push((definition, evaluation.profile));
            }
            Err(message) => {
                warn!(
                    "Computed source {} failed to evaluate: {message}",
                    definition.id.0
                );
                registry.record_failure(&definition.id, message, now_wall_ms);
            }
        }
    }
    publishable
}

/// Read-only synthetic device carrying the computed profile. Sensors accept
/// no actuator writes, and the adapter never reaches a physical integration
/// (D09).
pub fn synthetic_device(definition: &SourceDefinition, profile: &LightProfile) -> Device {
    Device {
        id: DeviceId::new(&definition.id.0),
        name: definition.name.clone(),
        integration_id: IntegrationId::from(COMPUTED_SOURCE_INTEGRATION_ID.to_string()),
        data: DeviceData::Sensor(SensorDevice::Color(ControllableState {
            power: true,
            color: profile.color.clone(),
            brightness: profile.brightness,
            transition: profile
                .transition_ms
                .map(|ms| OrderedFloat(ms as f32 / 1000.0)),
        })),
        raw: None,
    }
}

/// Definitions, last-good outputs, and refresh cursors. A failed evaluation
/// retains the last good output as `stale`, never as healthy (D06).
#[derive(Default)]
pub struct Sources {
    definitions: BTreeMap<SourceId, SourceDefinition>,
    outputs: BTreeMap<SourceId, SourceOutput>,
    last_attempt_wall_ms: BTreeMap<SourceId, i64>,
}

impl Sources {
    /// Rebuild the definition set, preserving outputs for unchanged
    /// revisions. Returns the ids that were removed so the caller can drop
    /// their synthetic devices.
    pub fn load_rows(&mut self, definitions: Vec<SourceDefinition>) -> Vec<SourceId> {
        let previous_revisions: BTreeMap<SourceId, i64> = self
            .definitions
            .iter()
            .map(|(id, definition)| (id.clone(), definition.revision))
            .collect();
        let next: BTreeMap<SourceId, SourceDefinition> = definitions
            .into_iter()
            .map(|definition| (definition.id.clone(), definition))
            .collect();
        let removed: Vec<SourceId> = self
            .definitions
            .keys()
            .filter(|id| !next.contains_key(*id))
            .cloned()
            .collect();

        let previous_outputs = std::mem::take(&mut self.outputs);
        let previous_attempts = std::mem::take(&mut self.last_attempt_wall_ms);
        self.definitions = next;

        for (id, output) in previous_outputs {
            if let Some(definition) = self.definitions.get(&id) {
                if definition.revision == output.definition_revision {
                    self.outputs.insert(id, output);
                }
            }
        }
        // A changed revision recomputes immediately: the old output and its
        // refresh cursor describe a definition that no longer exists.
        self.last_attempt_wall_ms = previous_attempts
            .into_iter()
            .filter(|(id, _)| {
                self.definitions.get(id).is_some_and(|definition| {
                    previous_revisions.get(id) == Some(&definition.revision)
                })
            })
            .collect();

        removed
    }

    pub fn definitions(&self) -> &BTreeMap<SourceId, SourceDefinition> {
        &self.definitions
    }

    pub fn output(&self, id: &SourceId) -> Option<&SourceOutput> {
        self.outputs.get(id)
    }

    pub fn outputs(&self) -> &BTreeMap<SourceId, SourceOutput> {
        &self.outputs
    }

    /// Enabled sources whose refresh cadence has elapsed (or that have never
    /// been attempted). Startup is the first opportunity, so a fresh process
    /// computes every enabled source exactly once (D04).
    pub fn due_sources(&self, now_wall_ms: i64) -> Vec<SourceDefinition> {
        self.definitions
            .values()
            .filter(|definition| definition.enabled)
            .filter(|definition| {
                let interval_ms = i64::try_from(definition.refresh_interval_ms).unwrap_or(i64::MAX);
                match self.last_attempt_wall_ms.get(&definition.id) {
                    Some(last_attempt) => now_wall_ms.saturating_sub(*last_attempt) >= interval_ms,
                    None => true,
                }
            })
            .cloned()
            .collect()
    }

    /// Alias device keys mapped to their canonical `computed/<id>` key.
    pub fn aliases(&self) -> Vec<(DeviceKey, DeviceKey)> {
        let mut aliases = Vec::new();
        for definition in self.definitions.values() {
            let canonical = source_device_key(&definition.id);
            for alias in &definition.aliases {
                if alias != &canonical {
                    aliases.push((alias.clone(), canonical.clone()));
                }
            }
        }
        aliases
    }

    pub fn record_success(
        &mut self,
        definition: &SourceDefinition,
        profile: LightProfile,
        local_time: Option<String>,
        computed_at_ms: i64,
    ) {
        self.last_attempt_wall_ms
            .insert(definition.id.clone(), computed_at_ms);
        self.outputs.insert(
            definition.id.clone(),
            SourceOutput {
                profile,
                quality: SourceQuality::Fresh,
                definition_revision: definition.revision,
                computed_at_ms,
                local_time,
            },
        );
    }

    pub fn record_failure(&mut self, id: &SourceId, message: String, attempted_at_ms: i64) {
        self.last_attempt_wall_ms
            .insert(id.clone(), attempted_at_ms);
        if let Some(output) = self.outputs.get_mut(id) {
            output.quality = SourceQuality::Stale { message };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::automation_source::CircadianCompatParams;
    use crate::types::color::DeviceColor;

    fn params() -> CircadianCompatParams {
        CircadianCompatParams {
            day_fade_start: "06:00".to_string(),
            day_fade_duration_hours: 2,
            day_color: DeviceColor::new_from_kelvin(3000),
            day_brightness: Some(0.8),
            night_fade_start: "20:00".to_string(),
            night_fade_duration_hours: 2,
            night_color: DeviceColor::new_from_kelvin(2000),
            night_brightness: Some(0.2),
        }
    }

    fn definition(id: &str, enabled: bool, revision: i64, interval_ms: u64) -> SourceDefinition {
        SourceDefinition {
            id: SourceId(id.to_string()),
            name: format!("Source {id}"),
            enabled,
            revision,
            timezone: "Europe/Helsinki".to_string(),
            refresh_interval_ms: interval_ms,
            aliases: vec![DeviceKey::new(
                IntegrationId::from("circadian".to_string()),
                DeviceId::new("color"),
            )],
            compute: SourceCompute::CircadianCompat {
                preset_version: CIRCADIAN_COMPAT_PRESET_VERSION,
                params: params(),
            },
        }
    }

    /// D04: startup computes once, and the cadence gate prevents replay of
    /// missed ticks.
    #[test]
    fn d04_due_sources_follow_the_refresh_cadence() {
        let mut sources = Sources::default();
        sources.load_rows(vec![definition("circadian", true, 1, 60_000)]);

        let due = sources.due_sources(1_000_000);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, SourceId("circadian".to_string()));

        sources.record_success(
            &due[0],
            LightProfile::default(),
            Some("03:16:40".to_string()),
            1_000_000,
        );
        assert!(sources.due_sources(1_059_999).is_empty());
        assert_eq!(sources.due_sources(1_060_000).len(), 1);

        // An unchanged revision keeps output and cursor.
        sources.load_rows(vec![definition("circadian", true, 1, 60_000)]);
        assert!(sources.output(&SourceId("circadian".to_string())).is_some());
        assert!(sources.due_sources(1_059_999).is_empty());

        // A new revision drops the old output and recomputes immediately.
        sources.load_rows(vec![definition("circadian", true, 2, 60_000)]);
        assert!(sources.output(&SourceId("circadian".to_string())).is_none());
        assert_eq!(sources.due_sources(1_000_001).len(), 1);

        // Disabled sources are never due and their last output is retained.
        sources.load_rows(vec![definition("circadian", false, 2, 60_000)]);
        assert!(sources.due_sources(9_999_999).is_empty());
    }

    /// D06: an evaluation failure keeps the last good profile and marks it
    /// stale; without a prior output nothing is invented.
    #[test]
    fn d06_failures_retain_last_good_output_as_stale() {
        let mut sources = Sources::default();
        let source = definition("circadian", true, 1, 60_000);
        sources.load_rows(vec![source.clone()]);

        let id = source.id.clone();
        sources.record_success(
            &source,
            LightProfile {
                color: Some(DeviceColor::new_from_kelvin(3000)),
                brightness: Some(OrderedFloat(0.8)),
                transition_ms: Some(60_000),
            },
            Some("12:00:00".to_string()),
            1_000_000,
        );

        sources.record_failure(&id, "boom".to_string(), 2_000_000);
        let output = sources.output(&id).expect("last good output retained");
        assert_eq!(output.computed_at_ms, 1_000_000);
        assert_eq!(
            output.quality,
            SourceQuality::Stale {
                message: "boom".to_string()
            }
        );
        assert!(output.profile.color.is_some());
        assert_eq!(sources.due_sources(2_000_000).len(), 0);

        let fresh = definition("other", true, 1, 60_000);
        sources.load_rows(vec![source.clone(), fresh.clone()]);
        sources.record_failure(&fresh.id, "never computed".to_string(), 3_000_000);
        assert!(sources.output(&fresh.id).is_none());
    }

    /// D09: the adapter publishes a read-only color sensor under the
    /// canonical `computed/<id>` key, and aliases map to it.
    #[test]
    fn d09_synthetic_device_is_read_only_and_aliases_resolve_to_it() {
        let definition = definition("circadian", true, 1, 60_000);
        let profile = LightProfile {
            color: Some(DeviceColor::new_from_kelvin(3000)),
            brightness: Some(OrderedFloat(0.8)),
            transition_ms: Some(60_000),
        };

        let device = synthetic_device(&definition, &profile);
        assert_eq!(device.get_device_key(), source_device_key(&definition.id));
        assert_eq!(
            device.integration_id,
            IntegrationId::from("computed".to_string())
        );
        let DeviceData::Sensor(SensorDevice::Color(state)) = &device.data else {
            panic!("expected a color sensor");
        };
        assert!(state.power);
        assert_eq!(state.brightness, Some(OrderedFloat(0.8)));
        assert_eq!(state.transition, Some(OrderedFloat(60.0)));

        let mut sources = Sources::default();
        sources.load_rows(vec![definition.clone()]);
        let aliases = sources.aliases();
        assert_eq!(aliases.len(), 1);
        assert_eq!(aliases[0].1, source_device_key(&definition.id));
    }

    #[test]
    fn evaluation_uses_the_source_timezone() {
        let definition = definition("circadian", true, 1, 60_000);
        // 2026-06-15 12:00:00 UTC is 15:00 in Helsinki (summer time).
        let noon_utc = chrono::DateTime::parse_from_rfc3339("2026-06-15T12:00:00Z")
            .unwrap()
            .timestamp_millis();
        let evaluation = evaluate_source(&definition, noon_utc).unwrap();
        assert_eq!(evaluation.local_time.as_deref(), Some("15:00:00"));
        assert_eq!(
            evaluation.profile.color,
            Some(DeviceColor::new_from_kelvin(3000))
        );
        assert_eq!(evaluation.profile.brightness, Some(OrderedFloat(0.8)));
    }

    #[test]
    fn unknown_timezone_is_reported_not_guessed() {
        let mut definition = definition("circadian", true, 1, 60_000);
        definition.timezone = "Mars/Olympus".to_string();
        let error = evaluate_source(&definition, 0).unwrap_err();
        assert!(error.contains("unknown timezone"));
    }
}
