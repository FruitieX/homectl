//! Computed source definitions and outputs (P11).
//!
//! A computed source is a server-owned owner that periodically computes a
//! typed output from pure inputs and publishes it through a read-only
//! synthetic device adapter, so existing scene device links keep working.
//! Definitions are DB-backed and versioned; the computed value and its
//! freshness live in actor state, never in the definition.
//!
//! Color units follow [`DeviceColor`]: color temperature is Kelvin, never
//! mireds. Optional brightness stays optional; absence is not silently
//! normalized to a default.

use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::automation_definition::SourceId;
use super::color::DeviceColor;
use super::device::DeviceKey;

/// Bounded, validated output of a light-profile source.
#[derive(TS, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct LightProfile {
    /// Explicit color, if the source produces one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<DeviceColor>,

    /// Optional brightness in `0.0..=1.0`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub brightness: Option<OrderedFloat<f32>>,

    /// Optional device transition in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transition_ms: Option<u64>,
}

impl LightProfile {
    /// Structural validation of the output contract. Applied to script
    /// results and to built-in preset output before it is published.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(brightness) = self.brightness {
            let value = brightness.into_inner();
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err("brightness must be finite and within 0.0..=1.0.".to_string());
            }
        }
        if let Some(transition_ms) = self.transition_ms {
            if transition_ms == 0 {
                return Err("transition_ms must be greater than zero when present.".to_string());
            }
        }
        Ok(())
    }
}

/// Freshness of the last computed output. A failed evaluation retains the
/// last good value as `stale`, never as healthy.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "quality", rename_all = "snake_case")]
#[ts(export)]
pub enum SourceQuality {
    Fresh,
    /// Evaluation failed; the last good output is retained and the message
    /// explains why it is not fresh.
    Stale {
        message: String,
    },
}

/// Last computed output plus provenance. `definition_revision` and
/// `computed_at_ms` let consumers detect stale or superseded results.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct SourceOutput {
    pub profile: LightProfile,
    pub quality: SourceQuality,
    pub definition_revision: i64,
    /// Wall-clock time of the successful computation this output came from.
    pub computed_at_ms: i64,
    /// Injected civil time used for the computation (`HH:MM:SS`), when the
    /// source computes against local time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub local_time: Option<String>,
}

/// Parameters of the versioned circadian-compatibility preset. Field units
/// are explicit: fade starts are `HH:MM` civil times, fade durations are
/// whole hours (matching the legacy integration), and color temperature is
/// Kelvin.
///
/// Unlike the legacy integration, the v2 preset validates strictly: zero or
/// negative durations, cross-midnight windows, overlapping fades, and
/// out-of-range brightness are reported instead of silently interpreted.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CircadianCompatParams {
    /// `HH:MM` local time when the night-to-day fade starts.
    pub day_fade_start: String,
    /// Whole hours the day fade takes. Must not cross midnight.
    pub day_fade_duration_hours: i64,
    pub day_color: DeviceColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub day_brightness: Option<f32>,

    /// `HH:MM` local time when the day-to-night fade starts.
    pub night_fade_start: String,
    /// Whole hours the night fade takes. Must not cross midnight.
    pub night_fade_duration_hours: i64,
    pub night_color: DeviceColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub night_brightness: Option<f32>,
}

/// How a computed source derives its output.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum SourceCompute {
    /// The versioned built-in circadian-compatibility preset. The pinned
    /// version means shipped preset updates never mutate existing rows; a
    /// fork writes a new definition instead.
    CircadianCompat {
        preset_version: u32,
        params: CircadianCompatParams,
    },
}

/// DB-backed computed source definition. The canonical device key is
/// `computed/<id>`; `aliases` lists legacy keys (for example
/// `circadian/color`) that resolve to the same single entity so group
/// membership is not double-counted.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct SourceDefinition {
    pub id: SourceId,
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    /// Definition revision; bumped on every write so consumers can reject
    /// superseded results.
    #[serde(default = "default_source_revision")]
    pub revision: i64,
    /// IANA zone used to derive civil time for the computation.
    pub timezone: String,
    /// Refresh cadence in milliseconds. Startup always computes once.
    #[serde(default = "default_source_refresh_interval_ms")]
    pub refresh_interval_ms: u64,
    /// Legacy device keys this source also answers for.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<DeviceKey>,
    pub compute: SourceCompute,
}

fn default_source_revision() -> i64 {
    1
}

/// Legacy circadian poll rate, kept as the default refresh cadence.
pub const DEFAULT_SOURCE_REFRESH_INTERVAL_MS: u64 = 60_000;

fn default_source_refresh_interval_ms() -> u64 {
    DEFAULT_SOURCE_REFRESH_INTERVAL_MS
}
