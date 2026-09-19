//! Shipped computed-source presets (P11, D10).
//!
//! Presets are application assets: a pinned id/version selects the shipped
//! JavaScript body and its parameter contract, so saved definitions never
//! change when a new preset version ships. Forking copies the body into the
//! definition (DB-backed) and drops the pin; the shipped asset is never
//! mutated for other users.

use serde_json::Value;

use crate::core::automation::sources::{CircadianCompatCurve, CIRCADIAN_COMPAT_PRESET_VERSION};
use crate::types::automation_source::{
    CircadianCompatParams, SourceCompute, SourcePresetInfo, SourcePresetRef,
};
use crate::types::color::DeviceColor;

/// Upper bound on an inline (forked or hand-written) script body.
pub const MAX_SOURCE_SCRIPT_BYTES: usize = 64 * 1024;

/// One shipped preset version.
#[derive(Clone, Copy, Debug)]
pub struct SourcePreset {
    pub id: &'static str,
    pub version: u32,
    pub name: &'static str,
    pub description: &'static str,
    /// Canonical default parameter object (JSON) for the authoring form.
    pub default_params: &'static str,
    /// Function body executed by the supervised worker.
    pub source_body: &'static str,
}

const CIRCADIAN_V1_PARAMS: &str = r#"{
  "day_fade_start": "06:00",
  "day_fade_duration_hours": 2,
  "day_color": { "ct": 3000 },
  "day_brightness": 0.8,
  "night_fade_start": "20:00",
  "night_fade_duration_hours": 2,
  "night_color": { "ct": 2000 },
  "night_brightness": 0.2
}"#;

static PRESETS: &[SourcePreset] = &[SourcePreset {
    id: "circadian",
    version: 1,
    name: "Circadian",
    description: "Forkable JavaScript port of the circadian curve: linear day fade, \
sine-eased night fade, Kelvin or HS interpolation, optional brightness.",
    default_params: CIRCADIAN_V1_PARAMS,
    source_body: include_str!("presets/circadian_v1.js"),
}];

/// Every shipped preset version, newest metadata for authoring forms.
pub fn presets() -> &'static [SourcePreset] {
    PRESETS
}

pub fn find_preset(id: &str, version: u32) -> Option<&'static SourcePreset> {
    PRESETS
        .iter()
        .find(|preset| preset.id == id && preset.version == version)
}

/// Preset metadata for the API, including the body so the UI can display and
/// fork it.
pub fn preset_infos() -> Vec<SourcePresetInfo> {
    PRESETS
        .iter()
        .map(|preset| SourcePresetInfo {
            id: preset.id.to_string(),
            version: preset.version,
            name: preset.name.to_string(),
            description: preset.description.to_string(),
            default_params: serde_json::from_str(preset.default_params)
                .expect("shipped preset defaults are valid JSON"),
            source_body: preset.source_body.to_string(),
        })
        .collect()
}

/// Validate the script arm of a source definition. Shipped presets validate
/// their pinned parameters strictly; inline bodies are bounded but otherwise
/// opaque. Exactly one source of truth is allowed (D10).
pub fn validate_script_compute(compute: &SourceCompute) -> Result<(), String> {
    let SourceCompute::Script {
        preset,
        source_body,
        params,
    } = compute
    else {
        return Ok(());
    };

    match (preset, source_body) {
        (Some(_), Some(_)) => Err(
            "compute: a script source pins a shipped preset or carries an inline body, not both."
                .to_string(),
        ),
        (None, None) => Err(
            "compute: a script source needs a pinned preset or an inline source_body.".to_string(),
        ),
        (Some(preset_ref), None) => {
            let Some(preset) = find_preset(&preset_ref.id, preset_ref.version) else {
                return Err(format!(
                    "compute.preset: unknown preset {}/{}.",
                    preset_ref.id, preset_ref.version
                ));
            };
            validate_preset_params(preset, params)
        }
        (None, Some(body)) => {
            if body.trim().is_empty() {
                return Err("compute.source_body: must not be empty.".to_string());
            }
            if body.len() > MAX_SOURCE_SCRIPT_BYTES {
                return Err(format!(
                    "compute.source_body: {} bytes exceed the {MAX_SOURCE_SCRIPT_BYTES}-byte limit.",
                    body.len()
                ));
            }
            Ok(())
        }
    }
}

/// Strict parameter validation for a shipped preset. Ambiguous parameters are
/// reported, never silently interpreted (D03).
pub fn validate_preset_params(preset: &SourcePreset, params: &Value) -> Result<(), String> {
    match (preset.id, preset.version) {
        ("circadian", 1) => {
            let parsed: CircadianCompatParams = serde_json::from_value(params.clone())
                .map_err(|error| format!("compute.params: {error}"))?;
            CircadianCompatCurve::from_params(&parsed)
                .map_err(|error| format!("compute.params: {error}"))?;
            let same_kind = matches!(
                (&parsed.day_color, &parsed.night_color),
                (DeviceColor::Ct(_), DeviceColor::Ct(_)) | (DeviceColor::Hs(_), DeviceColor::Hs(_))
            );
            if !same_kind {
                return Err(
                    "compute.params: the scripted circadian preset supports Kelvin/Kelvin or HS/HS \
                     color pairs; keep mixed pairs on the circadian_compat preset."
                        .to_string(),
                );
            }
            Ok(())
        }
        _ => Err(format!(
            "compute.preset: unknown preset {}/{}.",
            preset.id, preset.version
        )),
    }
}

/// The body a script source should execute: the shipped asset for a pinned
/// preset, the inline body for a fork.
pub fn resolve_source_body(compute: &SourceCompute) -> Result<String, String> {
    let SourceCompute::Script {
        preset,
        source_body,
        ..
    } = compute
    else {
        return Err("computed source is not script-based".to_string());
    };
    match (preset, source_body) {
        (Some(preset_ref), None) => find_preset(&preset_ref.id, preset_ref.version)
            .map(|preset| preset.source_body.to_string())
            .ok_or_else(|| format!("unknown preset {}/{}", preset_ref.id, preset_ref.version)),
        (None, Some(body)) => Ok(body.clone()),
        _ => Err("script source must pin a preset or carry an inline body".to_string()),
    }
}

/// Pinned identity of the circadian-compatibility preset, for callers that
/// need to reason about parity between the built-in and scripted presets.
pub fn circadian_preset_ref() -> SourcePresetRef {
    SourcePresetRef {
        id: "circadian".to_string(),
        version: CIRCADIAN_COMPAT_PRESET_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn script_preset() -> SourceCompute {
        SourceCompute::Script {
            preset: Some(SourcePresetRef {
                id: "circadian".to_string(),
                version: 1,
            }),
            source_body: None,
            params: serde_json::from_str(CIRCADIAN_V1_PARAMS).unwrap(),
        }
    }

    /// D10: the shipped preset is an immutable asset; validation pins its
    /// version and rejects unknown ones instead of falling back.
    #[test]
    fn p11_preset_pinning_is_strict() {
        validate_script_compute(&script_preset()).unwrap();

        let unknown = SourceCompute::Script {
            preset: Some(SourcePresetRef {
                id: "circadian".to_string(),
                version: 99,
            }),
            source_body: None,
            params: json!({}),
        };
        assert!(validate_script_compute(&unknown)
            .unwrap_err()
            .contains("unknown preset"));

        let both = SourceCompute::Script {
            preset: Some(circadian_preset_ref()),
            source_body: Some("return {};".to_string()),
            params: json!({}),
        };
        assert!(validate_script_compute(&both)
            .unwrap_err()
            .contains("not both"));

        let neither = SourceCompute::Script {
            preset: None,
            source_body: None,
            params: json!({}),
        };
        assert!(validate_script_compute(&neither)
            .unwrap_err()
            .contains("needs a pinned preset"));

        let empty_body = SourceCompute::Script {
            preset: None,
            source_body: Some("   ".to_string()),
            params: json!({}),
        };
        assert!(validate_script_compute(&empty_body)
            .unwrap_err()
            .contains("must not be empty"));
    }

    #[test]
    fn p11_preset_params_are_validated_strictly() {
        let mut overlapping = script_preset();
        let SourceCompute::Script { params, .. } = &mut overlapping else {
            panic!("fixture is script-based");
        };
        params["day_fade_duration_hours"] = json!(16);
        assert!(validate_script_compute(&overlapping)
            .unwrap_err()
            .contains("overlap"));

        let mut mixed = script_preset();
        let SourceCompute::Script { params, .. } = &mut mixed else {
            panic!("fixture is script-based");
        };
        params["night_color"] = json!({ "h": 200, "s": 0.5 });
        assert!(validate_script_compute(&mixed)
            .unwrap_err()
            .contains("Kelvin/Kelvin or HS/HS"));

        let hs = SourceCompute::Script {
            preset: Some(circadian_preset_ref()),
            source_body: None,
            params: json!({
                "day_fade_start": "06:00",
                "day_fade_duration_hours": 2,
                "day_color": { "h": 60, "s": 1.0 },
                "day_brightness": null,
                "night_fade_start": "20:00",
                "night_fade_duration_hours": 2,
                "night_color": { "h": 240, "s": 1.0 },
                "night_brightness": null
            }),
        };
        validate_script_compute(&hs).unwrap();
    }

    #[test]
    fn p11_preset_bodies_resolve_and_defaults_are_valid() {
        for preset in presets() {
            let params: Value = serde_json::from_str(preset.default_params).unwrap();
            validate_preset_params(preset, &params).unwrap();
            assert!(!preset.source_body.trim().is_empty());
        }

        let body = resolve_source_body(&script_preset()).unwrap();
        assert!(body.contains("api.color.mix"));

        let inline = SourceCompute::Script {
            preset: None,
            source_body: Some("return { value: { ct: 1 } };".to_string()),
            params: json!({}),
        };
        assert_eq!(
            resolve_source_body(&inline).unwrap(),
            "return { value: { ct: 1 } };"
        );

        let compat = SourceCompute::CircadianCompat {
            preset_version: CIRCADIAN_COMPAT_PRESET_VERSION,
            params: serde_json::from_str(CIRCADIAN_V1_PARAMS).unwrap(),
        };
        assert!(resolve_source_body(&compat).is_err());
    }
}
