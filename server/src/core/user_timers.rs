//! Database-backed household timers, independent of browser/widget lifetime.
//! The configuration write lock serializes edits, checkpoint writes and fires.
//! Commands use the existing actor command path. A persisted pending intent is
//! replayed after a crash; state assignments can repeat, never arbitrary actions.
use crate::{
    core::{snapshot::RuntimeSnapshot, state::StateHandle},
    db::config_queries::{self, WidgetSettingRow},
    types::{
        device::DeviceKey, device_command::DeviceCommand, group::GroupId, scene::SceneId,
        scene_command::SceneCommand, user_timer::*,
    },
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use eyre::{eyre, Result};
use std::collections::HashSet;

pub const SETTING_KEY: &str = "user_timers";
const MAX_MINUTES: u32 = 60 * 24 * 7;

pub fn read(settings: &[WidgetSettingRow]) -> Result<UserTimers> {
    settings
        .iter()
        .find(|row| row.key == SETTING_KEY)
        .map(|row| serde_json::from_value(row.config.clone()).map_err(Into::into))
        .unwrap_or_else(|| Ok(UserTimers::default()))
}

pub fn validate_setting(key: &str, config: &serde_json::Value) -> Result<()> {
    if key != SETTING_KEY {
        return Ok(());
    }
    let value: UserTimers = serde_json::from_value(config.clone())?;
    validate_definitions(
        &value
            .timers
            .iter()
            .map(|t| t.definition.clone())
            .collect::<Vec<_>>(),
    )?;
    for entry in &value.timers {
        if entry
            .runtime
            .pending
            .as_deref()
            .is_some_and(|p| !matches!(p, "start" | "finish" | "stop"))
        {
            return Err(eyre!("Unknown timer execution phase"));
        }
        if entry.runtime.active && entry.definition.finish_action.is_none() {
            return Err(eyre!("An active timer must have a finish action"));
        }
        for ms in [
            entry.runtime.next_start_ms,
            entry.runtime.finish_ms,
            entry.runtime.last_run_ms,
        ]
        .into_iter()
        .flatten()
        {
            if DateTime::from_timestamp_millis(ms).is_none() {
                return Err(eyre!("Invalid timer timestamp"));
            }
        }
    }
    Ok(())
}

pub fn validate_definitions(definitions: &[UserTimerDefinition]) -> Result<()> {
    if definitions.len() > 100 {
        return Err(eyre!("At most 100 timers are supported"));
    }
    let mut ids = HashSet::new();
    for d in definitions {
        if d.id.is_empty() || d.id.len() > 80 || !ids.insert(&d.id) {
            return Err(eyre!("Timer IDs must be unique and 1–80 bytes"));
        }
        if d.name.trim().is_empty() || d.name.len() > 160 {
            return Err(eyre!("Give every timer a name of at most 160 bytes"));
        }
        if ![
            "timer", "car", "light", "heat", "plug", "coffee", "fan", "moon", "sun", "water",
        ]
        .contains(&d.icon.as_str())
        {
            return Err(eyre!("Choose a supported timer icon"));
        }
        validate_action(&d.action)?;
        if let Some(a) = &d.finish_action {
            validate_action(a)?;
        }
        match &d.schedule {
            UserTimerSchedule::Countdown { minutes } => {
                duration(*minutes)?;
                if d.finish_action.is_some() {
                    return Err(eyre!("Countdowns have one action when they expire"));
                }
            }
            UserTimerSchedule::Scheduled {
                time,
                timezone,
                date,
                weekdays,
                duration_minutes,
            } => {
                calendar(time, timezone, date, weekdays)?;
                if duration_minutes.is_some() != d.finish_action.is_some() {
                    return Err(eyre!("An end action and run duration must be set together"));
                }
                if let Some(m) = duration_minutes {
                    duration(*m)?;
                }
            }
            UserTimerSchedule::ReadyBy {
                time,
                timezone,
                date,
                weekdays,
                warmup_minutes,
            } => {
                calendar(time, timezone, date, weekdays)?;
                duration(*warmup_minutes)?;
                if d.finish_action.is_none() {
                    return Err(eyre!("Ready-by timers need an end action"));
                }
            }
        }
    }
    Ok(())
}
fn validate_action(a: &UserTimerAction) -> Result<()> {
    let id = match a {
        UserTimerAction::Device { device_key, .. } => {
            let _: DeviceKey = serde_json::from_value(serde_json::json!(device_key))?;
            device_key
        }
        UserTimerAction::Group { group_id, .. } => group_id,
        UserTimerAction::Scene { scene_id } => scene_id,
    };
    if id.trim().is_empty() || id.len() > 256 {
        return Err(eyre!("Choose an action target"));
    }
    Ok(())
}
fn duration(m: u32) -> Result<()> {
    if !(1..=MAX_MINUTES).contains(&m) {
        return Err(eyre!("Duration must be between 1 minute and 7 days"));
    }
    Ok(())
}
fn calendar(time: &str, zone: &str, date: &Option<String>, days: &[u8]) -> Result<()> {
    NaiveTime::parse_from_str(time, "%H:%M").map_err(|_| eyre!("Use a valid HH:MM time"))?;
    zone.parse::<Tz>()
        .map_err(|_| eyre!("Choose an IANA time zone"))?;
    if let Some(date) = date {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| eyre!("Choose a valid date"))?;
        if !days.is_empty() {
            return Err(eyre!("Choose a date or repeat days, not both"));
        }
    } else if days.is_empty() || days.iter().any(|d| !(1..=7).contains(d)) {
        return Err(eyre!("Choose at least one repeat day"));
    }
    Ok(())
}

/// DST gaps are skipped, folds use the earlier instant once. A warm-up window
/// crossing midnight belongs to the ready-by date, not the start date.
pub fn arm(d: &UserTimerDefinition, now: DateTime<Utc>) -> Result<UserTimerRuntime> {
    let mut runtime = UserTimerRuntime::default();
    if !d.enabled {
        return Ok(runtime);
    }
    if let UserTimerSchedule::Countdown { minutes } = d.schedule {
        runtime.next_start_ms =
            Some((now + Duration::minutes(i64::from(minutes))).timestamp_millis());
        return Ok(runtime);
    }
    let (time, timezone, date, weekdays, lead, run) = match &d.schedule {
        UserTimerSchedule::Scheduled {
            time,
            timezone,
            date,
            weekdays,
            duration_minutes,
        } => (
            time,
            timezone,
            date,
            weekdays,
            0,
            duration_minutes.unwrap_or(0),
        ),
        UserTimerSchedule::ReadyBy {
            time,
            timezone,
            date,
            weekdays,
            warmup_minutes,
        } => (
            time,
            timezone,
            date,
            weekdays,
            *warmup_minutes,
            *warmup_minutes,
        ),
        _ => unreachable!(),
    };
    let tz = timezone
        .parse::<Tz>()
        .map_err(|_| eyre!("Invalid time zone"))?;
    let time = NaiveTime::parse_from_str(time, "%H:%M")?;
    let first = if let Some(date) = date {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")?
    } else {
        now.with_timezone(&tz).date_naive()
    };
    for offset in 0..if date.is_some() { 1 } else { 9 } {
        let day = first + Duration::days(offset);
        if date.is_none() && !weekdays.contains(&(day.weekday().number_from_monday() as u8)) {
            continue;
        }
        let Some(at) = tz
            .from_local_datetime(&day.and_time(time))
            .earliest()
            .map(|t| t.with_timezone(&Utc))
        else {
            continue;
        };
        if at <= now {
            continue;
        }
        let start = at - Duration::minutes(i64::from(lead));
        runtime.next_start_ms = Some(start.max(now).timestamp_millis());
        runtime.finish_ms =
            (run > 0).then(|| (start + Duration::minutes(i64::from(run))).timestamp_millis());
        return Ok(runtime);
    }
    Err(eyre!(
        "No future occurrence. Check the date, time and daylight-saving transition."
    ))
}

pub async fn lock(handle: &StateHandle) -> Result<tokio::sync::OwnedMutexGuard<()>> {
    let lock = handle
        .mutate(|state| Box::pin(async move { state.runtime_apply_lock.clone() }))
        .await?;
    Ok(lock.lock_owned().await)
}

/// Timers require durable storage: never report an armed server timer while
/// silently holding its only copy in memory. External DB work stays out of actor.
pub async fn persist(handle: &StateHandle, value: &UserTimers) -> Result<()> {
    let row = WidgetSettingRow {
        key: SETTING_KEY.into(),
        config: serde_json::to_value(value)?,
    };
    validate_setting(&row.key, &row.config)?;
    config_queries::db_upsert_widget_setting(&row).await?;
    handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_widget_setting(row);
            })
        })
        .await?;
    Ok(())
}

pub async fn update(
    handle: &StateHandle,
    definitions: Vec<UserTimerDefinition>,
    expected: Vec<UserTimerDefinition>,
    now: DateTime<Utc>,
) -> Result<UserTimers> {
    validate_definitions(&definitions)?;
    let mut catalog = read(&handle.snapshot.load().runtime_config.widget_settings)?;
    let current: Vec<_> = catalog
        .timers
        .iter()
        .map(|t| t.definition.clone())
        .collect();
    if expected != current {
        return Err(eyre!(
            "Timers changed elsewhere. Reload the saved timers before saving."
        ));
    }
    for entry in &catalog.timers {
        if (entry.runtime.active || entry.runtime.pending.is_some())
            && !definitions.contains(&entry.definition)
        {
            return Err(eyre!(
                "Stop '{}' before editing or deleting its running timer",
                entry.definition.name
            ));
        }
    }
    let timers = definitions
        .into_iter()
        .map(|definition| {
            if let Some(entry) = catalog.timers.iter().find(|t| t.definition == definition) {
                return Ok(entry.clone());
            }
            if let Some(entry) = catalog.timers.iter().find(|t| {
                let old = &t.definition;
                old.id == definition.id
                    && old.enabled == definition.enabled
                    && old.schedule == definition.schedule
                    && old.action == definition.action
                    && old.finish_action == definition.finish_action
            }) {
                return Ok(UserTimerEntry {
                    definition,
                    runtime: entry.runtime.clone(),
                });
            }
            if definition.enabled {
                let snapshot = handle.snapshot.load();
                for action in
                    std::iter::once(&definition.action).chain(definition.finish_action.iter())
                {
                    if let UserTimerAction::Scene { scene_id } = action {
                        if !snapshot
                            .flattened_scenes
                            .0
                            .contains_key(&SceneId::new(scene_id.clone()))
                        {
                            return Err(eyre!("Scene no longer exists"));
                        }
                    } else {
                        for key in action_keys(&snapshot, action)? {
                            if !snapshot.devices.0.get(&key).is_some_and(|d| {
                                d.get_controllable_state().is_some() && !d.is_readonly()
                            }) {
                                return Err(eyre!("{key} is missing or read-only"));
                            }
                        }
                    }
                }
            }
            let runtime = arm(&definition, now)?;
            Ok(UserTimerEntry {
                definition,
                runtime,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    catalog.timers = timers;
    catalog.legacy_migrated = true;
    persist(handle, &catalog).await?;
    Ok(catalog)
}

pub fn action_keys(snapshot: &RuntimeSnapshot, action: &UserTimerAction) -> Result<Vec<DeviceKey>> {
    let keys = match action {
        UserTimerAction::Device { device_key, .. } => {
            vec![serde_json::from_value(serde_json::json!(device_key))?]
        }
        UserTimerAction::Group { group_id, .. } => snapshot
            .flattened_groups
            .0
            .get(&GroupId(group_id.clone()))
            .ok_or_else(|| eyre!("Room or group no longer exists"))?
            .device_keys
            .clone(),
        UserTimerAction::Scene { .. } => return Ok(vec![]),
    };
    // Groups may contain sensors; only writable control members are intended.
    let keys: Vec<_> = keys
        .into_iter()
        .filter(|key| match action {
            UserTimerAction::Group { .. } => snapshot
                .devices
                .0
                .get(key)
                .is_some_and(|d| d.get_controllable_state().is_some() && !d.is_readonly()),
            _ => true,
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if keys.is_empty() {
        return Err(eyre!("No writable devices in this timer's target"));
    }
    Ok(keys)
}

async fn execute(handle: &StateHandle, action: &UserTimerAction) -> Result<()> {
    let id = format!("timer-{}", Utc::now().timestamp_micros());
    if let UserTimerAction::Scene { scene_id } = action {
        let result = handle
            .activate_scene(SceneCommand {
                request_id: id,
                scene_id: SceneId::new(scene_id.clone()),
                device_keys: None,
                group_keys: None,
                use_scene_transition: true,
                transition: None,
            })
            .await?;
        if !result.applied {
            return Err(eyre!(result
                .error
                .unwrap_or_else(|| "Scene was not applied".into())));
        }
        return Ok(());
    }
    let power = match action {
        UserTimerAction::Device { power, .. } | UserTimerAction::Group { power, .. } => *power,
        _ => unreachable!(),
    };
    let keys = action_keys(&handle.snapshot.load(), action)?;
    let mut errors = Vec::new();
    for key in keys {
        let result = handle
            .control_device(DeviceCommand {
                request_id: id.clone(),
                device_key: key.clone(),
                power: Some(power),
                brightness: None,
                color: None,
                transition: None,
                preserve_scene: false,
            })
            .await?;
        if !result.applied {
            errors.push(format!(
                "{key}: {}",
                result.error.unwrap_or_else(|| "not applied".into())
            ));
        }
    }
    if !errors.is_empty() {
        return Err(eyre!(errors.join("; ")));
    }
    Ok(())
}

fn complete(entry: &mut UserTimerEntry, now: DateTime<Utc>) {
    let recurring = match &entry.definition.schedule {
        UserTimerSchedule::Countdown { .. } => false,
        UserTimerSchedule::Scheduled { date, .. } | UserTimerSchedule::ReadyBy { date, .. } => {
            date.is_none()
        }
    };
    let message = entry.runtime.last_message.clone();
    let last_run = entry.runtime.last_run_ms;
    if !recurring {
        entry.definition.enabled = false;
    }
    entry.runtime = arm(&entry.definition, now).unwrap_or_default();
    entry.runtime.last_message = message;
    entry.runtime.last_run_ms = last_run;
}

pub async fn tick(handle: &StateHandle, now: DateTime<Utc>) -> Result<()> {
    let _guard = lock(handle).await?;
    if handle.snapshot.load().warming_up {
        return Ok(());
    }
    migrate_legacy(handle, now).await?;
    let mut catalog = read(&handle.snapshot.load().runtime_config.widget_settings)?;
    let ms = now.timestamp_millis();
    for index in 0..catalog.timers.len() {
        let entry = &mut catalog.timers[index];
        if entry.definition.enabled
            && !entry.runtime.active
            && entry.runtime.pending.is_none()
            && entry.runtime.next_start_ms.is_none()
        {
            entry.runtime = match arm(&entry.definition, now) {
                Ok(runtime) => runtime,
                Err(error) => {
                    entry.definition.enabled = false;
                    UserTimerRuntime {
                        last_message: Some(error.to_string()),
                        ..Default::default()
                    }
                }
            };
            persist(handle, &catalog).await?;
            continue;
        }
        if entry.runtime.pending.is_some()
            && entry
                .runtime
                .last_run_ms
                .is_some_and(|last| ms >= last && ms - last < 30_000)
        {
            continue;
        }
        let phase = if let Some(phase) = &entry.runtime.pending {
            phase.clone()
        } else if entry.runtime.active && entry.runtime.finish_ms.is_some_and(|at| at <= ms) {
            "finish".into()
        } else if entry.definition.enabled && entry.runtime.next_start_ms.is_some_and(|at| at <= ms)
        {
            // Skip stale starts after downtime. Never replay an old on
            // command for a completed warm-up window. End actions recover.
            if (!matches!(
                entry.definition.schedule,
                UserTimerSchedule::Countdown { .. }
            ) && entry
                .runtime
                .next_start_ms
                .is_some_and(|at| ms - at > 60_000))
                || entry.runtime.finish_ms.is_some_and(|at| at <= ms)
            {
                entry.runtime.last_message =
                    Some("Missed while the server was unavailable; start skipped".into());
                complete(entry, now);
                persist(handle, &catalog).await?;
                continue;
            }
            "start".into()
        } else {
            continue;
        };
        // A crash during start is recovered as finish if its end has passed.
        let phase = if phase == "start" && entry.runtime.finish_ms.is_some_and(|at| at <= ms) {
            "finish".to_string()
        } else {
            phase
        };
        entry.runtime.pending = Some(phase.clone());
        let action = if phase == "start" {
            Some(entry.definition.action.clone())
        } else {
            entry.definition.finish_action.clone()
        };
        persist(handle, &catalog).await?;
        let outcome = if let Some(action) = action {
            execute(handle, &action).await
        } else {
            Ok(())
        };
        let entry = &mut catalog.timers[index];
        entry.runtime.pending = None;
        entry.runtime.last_run_ms = Some(ms);
        entry.runtime.last_message = Some(match &outcome {
            Ok(_) => format!(
                "{} applied to runtime",
                if phase == "start" {
                    "Start action"
                } else {
                    "End action"
                }
            ),
            Err(e) => format!("Action failed: {e}"),
        });
        if let Err(error) = &outcome {
            warn!("Timer '{}' {phase}: {error}", entry.definition.name);
        }
        if phase != "start" && outcome.is_err() {
            entry.runtime.pending = Some(phase);
            persist(handle, &catalog).await?;
            continue;
        }
        if phase == "start" && entry.runtime.finish_ms.is_some() {
            // Even partially rejected starts retain their scheduled cleanup.
            entry.runtime.active = true;
            entry.runtime.next_start_ms = None;
        } else {
            if phase == "stop" {
                entry.definition.enabled = false;
            }
            complete(entry, now);
        }
        persist(handle, &catalog).await?;
    }
    Ok(())
}

/// One-time migration uses the household time zone confirmed by the user.
/// The original UI-state row remains untouched for recovery.
async fn migrate_legacy(handle: &StateHandle, now: DateTime<Utc>) -> Result<()> {
    if read(&handle.snapshot.load().runtime_config.widget_settings)?.legacy_migrated {
        return retire_legacy(handle).await;
    }
    let legacy = {
        let snapshot = handle.snapshot.load();
        if snapshot
            .runtime_config
            .widget_settings
            .iter()
            .any(|r| r.key == SETTING_KEY)
        {
            return Ok(());
        }
        snapshot.ui_state.get("carHeaterTimer").cloned()
    };
    let Some(legacy) = legacy else {
        return Ok(());
    };
    #[derive(serde::Deserialize)]
    struct Legacy {
        timers: Vec<LegacyTimer>,
    }
    #[derive(serde::Deserialize)]
    struct LegacyTimer {
        enabled: bool,
        name: String,
        repeat: String,
        hour: u8,
        minute: u8,
    }
    let legacy: Legacy = serde_json::from_value(legacy)?;
    let zone = "Europe/Helsinki".to_string();
    let local = now.with_timezone(&zone.parse::<Tz>()?);
    let mut timers = Vec::new();
    for (index, old) in legacy.timers.into_iter().enumerate() {
        let weekdays = match old.repeat.as_str() {
            "daily" => (1..=7).collect(),
            "weekday" => (1..=5).collect(),
            "once" => vec![],
            _ => return Err(eyre!("Unknown legacy timer repeat mode")),
        };
        let definition = UserTimerDefinition {
            id: format!("migrated-car-heater-{index}"),
            name: old.name,
            icon: "car".into(),
            enabled: old.enabled,
            schedule: UserTimerSchedule::ReadyBy {
                time: format!("{:02}:{:02}", old.hour, old.minute),
                timezone: zone.clone(),
                date: weekdays.is_empty().then(|| {
                    let later_today = (u32::from(old.hour), u32::from(old.minute))
                        > (
                            chrono::Timelike::hour(&local),
                            chrono::Timelike::minute(&local),
                        );
                    (local.date_naive() + Duration::days(if later_today { 0 } else { 1 }))
                        .to_string()
                }),
                weekdays,
                warmup_minutes: 40,
            },
            action: UserTimerAction::Device {
                device_key: "tuya_devices/bfe553b84e883ace37nvxw".into(),
                power: true,
            },
            finish_action: Some(UserTimerAction::Device {
                device_key: "tuya_devices/bfe553b84e883ace37nvxw".into(),
                power: false,
            }),
        };
        let mut runtime = arm(&definition, now)?;
        runtime.last_message =
            Some("Migrated from the browser timer · Europe/Helsinki · 40-minute warm-up".into());
        timers.push(UserTimerEntry {
            definition,
            runtime,
        });
    }
    persist(
        handle,
        &UserTimers {
            timers,
            legacy_migrated: true,
        },
    )
    .await?;
    retire_legacy(handle).await
}

async fn retire_legacy(handle: &StateHandle) -> Result<()> {
    let old = handle
        .snapshot
        .load()
        .ui_state
        .get("carHeaterTimer")
        .cloned();
    let Some(old) = old else {
        return Ok(());
    };
    if old
        .get("timers")
        .and_then(|v| v.as_array())
        .is_none_or(|rows| rows.is_empty())
    {
        return Ok(());
    }
    let retired = serde_json::json!({"timers":[],"migrated_to":SETTING_KEY,"legacy_backup":old});
    crate::db::actions::db_store_ui_state("carHeaterTimer", &retired).await?;
    handle
        .mutate(move |state| {
            Box::pin(async move {
                state
                    .ui
                    .store_state_in_memory("carHeaterTimer".into(), retired);
                state.schedule_ws_broadcast(crate::core::snapshot::SnapshotChanges::ui_state());
            })
        })
        .await?;
    Ok(())
}

pub async fn stop(handle: &StateHandle, id: &str) -> Result<UserTimers> {
    let _guard = lock(handle).await?;
    let mut catalog = read(&handle.snapshot.load().runtime_config.widget_settings)?;
    let entry = catalog
        .timers
        .iter_mut()
        .find(|e| e.definition.id == id)
        .ok_or_else(|| eyre!("Timer not found"))?;
    entry.definition.enabled = false;
    if entry.runtime.active || entry.runtime.pending.is_some() {
        entry.runtime.pending = Some("stop".into());
    } else {
        entry.runtime = UserTimerRuntime {
            last_message: Some("Cancelled".into()),
            ..Default::default()
        };
    }
    persist(handle, &catalog).await?;
    // The next server tick executes the durable end action, even if the
    // requesting browser disconnects before the response arrives.
    Ok(catalog)
}

/// Explicit recovery for a broken end action. This never commands a device;
/// the UI labels that distinction and keeps the failure visible until chosen.
pub async fn cancel_actions(handle: &StateHandle, id: &str) -> Result<UserTimers> {
    let _guard = lock(handle).await?;
    let mut catalog = read(&handle.snapshot.load().runtime_config.widget_settings)?;
    let entry = catalog
        .timers
        .iter_mut()
        .find(|e| e.definition.id == id)
        .ok_or_else(|| eyre!("Timer not found"))?;
    entry.definition.enabled = false;
    entry.runtime = UserTimerRuntime {
        last_message: Some(
            "Cancelled without an end action. Check the target state before rescheduling.".into(),
        ),
        ..Default::default()
    };
    persist(handle, &catalog).await?;
    Ok(catalog)
}

pub fn spawn(handle: StateHandle) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut failed = false;
        loop {
            interval.tick().await;
            match tick(&handle, Utc::now()).await {
                Ok(_) => failed = false,
                Err(error) => {
                    if !failed {
                        error!("Timer scheduler paused: {error}");
                    }
                    failed = true;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(value: &str) -> DateTime<Utc> {
        value.parse().unwrap()
    }
    fn ready(time: &str, date: Option<&str>, weekdays: Vec<u8>) -> UserTimerDefinition {
        UserTimerDefinition {
            id: "heat".into(),
            name: "Warm up".into(),
            icon: "heat".into(),
            enabled: true,
            schedule: UserTimerSchedule::ReadyBy {
                time: time.into(),
                timezone: "Europe/Helsinki".into(),
                date: date.map(Into::into),
                weekdays,
                warmup_minutes: 40,
            },
            action: UserTimerAction::Device {
                device_key: "dummy/plug".into(),
                power: true,
            },
            finish_action: Some(UserTimerAction::Device {
                device_key: "dummy/plug".into(),
                power: false,
            }),
        }
    }
    #[test]
    fn ready_by_crosses_midnight_using_departure_day() {
        let d = ready("00:15", None, vec![1]);
        let r = arm(&d, at("2026-09-27T19:00:00Z")).unwrap();
        assert_eq!(
            r.next_start_ms,
            Some(at("2026-09-27T20:35:00Z").timestamp_millis())
        );
        assert_eq!(
            r.finish_ms,
            Some(at("2026-09-27T21:15:00Z").timestamp_millis())
        );
    }
    #[test]
    fn daylight_saving_gap_skips_and_fold_fires_once() {
        let d = ready("03:30", None, vec![7]);
        let r = arm(&d, at("2026-03-28T18:00:00Z")).unwrap();
        assert_eq!(
            r.finish_ms,
            Some(at("2026-04-05T00:30:00Z").timestamp_millis())
        );
        let r = arm(&d, at("2026-10-24T18:00:00Z")).unwrap();
        assert_eq!(
            r.finish_ms,
            Some(at("2026-10-25T00:30:00Z").timestamp_millis())
        );
        let next = arm(&d, at("2026-10-25T00:30:01Z")).unwrap();
        assert_eq!(
            next.finish_ms,
            Some(at("2026-11-01T01:30:00Z").timestamp_millis())
        );
        assert!(arm(
            &ready("03:30", Some("2026-03-29"), vec![]),
            at("2026-03-28T18:00:00Z")
        )
        .is_err());
    }
    #[test]
    fn partial_warmup_keeps_the_requested_end_time() {
        let r = arm(&ready("08:00", None, vec![2]), at("2026-09-29T04:45:00Z")).unwrap();
        assert_eq!(
            r.next_start_ms,
            Some(at("2026-09-29T04:45:00Z").timestamp_millis())
        );
        assert_eq!(
            r.finish_ms,
            Some(at("2026-09-29T05:00:00Z").timestamp_millis())
        );
    }
    #[test]
    fn once_completes_without_rearming_and_recurring_advances() {
        let d = ready("08:00", Some("2026-09-29"), vec![]);
        let mut e = UserTimerEntry {
            runtime: arm(&d, at("2026-09-29T02:00:00Z")).unwrap(),
            definition: d,
        };
        complete(&mut e, at("2026-09-29T05:00:00Z"));
        assert!(!e.definition.enabled);
        assert_eq!(e.runtime.next_start_ms, None);
        e.definition = ready("08:00", None, vec![1, 2, 3, 4, 5]);
        complete(&mut e, at("2026-10-02T05:00:00Z"));
        assert_eq!(
            e.runtime.finish_ms,
            Some(at("2026-10-05T05:00:00Z").timestamp_millis())
        );
    }
    #[test]
    fn validates_duration_target_and_backup_representation() {
        let mut d = ready("08:00", None, vec![1]);
        validate_definitions(&[d.clone()]).unwrap();
        assert!(validate_definitions(&[d.clone(), d.clone()]).is_err());
        d.schedule = UserTimerSchedule::Countdown { minutes: 0 };
        d.finish_action = None;
        assert!(validate_definitions(&[d.clone()]).is_err());
        d.schedule = UserTimerSchedule::Countdown { minutes: 10 };
        validate_definitions(&[d.clone()]).unwrap();
        let original = UserTimers {
            timers: vec![UserTimerEntry {
                definition: d.clone(),
                runtime: arm(&d, at("2026-09-29T02:00:00Z")).unwrap(),
            }],
            legacy_migrated: true,
        };
        let encoded = serde_json::to_value(&original).unwrap();
        validate_setting(SETTING_KEY, &encoded).unwrap();
        assert_eq!(
            serde_json::from_value::<UserTimers>(encoded).unwrap(),
            original
        );
        assert_eq!(read(&[]).unwrap(), UserTimers::default());
    }
}
