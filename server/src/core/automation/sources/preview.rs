//! Stateless computed-source preview (P12).
//!
//! The source editor needs to show the curve it is authoring before the
//! definition is saved. The preview samples one local day through the same
//! pure evaluation path the runtime uses ([`super::registry::evaluate_compute`]),
//! so it cannot drift from the published output. Script sources normally run
//! through the supervised worker; the preview only stands in for the shipped
//! circadian preset, which golden tests pin to the built-in curve.

use crate::core::automation::calendar::parse_schedule_zone;
use crate::core::automation::sources::registry::evaluate_compute;
use crate::core::automation::sources::{
    validate_script_compute, CircadianCompatCurve, CIRCADIAN_COMPAT_PRESET_VERSION,
};
use crate::types::automation_source::{
    SourceCompute, SourcePreview, SourcePreviewRequest, SourcePreviewSample,
    DEFAULT_SOURCE_PREVIEW_SAMPLES, SOURCE_PREVIEW_SAMPLE_BOUNDS,
};

const MILLIS_PER_DAY: i64 = 86_400_000;

/// What the synchronous preview can do with a draft compute.
enum Previewable {
    /// Evaluate this compute at each sample instant.
    Compute(SourceCompute, Option<String>),
    /// No synchronous evaluation exists; report why instead of guessing.
    Unsupported(String),
}

/// Sample one local day of a draft source definition.
pub fn preview_source(
    request: &SourcePreviewRequest,
    now_wall_ms: i64,
) -> Result<SourcePreview, String> {
    validate_preview_request(request)?;

    let samples = request.samples.unwrap_or(DEFAULT_SOURCE_PREVIEW_SAMPLES);
    let zone = parse_schedule_zone(&request.timezone)
        .ok_or_else(|| format!("timezone: unknown timezone {:?}.", request.timezone))?;
    let now = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_wall_ms)
        .ok_or_else(|| format!("invalid wall time {now_wall_ms}"))?;
    let day_start = zone.local_midnight(now);
    let step_ms = MILLIS_PER_DAY / i64::from(samples);
    let day_start_ms = day_start.timestamp_millis();

    let (compute, note) = match previewable_compute(&request.compute)? {
        Previewable::Unsupported(reason) => {
            return Ok(SourcePreview {
                timezone: request.timezone.clone(),
                day_start_ms,
                step_ms,
                samples: Vec::new(),
                unsupported_reason: Some(reason),
                note: None,
            });
        }
        Previewable::Compute(compute, note) => (compute, note),
    };

    let mut sampled = Vec::with_capacity(samples as usize);
    for index in 0..samples {
        let time_ms = day_start_ms + i64::from(index) * step_ms;
        let evaluation = evaluate_compute(&request.timezone, &compute, time_ms)?;
        let local_time = evaluation
            .local_time
            .map(|label| label[..5].to_string())
            .unwrap_or_default();
        sampled.push(SourcePreviewSample {
            time_ms,
            local_time,
            profile: evaluation.profile,
        });
    }

    Ok(SourcePreview {
        timezone: request.timezone.clone(),
        day_start_ms,
        step_ms,
        samples: sampled,
        unsupported_reason: None,
        note,
    })
}

/// Resolve a draft compute into something the synchronous path can evaluate.
/// Custom script bodies run in the worker and have no synchronous preview.
fn previewable_compute(compute: &SourceCompute) -> Result<Previewable, String> {
    match compute {
        SourceCompute::CircadianCompat { .. } => Ok(Previewable::Compute(compute.clone(), None)),
        SourceCompute::Script {
            preset: Some(preset),
            source_body: None,
            params,
        } if preset.id == "circadian" && preset.version == 1 => {
            let parsed = serde_json::from_value(params.clone())
                .map_err(|error| format!("compute.params: {error}"))?;
            Ok(Previewable::Compute(
                SourceCompute::CircadianCompat {
                    preset_version: CIRCADIAN_COMPAT_PRESET_VERSION,
                    params: parsed,
                },
                Some(
                    "Previewed with the built-in circadian curve; the pinned script preset \
                     matches it within the tested rounding tolerance."
                        .to_string(),
                ),
            ))
        }
        SourceCompute::Script {
            preset: Some(preset),
            ..
        } => Err(format!(
            "compute.preset: unknown preset {}/{}.",
            preset.id, preset.version
        )),
        SourceCompute::Script { .. } => Ok(Previewable::Unsupported(
            "Custom scripts run in the worker and cannot be previewed synchronously.".to_string(),
        )),
    }
}

/// Validate a draft compute the same way a stored source is validated, so the
/// preview reports the same ambiguity errors as saving.
fn validate_preview_request(request: &SourcePreviewRequest) -> Result<(), String> {
    if parse_schedule_zone(&request.timezone).is_none() {
        return Err(format!(
            "timezone: unknown timezone {:?}.",
            request.timezone
        ));
    }
    let samples = request.samples.unwrap_or(DEFAULT_SOURCE_PREVIEW_SAMPLES);
    if !SOURCE_PREVIEW_SAMPLE_BOUNDS.contains(&samples) {
        return Err(format!(
            "samples: must be within {}..={}, got {samples}.",
            SOURCE_PREVIEW_SAMPLE_BOUNDS.start(),
            SOURCE_PREVIEW_SAMPLE_BOUNDS.end()
        ));
    }
    match &request.compute {
        SourceCompute::CircadianCompat {
            preset_version,
            params,
        } => {
            if *preset_version != CIRCADIAN_COMPAT_PRESET_VERSION {
                return Err(format!(
                    "compute.preset_version: unsupported circadian preset version {preset_version}."
                ));
            }
            CircadianCompatCurve::from_params(params)
                .map_err(|error| format!("compute.params: {error}"))?;
        }
        script @ SourceCompute::Script { .. } => validate_script_compute(script)?,
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::automation_source::{CircadianCompatParams, SourcePresetRef};
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

    fn request(compute: SourceCompute, samples: Option<u32>) -> SourcePreviewRequest {
        SourcePreviewRequest {
            timezone: "Europe/Helsinki".to_string(),
            compute,
            samples,
        }
    }

    #[test]
    fn preview_samples_one_local_day_and_matches_the_runtime_curve() {
        let compute = SourceCompute::CircadianCompat {
            preset_version: CIRCADIAN_COMPAT_PRESET_VERSION,
            params: params(),
        };
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-20T09:00:00Z")
            .unwrap()
            .timestamp_millis();
        let preview = preview_source(&request(compute.clone(), Some(48)), now).unwrap();

        assert_eq!(preview.samples.len(), 48);
        assert_eq!(preview.step_ms, 1_800_000);
        assert!(preview.unsupported_reason.is_none());
        assert!(preview.note.is_none());
        assert_eq!(preview.samples[0].local_time, "00:00");

        // Local midnight in Helsinki (UTC+3 in September).
        let expected_start = chrono::DateTime::parse_from_rfc3339("2026-09-19T21:00:00Z")
            .unwrap()
            .timestamp_millis();
        assert_eq!(preview.day_start_ms, expected_start);

        let evaluation =
            evaluate_compute(&preview.timezone, &compute, preview.samples[24].time_ms).unwrap();
        assert_eq!(preview.samples[24].profile, evaluation.profile);
    }

    #[test]
    fn script_preset_previews_with_a_note_and_custom_bodies_are_unsupported() {
        let preset = preview_source(
            &request(
                SourceCompute::Script {
                    preset: Some(SourcePresetRef {
                        id: "circadian".to_string(),
                        version: 1,
                    }),
                    source_body: None,
                    params: serde_json::to_value(params()).unwrap(),
                },
                None,
            ),
            0,
        )
        .unwrap();
        assert_eq!(
            preset.samples.len(),
            DEFAULT_SOURCE_PREVIEW_SAMPLES as usize
        );
        assert!(preset.note.is_some());
        assert!(preset.unsupported_reason.is_none());

        let custom = preview_source(
            &request(
                SourceCompute::Script {
                    preset: None,
                    source_body: Some("return { color: null };".to_string()),
                    params: serde_json::Value::Null,
                },
                None,
            ),
            0,
        )
        .unwrap();
        assert!(custom.samples.is_empty());
        assert!(custom.unsupported_reason.is_some());
    }

    #[test]
    fn sample_bounds_timezone_and_params_are_reported() {
        let compute = SourceCompute::CircadianCompat {
            preset_version: CIRCADIAN_COMPAT_PRESET_VERSION,
            params: params(),
        };

        let too_few = preview_source(&request(compute.clone(), Some(4)), 0).unwrap_err();
        assert!(too_few.contains("samples"), "{too_few}");

        let mut bad_zone = request(compute.clone(), None);
        bad_zone.timezone = "Mars/Olympus".to_string();
        assert!(preview_source(&bad_zone, 0)
            .unwrap_err()
            .contains("timezone"));

        let mut bad_params = request(compute, None);
        let SourceCompute::CircadianCompat { params, .. } = &mut bad_params.compute else {
            panic!("fixture is the built-in preset");
        };
        params.day_fade_duration_hours = 16;
        assert!(preview_source(&bad_params, 0)
            .unwrap_err()
            .contains("overlap"));
    }
}
