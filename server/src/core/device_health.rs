//! Runtime receipt evidence and the single device-health evaluator. Receipt
//! clocks are monotonic; restored states and retained messages never reset them.
use crate::{
    db::config_queries::{ConfigExport, WidgetSettingRow},
    types::{
        device::DevicesState,
        device_health::*,
        logs::{LogEntityReference, LogLevel, UiLogEntry},
    },
};
use std::collections::{BTreeMap, BTreeSet};

pub fn policy_key(scope: &str, id: &str) -> String {
    format!("reporting/{scope}/{id}")
}
pub fn read_policy(config: &ConfigExport, scope: &str, id: &str) -> ReportingPolicy {
    config
        .widget_settings
        .iter()
        .find(|row| row.key == policy_key(scope, id))
        .and_then(|row| serde_json::from_value(row.config.clone()).ok())
        .unwrap_or_default()
}
pub fn policy_row(scope: &str, id: &str, policy: &ReportingPolicy) -> WidgetSettingRow {
    WidgetSettingRow {
        key: policy_key(scope, id),
        config: serde_json::to_value(policy).expect("policy serializes"),
    }
}
pub fn effective_policy(
    config: &ConfigExport,
    key: &str,
    integration: &str,
) -> EffectiveReportingPolicy {
    let device = read_policy(config, "device", key);
    let integration_policy = read_policy(config, "integration", integration);
    let (source, policy, description) = if device != ReportingPolicy::Inherit {
        ("device", device, "Device override".to_owned())
    } else if integration_policy != ReportingPolicy::Inherit {
        (
            "integration",
            integration_policy,
            format!("Default for {integration}"),
        )
    } else {
        let interval = if integration == "computed" {
            config
                .sources
                .iter()
                .find(|source| format!("computed/{}", source.id.0) == key)
                .map(|source| source.refresh_interval_ms.div_ceil(1000).max(1) as u32)
        } else {
            config
                .integrations
                .iter()
                .find(|row| row.id == integration)
                .and_then(|row| match row.plugin.as_str() {
                    "random" => Some(
                        row.config["strobe_interval"]
                            .as_u64()
                            .unwrap_or(1000)
                            .clamp(20, 10000)
                            .div_ceil(1000) as u32,
                    ),
                    "circadian" => Some(60),
                    _ => None,
                })
        };
        (
            "automatic",
            interval
                .map(|expected_interval_seconds| ReportingPolicy::Custom {
                    expected_interval_seconds,
                })
                .unwrap_or(ReportingPolicy::Inherit),
            if interval.is_some() {
                "Integration refresh cadence"
            } else {
                "No periodic reporting guarantee; explicit offline signals are still checked"
            }
            .to_owned(),
        )
    };
    let grace = match &policy {
        ReportingPolicy::Custom {
            expected_interval_seconds,
        } => ((*expected_interval_seconds as u64).div_ceil(10)).clamp(5, 300) as u32,
        _ => 0,
    };
    EffectiveReportingPolicy {
        source: source.into(),
        policy,
        description,
        scheduling_grace_seconds: grace,
    }
}
#[derive(Clone, Debug, Default)]
struct Observation {
    first_seen_mono: u64,
    fresh: Option<(i64, u64, u64)>, // wall, monotonic, event sequence
    cached_ms: Option<i64>,
    availability: Option<(bool, i64, u64)>, // online, observed wall, event sequence
}
#[derive(Default)]
pub struct HealthMonitor {
    observations: BTreeMap<String, Observation>,
    sequence: u64,
    ready_mono: Option<u64>,
    last_evaluated_mono: Option<u64>,
    dirty: bool,
    generation: u64,
    pub snapshot: DeviceHealthSnapshot,
    source_receipts: BTreeMap<String, (i64, i64)>,
    integration_epochs: BTreeMap<String, u64>,
}
impl HealthMonitor {
    pub fn connection_established(&mut self, integration: &str, mono: u64) {
        let prefix = format!("{integration}/");
        for (key, observation) in &mut self.observations {
            if key.starts_with(&prefix) {
                observation.first_seen_mono = mono;
            }
        }
        self.dirty = true;
    }
    pub fn integration_epoch(&mut self, integration: &str, epoch: u64, mono: u64) {
        if self
            .integration_epochs
            .insert(integration.into(), epoch)
            .is_some_and(|previous| previous != epoch)
        {
            self.connection_established(integration, mono);
        }
    }
    pub fn observe(&mut self, key: &str, retained: bool, wall: i64, mono: u64) {
        self.sequence = self.sequence.wrapping_add(1);
        let observation = self
            .observations
            .entry(key.into())
            .or_insert_with(|| Observation {
                first_seen_mono: mono,
                ..Default::default()
            });
        if retained {
            observation.cached_ms = Some(wall);
        } else {
            observation.fresh = Some((wall, mono, self.sequence));
        }
        self.dirty = true;
    }
    pub fn availability(&mut self, key: &str, online: bool, observed: i64, mono: u64) {
        self.sequence = self.sequence.wrapping_add(1);
        let observation = self
            .observations
            .entry(key.into())
            .or_insert_with(|| Observation {
                first_seen_mono: mono,
                ..Default::default()
            });
        // Retained availability may be displayed as cached evidence, but cannot
        // replace a fresh availability report or assert that a device is online.
        if observed > 0 {
            observation.availability = Some((online, observed, self.sequence));
            self.dirty = true;
        }
    }
    pub fn evaluate(
        &mut self,
        config: &ConfigExport,
        devices: &DevicesState,
        warming_up: bool,
        wall: i64,
        mono: u64,
        force: bool,
        source_errors: &BTreeMap<String, String>,
    ) -> Vec<UiLogEntry> {
        if !force
            && !self.dirty
            && self.snapshot.warming_up == warming_up
            && self
                .last_evaluated_mono
                .is_some_and(|last| mono.saturating_sub(last) < 5000)
        {
            return Vec::new();
        }
        self.dirty = false;
        self.last_evaluated_mono = Some(mono);
        self.generation = self.generation.wrapping_add(1);
        if warming_up {
            self.ready_mono = None;
        } else if self.ready_mono.is_none() {
            self.ready_mono = Some(mono);
        }
        let mut next = DeviceHealthSnapshot {
            evaluated_at_ms: wall,
            warming_up,
            ..Default::default()
        };
        let mut logs = Vec::new();
        for (key, device) in &devices.0 {
            let key = key.to_string();
            let integration = device.integration_id.to_string();
            let observation = self
                .observations
                .entry(key.clone())
                .or_insert_with(|| Observation {
                    first_seen_mono: mono,
                    ..Default::default()
                });
            let name = config
                .device_display_overrides
                .iter()
                .find(|row| row.device_key == key)
                .map(|row| row.display_name.clone())
                .unwrap_or_else(|| device.name.clone());
            let effective = effective_policy(config, &key, &integration);
            let disabled = config
                .integrations
                .iter()
                .find(|row| row.id == integration)
                .is_some_and(|row| {
                    !row.enabled
                        || crate::types::integration::device_is_disabled(
                            &row.config,
                            &device.id.to_string(),
                        )
                })
                || (integration == "computed"
                    && config
                        .sources
                        .iter()
                        .any(|row| row.id.0 == device.id.to_string() && !row.enabled));
            // A resumed device gets the same reporting grace as a newly seen
            // device. Keep historical receipt evidence visible.
            if !disabled
                && self
                    .snapshot
                    .devices
                    .get(&key)
                    .is_some_and(|old| old.status == "disabled")
            {
                observation.first_seen_mono = mono;
            }
            let mut health = DeviceHealth {
                device_key: key.clone(),
                integration_id: integration.clone(),
                name: name.clone(),
                status: if disabled {
                    "disabled"
                } else if warming_up {
                    "waiting"
                } else if observation.fresh.is_some() {
                    "healthy"
                } else if observation.cached_ms.is_some() {
                    "cached"
                } else {
                    "unknown"
                }
                .into(),
                effective_policy: effective,
                last_fresh_report_ms: observation.fresh.map(|entry| entry.0),
                last_cached_report_ms: observation.cached_ms,
                expected_by_ms: None,
                issues: Vec::new(),
            };
            if !disabled && !warming_up {
                if let ReportingPolicy::Custom {
                    expected_interval_seconds,
                } = health.effective_policy.policy
                {
                    let interval = (expected_interval_seconds as u64
                        + health.effective_policy.scheduling_grace_seconds as u64)
                        * 1000;
                    let startup = self
                        .ready_mono
                        .unwrap_or(mono)
                        .max(observation.first_seen_mono)
                        .saturating_add(interval.max(30_000));
                    let due = observation
                        .fresh
                        .map(|entry| entry.1.saturating_add(interval))
                        .unwrap_or(startup)
                        .max(startup);
                    health.expected_by_ms = Some(wall.saturating_add(due as i64 - mono as i64));
                    if mono > due {
                        let last = health
                            .last_fresh_report_ms
                            .and_then(chrono::DateTime::from_timestamp_millis)
                            .map(|time| time.to_rfc3339())
                            .unwrap_or_else(|| "startup (no fresh report received)".into());
                        health.issues.push(DeviceHealthIssue{code:"missing_report".into(),message:format!("{name} has not reported since {last}; expected within {expected_interval_seconds} seconds, plus {} seconds scheduling grace.",health.effective_policy.scheduling_grace_seconds)});
                        health.status = "late".into();
                    } else if observation.fresh.is_none() {
                        health.status = "waiting".into();
                    }
                } else if health.effective_policy.policy == ReportingPolicy::Ignore {
                    health.status = "ignored".into();
                }
                if let Some((false, _, sequence)) = observation.availability {
                    if observation.fresh.is_none_or(|entry| sequence > entry.2) {
                        health.issues.push(DeviceHealthIssue {
                            code: "offline".into(),
                            message: format!("{name} was reported offline by {integration}."),
                        });
                        health.status = "offline".into();
                    }
                }
                if let Some(error) = source_errors.get(&key) {
                    health.issues.push(DeviceHealthIssue {
                        code: "source_error".into(),
                        message: format!("{name} could not compute a fresh value: {error}"),
                    });
                    health.status = "error".into();
                }
            }
            let previous = self.snapshot.devices.get(&key);
            let old_codes = previous
                .map(|row| {
                    row.issues
                        .iter()
                        .map(|issue| issue.code.as_str())
                        .collect::<BTreeSet<_>>()
                })
                .unwrap_or_default();
            let new_codes = health
                .issues
                .iter()
                .map(|issue| issue.code.as_str())
                .collect::<BTreeSet<_>>();
            let references = vec![
                LogEntityReference {
                    entity: "device".into(),
                    entity_id: key.clone(),
                },
                LogEntityReference {
                    entity: if integration == "computed" {
                        "source"
                    } else {
                        "integration"
                    }
                    .into(),
                    entity_id: if integration == "computed" {
                        device.id.to_string()
                    } else {
                        integration.clone()
                    },
                },
            ];
            for issue in &health.issues {
                if !old_codes.contains(issue.code.as_str()) {
                    logs.push(UiLogEntry{timestamp:chrono::DateTime::from_timestamp_millis(wall).unwrap_or_default().to_rfc3339(),level:LogLevel::Warn,target:"homectl_server::device_health".into(),message:issue.message.clone(),references:references.clone(),details:Some(serde_json::json!({"code":issue.code,"last_fresh_report_ms":health.last_fresh_report_ms,"expected_by_ms":health.expected_by_ms,"policy":health.effective_policy}))});
                }
            }
            for resolved in old_codes.difference(&new_codes) {
                if warming_up {
                    continue;
                }
                let message = if disabled {
                    format!("{name}: {resolved} warning cleared because monitoring is disabled.")
                } else if *resolved == "missing_report"
                    && health.effective_policy.policy == ReportingPolicy::Ignore
                {
                    format!("{name}: missing-report warning cleared by the Ignore policy.")
                } else if *resolved == "missing_report"
                    && observation.fresh.is_some_and(|fresh| {
                        previous.and_then(|old| old.last_fresh_report_ms) != Some(fresh.0)
                    })
                {
                    format!("{name} is reporting again; missing-report warning cleared.")
                } else if *resolved == "offline" {
                    format!("{name} is reachable again; offline warning cleared.")
                } else {
                    format!("{name}: {resolved} warning cleared.")
                };
                logs.push(UiLogEntry{timestamp:chrono::DateTime::from_timestamp_millis(wall).unwrap_or_default().to_rfc3339(),level:LogLevel::Info,target:"homectl_server::device_health".into(),message,references:references.clone(),details:Some(serde_json::json!({"code":resolved,"recovered":true,"last_fresh_report_ms":health.last_fresh_report_ms,"policy":health.effective_policy}))});
            }
            if !health.issues.is_empty() {
                next.attention_device_keys.push(key.clone());
            }
            next.devices.insert(key, health);
        }
        self.observations.retain(|key, observation| {
            next.devices.contains_key(key)
                || mono.saturating_sub(observation.first_seen_mono) < 3_600_000
        });
        self.snapshot = next;
        logs
    }
}
impl crate::core::state::AppState {
    pub fn refresh_device_health(&mut self, force: bool) -> crate::core::snapshot::SnapshotChanges {
        let wall = self.clock.wall_ms();
        let mono = self.clock.monotonic_ms();
        let mut errors = BTreeMap::new();
        for integration in &self.runtime_config.integrations {
            if let Some(epoch) =
                self.integrations
                    .event_epoch(&crate::types::integration::IntegrationId::from(
                        integration.id.clone(),
                    ))
            {
                self.device_health
                    .integration_epoch(&integration.id, epoch, mono);
            }
        }
        self.device_health.source_receipts.retain(|key, _| {
            self.runtime_config
                .sources
                .iter()
                .any(|source| *key == format!("computed/{}", source.id.0))
        });
        for (id, output) in self.sources.outputs() {
            let key = format!("computed/{}", id.0);
            let stamp = (output.definition_revision, output.computed_at_ms);
            if self.device_health.source_receipts.get(&key) != Some(&stamp) {
                self.device_health
                    .observe(&key, false, output.computed_at_ms, mono);
                self.device_health
                    .source_receipts
                    .insert(key.clone(), stamp);
            }
            if let crate::types::automation_source::SourceQuality::Stale { message } =
                &output.quality
            {
                errors.insert(key, message.clone());
            }
        }
        let before = self.device_health.generation;
        let logs = self.device_health.evaluate(
            &self.runtime_config,
            self.devices.get_state(),
            self.warming_up,
            wall,
            mono,
            force,
            &errors,
        );
        for entry in logs {
            crate::core::logs::record_structured(entry);
        }
        crate::core::snapshot::SnapshotChanges {
            device_health: before != self.device_health.generation,
            ..crate::core::snapshot::SnapshotChanges::none()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        device::{Device, DeviceData, DeviceId, SensorDevice},
        integration::IntegrationId,
    };
    fn fixture() -> (ConfigExport, DevicesState) {
        let (state, _events) = crate::core::event::tests::test_state();
        let device = Device::new(
            IntegrationId::from("mqtt".to_owned()),
            DeviceId::new("window"),
            "Window light".into(),
            DeviceData::Sensor(SensorDevice::Boolean { value: false }),
            None,
        );
        let mut config = state.runtime_config;
        config
            .integrations
            .push(crate::db::config_queries::IntegrationRow {
                id: "mqtt".into(),
                plugin: "mqtt".into(),
                config: serde_json::json!({}),
                enabled: true,
            });
        (
            config,
            DevicesState([(device.get_device_key(), device)].into_iter().collect()),
        )
    }
    fn custom(seconds: u32) -> ReportingPolicy {
        ReportingPolicy::Custom {
            expected_interval_seconds: seconds,
        }
    }
    #[test]
    fn event_only_defaults_do_not_invent_timeouts_and_device_override_wins() {
        let (mut config, devices) = fixture();
        let mut monitor = HealthMonitor::default();
        monitor.observe("mqtt/window", false, 1000, 0);
        monitor.evaluate(
            &config,
            &devices,
            false,
            9_000_000,
            9_000_000,
            true,
            &BTreeMap::new(),
        );
        assert!(monitor.snapshot.attention_device_keys.is_empty());
        assert_eq!(
            effective_policy(&config, "mqtt/window", "mqtt").policy,
            ReportingPolicy::Inherit
        );
        config
            .widget_settings
            .push(policy_row("integration", "mqtt", &custom(60)));
        assert_eq!(
            effective_policy(&config, "mqtt/window", "mqtt").source,
            "integration"
        );
        config.widget_settings.push(policy_row(
            "device",
            "mqtt/window",
            &ReportingPolicy::Ignore,
        ));
        assert_eq!(
            effective_policy(&config, "mqtt/window", "mqtt").policy,
            ReportingPolicy::Ignore
        );
        assert_eq!(
            effective_policy(&config, "mqtt/window", "mqtt").source,
            "device"
        );
    }
    #[test]
    fn retained_reports_and_wall_clock_jumps_do_not_postpone_deadlines() {
        let (mut config, devices) = fixture();
        config
            .widget_settings
            .push(policy_row("integration", "mqtt", &custom(10)));
        let mut monitor = HealthMonitor::default();
        let empty = BTreeMap::new();
        monitor.observe("mqtt/window", false, 100_000, 0);
        monitor.evaluate(&config, &devices, false, 100_000, 0, true, &empty);
        monitor.observe("mqtt/window", true, 120_000, 20_000);
        monitor.evaluate(&config, &devices, false, -500_000, 29_000, true, &empty);
        assert!(monitor.snapshot.attention_device_keys.is_empty());
        let logs = monitor.evaluate(&config, &devices, false, -498_000, 31_000, true, &empty);
        assert_eq!(monitor.snapshot.devices["mqtt/window"].status, "late");
        assert_eq!(
            monitor.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(100_000)
        );
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].references[0].entity_id, "mqtt/window");
        assert_eq!(
            logs[0].details.as_ref().unwrap()["policy"]["policy"]["expected_interval_seconds"],
            10
        );
        assert!(monitor
            .evaluate(&config, &devices, false, -490_000, 39_000, true, &empty)
            .is_empty());
        monitor.observe("mqtt/window", false, -489_000, 40_000);
        let recovery = monitor.evaluate(&config, &devices, false, -489_000, 40_000, true, &empty);
        assert_eq!(recovery.len(), 1);
        assert!(recovery[0].message.contains("reporting again"));
        assert!(monitor.snapshot.attention_device_keys.is_empty());
    }
    #[test]
    fn ignore_suppresses_silence_but_not_offline_and_fresh_receipt_recovers() {
        let (mut config, devices) = fixture();
        config.widget_settings.push(policy_row(
            "device",
            "mqtt/window",
            &ReportingPolicy::Ignore,
        ));
        let mut monitor = HealthMonitor::default();
        let empty = BTreeMap::new();
        monitor.availability("mqtt/window", false, 1_000, 0);
        monitor.evaluate(&config, &devices, false, 1_000, 0, true, &empty);
        assert_eq!(monitor.snapshot.devices["mqtt/window"].status, "offline");
        // Cached online status cannot clear an observed offline signal.
        monitor.availability("mqtt/window", true, 0, 100);
        assert!(monitor
            .evaluate(&config, &devices, false, 1_100, 100, true, &empty)
            .is_empty());
        assert_eq!(monitor.snapshot.attention_device_keys, vec!["mqtt/window"]);
        monitor.observe("mqtt/window", false, 1200, 200);
        let logs = monitor.evaluate(&config, &devices, false, 1200, 200, true, &empty);
        assert_eq!(logs.len(), 1);
        assert!(monitor.snapshot.attention_device_keys.is_empty());
    }
    #[test]
    fn warmup_and_first_observation_get_grace_and_multiple_issues_count_once() {
        let (mut config, devices) = fixture();
        config
            .widget_settings
            .push(policy_row("device", "mqtt/window", &custom(10)));
        let mut monitor = HealthMonitor::default();
        let empty = BTreeMap::new();
        monitor.observe("mqtt/window", true, 1000, 0);
        monitor.evaluate(&config, &devices, true, 101_000, 100_000, true, &empty);
        assert!(monitor.snapshot.attention_device_keys.is_empty());
        monitor.evaluate(&config, &devices, false, 102_000, 101_000, true, &empty);
        monitor.availability("mqtt/window", false, 140_000, 139_000);
        let logs = monitor.evaluate(&config, &devices, false, 140_000, 139_000, true, &empty);
        assert_eq!(logs.len(), 2);
        assert_eq!(monitor.snapshot.devices["mqtt/window"].issues.len(), 2);
        assert_eq!(monitor.snapshot.attention_device_keys, vec!["mqtt/window"]);
    }
    #[tokio::test]
    async fn identical_sensor_reports_refresh_evidence_without_changing_sensor_value() {
        use crate::{
            core::{clock::ManualClock, event::handle_event},
            types::event::Event,
        };
        use std::sync::Arc;
        let (mut state, _events) = crate::core::event::tests::test_state();
        let clock = Arc::new(ManualClock::new(1000));
        state.clock = clock.clone();
        let (_, devices) = fixture();
        let device = devices.0.values().next().unwrap().clone();
        let event = Event::ExternalStateUpdate {
            device: device.clone(),
            report_retained: false,
            integration_epoch: None,
        };
        handle_event(&mut state, &event).await.unwrap();
        state.refresh_device_health(true);
        clock.advance_wall_ms(5000);
        clock.advance_monotonic_ms(5000);
        handle_event(&mut state, &event).await.unwrap();
        state.refresh_device_health(true);
        assert_eq!(
            state.device_health.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(6000)
        );
        assert_eq!(
            state
                .devices
                .get_device(&device.get_device_key())
                .unwrap()
                .data,
            device.data
        );
        clock.advance_wall_ms(5000);
        clock.advance_monotonic_ms(5000);
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: device.clone(),
                report_retained: true,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.refresh_device_health(true);
        assert_eq!(
            state.device_health.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(6000)
        );
        assert_eq!(
            state.device_health.snapshot.devices["mqtt/window"].last_cached_report_ms,
            Some(11000)
        );
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device,
                report_retained: false,
                integration_epoch: Some(u64::MAX),
            },
        )
        .await
        .unwrap();
        state.refresh_device_health(true);
        assert_eq!(
            state.device_health.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(6000),
            "a superseded integration epoch cannot refresh health evidence"
        );
        handle_event(
            &mut state,
            &Event::IntegrationConnected {
                integration_id: IntegrationId::from("mqtt".to_owned()),
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            state.device_health.observations["mqtt/window"].first_seen_mono,
            10000
        );
        clock.advance_monotonic_ms(5000);
        handle_event(
            &mut state,
            &Event::IntegrationConnected {
                integration_id: IntegrationId::from("mqtt".to_owned()),
                integration_epoch: Some(u64::MAX),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            state.device_health.observations["mqtt/window"].first_seen_mono, 10000,
            "a superseded integration cannot postpone reporting warnings"
        );
        state.refresh_device_health(true);
        assert_eq!(
            state.device_health.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(6000),
            "transport reconnects must never count as a device report"
        );
    }

    #[test]
    fn resumed_monitoring_gets_grace_without_losing_receipt_history() {
        let (mut config, devices) = fixture();
        config
            .widget_settings
            .push(policy_row("device", "mqtt/window", &custom(10)));
        let mut monitor = HealthMonitor::default();
        let empty = BTreeMap::new();
        monitor.observe("mqtt/window", false, 1000, 0);
        monitor.evaluate(&config, &devices, false, 1000, 0, true, &empty);
        config.integrations[0].enabled = false;
        monitor.evaluate(&config, &devices, false, 100001, 100000, true, &empty);
        config.integrations[0].enabled = true;
        monitor.evaluate(&config, &devices, false, 200001, 200000, true, &empty);
        assert!(monitor.snapshot.attention_device_keys.is_empty());
        assert_eq!(
            monitor.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(1000)
        );
        monitor.evaluate(&config, &devices, false, 230002, 230001, true, &empty);
        assert_eq!(monitor.snapshot.attention_device_keys, vec!["mqtt/window"]);
        monitor.integration_epoch("mqtt", 1, 230001);
        monitor.integration_epoch("mqtt", 2, 240000);
        monitor.evaluate(&config, &devices, false, 240001, 240000, true, &empty);
        assert!(
            monitor.snapshot.attention_device_keys.is_empty(),
            "a replacement integration actor gets reconnect grace"
        );
        assert_eq!(
            monitor.snapshot.devices["mqtt/window"].last_fresh_report_ms,
            Some(1000)
        );
        monitor.integration_epoch("mqtt", 2, 271000);
        monitor.evaluate(&config, &devices, false, 271001, 271000, true, &empty);
        assert_eq!(
            monitor.snapshot.attention_device_keys,
            vec!["mqtt/window"],
            "unchanged integration epoch does not repeatedly postpone the deadline"
        );
    }
}
