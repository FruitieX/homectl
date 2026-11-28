//! Temperature-based warm-up for ready-by timers.
//!
//! A heater (e.g. a car's engine and cabin heater) changes what a sensor
//! measures roughly linearly once it gets going: nothing for a few minutes,
//! then a steady rise. The model is learned per heater/sensor pair from the
//! heater's own runs, whether a timer or a person switched it on, and a
//! ready-by timer starts early enough to reach its target by the ready time.
use crate::{
    core::snapshot::RuntimeSnapshot,
    types::{
        device::{DeviceKey, SensorDevice},
        user_timer::{HeatingModel, ReadyByTemperature, UserTimerAction, UserTimers},
    },
};
use std::collections::HashMap;

/// Used until a pair has learned from its own runs: deliberately on the slow
/// side, so a first warm-up starts too early rather than too late.
pub const DEFAULT_RATE_PER_MINUTE: f64 = 0.15;
pub const DEFAULT_LAG_MINUTES: f64 = 10.0;
/// Weight of the newest run in the learned rate and lag.
const LEARNING_WEIGHT: f64 = 0.3;
const MIN_RUN_MINUTES: f64 = 20.0;
const MIN_RISE: f64 = 1.0;
const MAX_LAG_MINUTES: u32 = 20;
const SAMPLE_INTERVAL_MS: i64 = 60_000;
const MAX_SAMPLES: usize = 6 * 60;

fn parse_key(key: &str) -> Option<DeviceKey> {
    serde_json::from_value(serde_json::json!(key)).ok()
}

/// Current numeric value of a sensor reading (a single-value sensor ignores
/// the reading name).
pub fn reading(snapshot: &RuntimeSnapshot, sensor_key: &str, reading: &str) -> Option<f64> {
    let device = snapshot.devices.0.get(&parse_key(sensor_key)?)?;
    let value = match device.get_sensor_state()? {
        SensorDevice::Number { value } => Some(*value),
        SensorDevice::Readings { readings } => readings.get(reading)?.as_f64(),
        _ => None,
    }?;
    value.is_finite().then_some(value)
}

fn device_on(snapshot: &RuntimeSnapshot, device_key: &str) -> Option<bool> {
    let device = snapshot.devices.0.get(&parse_key(device_key)?)?;
    Some(device.get_controllable_state()?.power)
}

pub fn model<'a>(
    catalog: &'a UserTimers,
    device_key: &str,
    t: &ReadyByTemperature,
) -> Option<&'a HeatingModel> {
    catalog.heating_models.iter().find(|m| {
        m.device_key == device_key && m.sensor_key == t.sensor_key && m.reading == t.reading
    })
}

/// The heater a temperature-based timer switches on.
pub fn heater_key(action: &UserTimerAction) -> Option<&str> {
    match action {
        UserTimerAction::Device {
            device_key,
            power: true,
        } => Some(device_key),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub minutes: u32,
    pub note: String,
}

/// Minutes of warm-up needed to reach the target from `current`.
pub fn minutes_needed(current: f64, target: f64, rate: f64, lag: f64, max: u32) -> u32 {
    let rise = target - current;
    if rise <= 0.0 {
        return 0;
    }
    let minutes = (lag + rise / rate.max(0.01)).ceil();
    (minutes as u32).min(max)
}

/// How long to warm up, from the live reading and the learned model. Without
/// a reading, the timer's fixed warm-up applies.
pub fn plan(
    snapshot: &RuntimeSnapshot,
    catalog: &UserTimers,
    action: &UserTimerAction,
    t: &ReadyByTemperature,
    fallback_minutes: u32,
) -> Plan {
    let Some(current) = reading(snapshot, &t.sensor_key, &t.reading) else {
        return Plan {
            minutes: fallback_minutes.min(t.max_warmup_minutes),
            note: format!("No temperature reading; warming up for {fallback_minutes} min"),
        };
    };
    let (rate, lag, learned) = heater_key(action)
        .and_then(|key| model(catalog, key, t))
        .map(|m| (m.rate_per_minute, m.lag_minutes, m.runs))
        .unwrap_or((DEFAULT_RATE_PER_MINUTE, DEFAULT_LAG_MINUTES, 0));
    let minutes = minutes_needed(current, t.target, rate, lag, t.max_warmup_minutes);
    let basis = if learned > 0 {
        format!("learned {:.2} °C/min from {learned} runs", rate)
    } else {
        format!("default {:.2} °C/min until a run is learned", rate)
    };
    let note = if minutes == 0 {
        format!(
            "{current:.1} °C, already at the {:.0} °C target; no warm-up needed",
            t.target
        )
    } else if minutes == t.max_warmup_minutes {
        format!(
            "{current:.1} °C → {:.0} °C: limited to {minutes} min ({basis})",
            t.target
        )
    } else {
        format!(
            "{current:.1} °C → {:.0} °C: about {minutes} min ({basis})",
            t.target
        )
    };
    Plan { minutes, note }
}

/// Least-squares fit of `rise = rate · max(0, minute − lag)`.
/// Returns `(rate, lag)` for the best whole-minute lag.
pub fn fit(samples: &[(f64, f64)]) -> Option<(f64, f64)> {
    let mut best: Option<(f64, f64, f64)> = None;
    for lag in 0..=MAX_LAG_MINUTES {
        let lag = f64::from(lag);
        let (mut xy, mut xx) = (0.0, 0.0);
        for (minute, rise) in samples {
            let x = (minute - lag).max(0.0);
            xy += x * rise;
            xx += x * x;
        }
        if xx <= 0.0 {
            continue;
        }
        let rate = xy / xx;
        let error: f64 = samples
            .iter()
            .map(|(minute, rise)| (rise - rate * (minute - lag).max(0.0)).powi(2))
            .sum();
        if best.is_none_or(|(e, _, _)| error < e) {
            best = Some((error, rate, lag));
        }
    }
    best.map(|(_, rate, lag)| (rate, lag))
}

/// Learn from one finished run. Runs that are short, barely change the
/// reading (heater unplugged, sensor elsewhere) or fit implausibly are
/// ignored.
pub fn learn(model: &mut HeatingModel, samples: &[(f64, f64)], now_ms: i64) -> bool {
    let Some(&(duration, _)) = samples.last() else {
        return false;
    };
    let rise = samples.iter().map(|(_, r)| *r).fold(f64::MIN, f64::max);
    if duration < MIN_RUN_MINUTES || samples.len() < 5 || rise < MIN_RISE {
        return false;
    }
    let Some((rate, lag)) = fit(samples) else {
        return false;
    };
    if !(0.02..=2.0).contains(&rate) {
        return false;
    }
    if model.runs == 0 {
        model.rate_per_minute = rate;
        model.lag_minutes = lag;
    } else {
        let w = LEARNING_WEIGHT;
        model.rate_per_minute = (1.0 - w) * model.rate_per_minute + w * rate;
        model.lag_minutes = (1.0 - w) * model.lag_minutes + w * lag;
    }
    model.runs = model.runs.saturating_add(1);
    model.updated_ms = Some(now_ms);
    true
}

struct Run {
    started_ms: i64,
    start_value: f64,
    last_sample_ms: i64,
    samples: Vec<(f64, f64)>,
}

/// Follows heater runs in memory. A run interrupted by a restart is not
/// learned from; the model only improves from complete runs.
#[derive(Default)]
pub struct RunTracker {
    runs: HashMap<(String, String, String), Run>,
}

impl RunTracker {
    /// Sample every heater/sensor pair used by a temperature-based timer.
    /// Returns models updated by runs that ended.
    pub fn observe(
        &mut self,
        snapshot: &RuntimeSnapshot,
        catalog: &UserTimers,
        now_ms: i64,
    ) -> Vec<HeatingModel> {
        let mut pairs = Vec::new();
        for entry in &catalog.timers {
            if let crate::types::user_timer::UserTimerSchedule::ReadyBy {
                temperature: Some(t),
                ..
            } = &entry.definition.schedule
            {
                if let Some(device) = heater_key(&entry.definition.action) {
                    let pair = (device.to_string(), t.sensor_key.clone(), t.reading.clone());
                    if !pairs.contains(&pair) {
                        pairs.push(pair);
                    }
                }
            }
        }
        self.runs.retain(|pair, _| pairs.contains(pair));
        let mut updated = Vec::new();
        for pair in pairs {
            let (device, sensor, name) = &pair;
            let on = device_on(snapshot, device);
            let value = reading(snapshot, sensor, name);
            match (on, self.runs.get_mut(&pair)) {
                (Some(true), None) => {
                    if let Some(value) = value {
                        self.runs.insert(
                            pair.clone(),
                            Run {
                                started_ms: now_ms,
                                start_value: value,
                                last_sample_ms: now_ms,
                                samples: vec![(0.0, 0.0)],
                            },
                        );
                    }
                }
                (Some(true), Some(run)) => {
                    if let Some(value) = value {
                        if now_ms - run.last_sample_ms >= SAMPLE_INTERVAL_MS
                            && run.samples.len() < MAX_SAMPLES
                        {
                            let minute = (now_ms - run.started_ms) as f64 / 60_000.0;
                            run.samples.push((minute, value - run.start_value));
                            run.last_sample_ms = now_ms;
                        }
                    }
                }
                (_, Some(_)) => {
                    let run = self.runs.remove(&pair).expect("present");
                    let mut model = catalog
                        .heating_models
                        .iter()
                        .find(|m| {
                            &m.device_key == device && &m.sensor_key == sensor && &m.reading == name
                        })
                        .cloned()
                        .unwrap_or(HeatingModel {
                            device_key: device.clone(),
                            sensor_key: sensor.clone(),
                            reading: name.clone(),
                            rate_per_minute: DEFAULT_RATE_PER_MINUTE,
                            lag_minutes: DEFAULT_LAG_MINUTES,
                            runs: 0,
                            updated_ms: None,
                        });
                    if learn(&mut model, &run.samples, now_ms) {
                        updated.push(model);
                    }
                }
                _ => {}
            }
        }
        updated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(rate: f64, lag: f64, minutes: u32) -> Vec<(f64, f64)> {
        (0..=minutes)
            .step_by(3)
            .map(|m| {
                let m = f64::from(m);
                // Readings come in 0.1 °C steps.
                (m, ((rate * (m - lag).max(0.0)) * 10.0).round() / 10.0)
            })
            .collect()
    }

    fn empty_model() -> HeatingModel {
        HeatingModel {
            device_key: "dummy/heater".into(),
            sensor_key: "dummy/car".into(),
            reading: "temperature".into(),
            rate_per_minute: DEFAULT_RATE_PER_MINUTE,
            lag_minutes: DEFAULT_LAG_MINUTES,
            runs: 0,
            updated_ms: None,
        }
    }

    #[test]
    fn fits_lag_and_rate_from_quantized_readings() {
        let (rate, lag) = fit(&run(0.24, 7.0, 45)).unwrap();
        assert!((rate - 0.24).abs() < 0.01, "{rate}");
        assert!((lag - 7.0).abs() <= 1.0, "{lag}");
    }

    #[test]
    fn first_run_replaces_the_default_and_later_runs_blend() {
        let mut m = empty_model();
        assert!(learn(&mut m, &run(0.24, 7.0, 45), 1));
        assert_eq!(m.runs, 1);
        assert!((m.rate_per_minute - 0.24).abs() < 0.01);
        assert!(learn(&mut m, &run(0.12, 7.0, 45), 2));
        assert!(m.rate_per_minute > 0.12 && m.rate_per_minute < 0.24);
        assert_eq!(m.runs, 2);
    }

    #[test]
    fn ignores_short_or_flat_runs() {
        let mut m = empty_model();
        assert!(!learn(&mut m, &run(0.24, 7.0, 15), 1));
        // Heater on but not warming anything (unplugged cable).
        assert!(!learn(&mut m, &run(0.01, 0.0, 60), 1));
        assert_eq!(m.runs, 0);
    }

    #[test]
    fn minutes_cover_lag_and_rise_within_the_limit() {
        assert_eq!(minutes_needed(-5.0, 5.0, 0.25, 7.0, 180), 47);
        assert_eq!(minutes_needed(6.0, 5.0, 0.25, 7.0, 180), 0);
        assert_eq!(minutes_needed(-30.0, 5.0, 0.1, 7.0, 120), 120);
    }
}
