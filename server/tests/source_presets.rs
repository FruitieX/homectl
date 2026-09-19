//! P11: the shipped scripted preset through the real worker.
//!
//! D01/D02 direction: the forkable JavaScript preset reproduces the frozen
//! circadian oracle within a fixed whole-Kelvin rounding tolerance for
//! Kelvin pairs, and the HS arc / optional-brightness behavior is pinned
//! explicitly. D10 direction: forked inline bodies run through the same
//! source context without touching the shipped asset.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{NaiveDate, NaiveTime};
use homectl_server::core::automation::sources::presets::presets as source_presets;
use homectl_server::core::automation::sources::{self, CircadianCompatCurve, SourcePreset};
use homectl_server::core::automation::{parse_computed_source_outcome, MAX_SCRIPT_STATE_BYTES};
use homectl_server::core::js_worker::{JsWorkerPool, SupervisorConfig};
use homectl_server::types::automation_definition::SourceId;
use homectl_server::types::automation_source::{
    CircadianCompatParams, LightProfile, SourceCompute, SourceDefinition, SourcePresetRef,
};
use homectl_server::types::color::DeviceColor;
use serde_json::{json, Value};

fn worker_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_script-worker"))
}

async fn test_pool() -> JsWorkerPool {
    JsWorkerPool::new(SupervisorConfig {
        worker_binary: Some(worker_binary()),
        workers: 2,
        invocation_timeout: Duration::from_secs(2),
        ..SupervisorConfig::default()
    })
    .await
    .expect("spawn worker pool")
}

fn circadian_preset() -> &'static SourcePreset {
    source_presets()
        .iter()
        .find(|preset| preset.id == "circadian" && preset.version == 1)
        .expect("the circadian preset ships with this build")
}

fn script_definition(params: Value) -> SourceDefinition {
    SourceDefinition {
        id: SourceId("circadian".to_string()),
        name: "Circadian".to_string(),
        enabled: true,
        revision: 1,
        timezone: "UTC".to_string(),
        refresh_interval_ms: 60_000,
        aliases: vec![],
        compute: SourceCompute::Script {
            preset: Some(SourcePresetRef {
                id: "circadian".to_string(),
                version: 1,
            }),
            source_body: None,
            params,
        },
    }
}

async fn run_body(
    pool: &JsWorkerPool,
    definition: &SourceDefinition,
    body: &str,
    hour: u32,
    minute: u32,
) -> LightProfile {
    let wall_ms = NaiveDate::from_ymd_opt(2026, 6, 1)
        .unwrap()
        .and_hms_opt(hour, minute, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let (context, _label) = sources::script_context(definition, wall_ms).unwrap();
    let raw = pool.execute(body, context).await.unwrap();
    let outcome = parse_computed_source_outcome(&raw, MAX_SCRIPT_STATE_BYTES).unwrap();
    let profile: LightProfile = serde_json::from_value(outcome.value).unwrap();
    profile.validate().unwrap();
    profile
}

async fn run_preset(
    pool: &JsWorkerPool,
    definition: &SourceDefinition,
    hour: u32,
    minute: u32,
) -> LightProfile {
    run_body(
        pool,
        definition,
        circadian_preset().source_body,
        hour,
        minute,
    )
    .await
}

#[tokio::test]
async fn p11_scripted_preset_matches_the_frozen_oracle_within_rounding() {
    let pool = test_pool().await;
    let params_value: Value = serde_json::from_str(circadian_preset().default_params).unwrap();
    let params: CircadianCompatParams = serde_json::from_value(params_value.clone()).unwrap();
    let curve = CircadianCompatCurve::from_params(&params).unwrap();
    let definition = script_definition(params_value);

    for (hour, minute) in [
        (3, 0),
        (6, 0),
        (6, 30),
        (7, 0),
        (7, 30),
        (8, 0),
        (12, 0),
        (20, 0),
        (20, 30),
        (21, 0),
        (21, 30),
        (22, 0),
        (23, 0),
    ] {
        let profile = run_preset(&pool, &definition, hour, minute).await;
        let expected = curve.profile_at(NaiveTime::from_hms_opt(hour, minute, 0).unwrap());

        let (Some(DeviceColor::Ct(actual)), Some(DeviceColor::Ct(want))) =
            (profile.color.clone(), expected.color.clone())
        else {
            panic!("expected Kelvin colors at {hour}:{minute:02}");
        };
        assert!(
            (actual.ct as i64 - want.ct as i64).abs() <= 1,
            "kelvin mismatch at {hour}:{minute:02}: got {}, want {}",
            actual.ct,
            want.ct
        );

        match (profile.brightness, expected.brightness) {
            (Some(actual), Some(want)) => assert!(
                (actual.into_inner() - want.into_inner()).abs() < 1e-6,
                "brightness mismatch at {hour}:{minute:02}"
            ),
            (None, None) => {}
            other => panic!("brightness presence mismatch at {hour}:{minute:02}: {other:?}"),
        }
        assert_eq!(profile.transition_ms, expected.transition_ms);
    }

    pool.shutdown().await;
}

#[tokio::test]
async fn p11_scripted_preset_hs_arc_and_optional_brightness_are_pinned() {
    let pool = test_pool().await;
    let params = json!({
        "day_fade_start": "06:00",
        "day_fade_duration_hours": 2,
        "day_color": { "h": 60, "s": 1.0 },
        "night_fade_start": "20:00",
        "night_fade_duration_hours": 2,
        "night_color": { "h": 200, "s": 0.5 }
    });
    let definition = script_definition(params);

    // Daytime: the day endpoint exactly, and no brightness because neither
    // end declares one.
    let noon = run_preset(&pool, &definition, 12, 0).await;
    assert_eq!(noon.color, Some(DeviceColor::new_from_hs(60, 1.0)));
    assert_eq!(noon.brightness, None);

    // Mid night fade: shortest hue arc (60 -> 200 is +140) and saturation
    // interpolation.
    let fade = run_preset(&pool, &definition, 21, 0).await;
    let i = (std::f64::consts::PI / 4.0).sin();
    let expected_hue = ((60.0 + 140.0 * i).round() as i64).rem_euclid(360) as u16;
    let expected_saturation = 1.0 + (0.5 - 1.0) * i;
    let Some(DeviceColor::Hs(hs)) = fade.color else {
        panic!("expected an HS color, got {:?}", fade.color);
    };
    assert_eq!(hs.h, expected_hue as u64);
    assert!((hs.s.into_inner() as f64 - expected_saturation).abs() < 1e-6);

    // Night: the night endpoint exactly.
    let night = run_preset(&pool, &definition, 23, 0).await;
    assert_eq!(night.color, Some(DeviceColor::new_from_hs(200, 0.5)));

    pool.shutdown().await;
}

#[tokio::test]
async fn p11_forked_inline_body_runs_through_the_source_context() {
    let pool = test_pool().await;
    let definition = SourceDefinition {
        id: SourceId("custom".to_string()),
        name: "Custom".to_string(),
        enabled: true,
        revision: 1,
        timezone: "UTC".to_string(),
        refresh_interval_ms: 60_000,
        aliases: vec![],
        compute: SourceCompute::Script {
            preset: None,
            source_body: Some(
                "var p = ctx.params;\n\
                 var dayStart = api.time.parseHHMM(p.start);\n\
                 var lit = api.time.minutes() >= dayStart;\n\
                 return { value: {\n\
                   color: api.color.kelvin(lit ? p.day_kelvin : p.night_kelvin),\n\
                   brightness: lit ? p.day_brightness : p.night_brightness,\n\
                   transition_ms: p.transition_ms\n\
                 } };\n"
                    .to_string(),
            ),
            params: json!({
                "start": "07:00",
                "day_kelvin": 4000,
                "night_kelvin": 2000,
                "day_brightness": 0.9,
                "night_brightness": 0.1,
                "transition_ms": 1500
            }),
        },
    };

    let body = match &definition.compute {
        SourceCompute::Script {
            source_body: Some(body),
            ..
        } => body.clone(),
        other => panic!("expected an inline script, got {other:?}"),
    };

    let morning = run_body(&pool, &definition, &body, 8, 0).await;
    assert_eq!(morning.color, Some(DeviceColor::new_from_kelvin(4000)));
    assert_eq!(
        morning.brightness.map(|value| value.into_inner()),
        Some(0.9)
    );
    assert_eq!(morning.transition_ms, Some(1500));

    let night = run_body(&pool, &definition, &body, 2, 0).await;
    assert_eq!(night.color, Some(DeviceColor::new_from_kelvin(2000)));

    // The shipped preset is untouched by the fork (D10): resolving the pinned
    // definition still yields the asset body.
    let pinned = resolve_asset_body();
    assert!(pinned.contains("api.color.mix"));
    assert!(!pinned.contains("p.day_kelvin"));

    pool.shutdown().await;
}

fn resolve_asset_body() -> String {
    let definition = script_definition(json!({}));
    sources::resolve_source_body(&definition.compute).unwrap()
}
