//! Paced readback scheduling, owned by the MQTT event-loop task.
use serde_json::Value;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

const GAP: Duration = Duration::from_secs(2);
const TIMEOUT: Duration = Duration::from_secs(15);

struct Entry {
    payload: Value,
    due: Instant,
    command: Option<Instant>,
    cooldown: Instant,
    failures: u32,
    online: bool,
}

pub(super) struct Polling {
    entries: HashMap<String, Entry>,
    stale: Duration,
    active: Option<(String, Instant)>,
    next: Instant,
}

impl Polling {
    pub(super) fn configured(profile: bool, dry_run: bool, seconds: Option<u64>) -> Option<Self> {
        let seconds = seconds.unwrap_or(300);
        (profile && !dry_run && seconds != 0).then(|| Self::new(seconds, Instant::now()))
    }

    pub(super) fn publish_due(&mut self, client: &rumqttc::AsyncClient, now: Instant) {
        if let Some((topic, payload)) = self.candidate(now) {
            // This task also drains the MQTT request queue: never await capacity.
            if client
                .try_publish(&topic, rumqttc::QoS::AtMostOnce, false, payload.to_string())
                .is_ok()
            {
                self.sent(topic, now);
            }
        }
    }

    pub(super) fn new(seconds: u64, now: Instant) -> Self {
        Self {
            entries: HashMap::new(),
            stale: Duration::from_secs(seconds.clamp(30, 86400)),
            active: None,
            next: now,
        }
    }

    pub(super) fn sync(&mut self, requests: Vec<(String, Value)>, now: Instant) {
        let requests: HashMap<_, _> = requests.into_iter().collect();
        self.entries.retain(|key, _| requests.contains_key(key));
        for (key, payload) in requests {
            self.entries
                .entry(key)
                .and_modify(|entry| entry.payload = payload.clone())
                .or_insert(Entry {
                    payload,
                    due: now + self.stale,
                    command: None,
                    cooldown: now,
                    failures: 0,
                    online: true,
                });
        }
    }

    pub(super) fn command(&mut self, key: &str, transition: f64, now: Instant) {
        if let Some(entry) = self.entries.get_mut(key) {
            let transition = if transition.is_finite() {
                transition.clamp(0.0, 86400.0)
            } else {
                0.0
            };
            entry.command = Some(now + Duration::from_secs_f64(transition) + GAP);
        }
    }

    pub(super) fn report(&mut self, key: &str, now: Instant) {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.due = now + self.stale;
            entry.failures = 0;
            entry.cooldown = now;
            if entry.command.is_some_and(|due| now >= due) {
                entry.command = None;
            }
        }
        if self.active.as_ref().is_some_and(|(id, _)| id == key) {
            self.active = None;
        }
    }

    pub(super) fn availability(&mut self, key: &str, online: bool) {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.online = online;
        }
    }

    pub(super) fn candidate(&mut self, now: Instant) -> Option<(String, Value)> {
        if let Some((key, sent)) = &self.active {
            if now.duration_since(*sent) < TIMEOUT {
                return None;
            }
            if let Some(entry) = self.entries.get_mut(key) {
                entry.failures = entry.failures.saturating_add(1).min(6);
                entry.cooldown =
                    now + Duration::from_secs((30u64 << (entry.failures - 1)).min(900));
                entry.due = now;
            }
            self.active = None;
        }
        if now < self.next {
            return None;
        }
        self.entries
            .iter()
            .filter(|(_, entry)| {
                entry.online && now >= entry.cooldown && now >= entry.command.unwrap_or(entry.due)
            })
            .min_by_key(|(key, entry)| (entry.command.unwrap_or(entry.due), *key))
            .map(|(key, entry)| (key.clone(), entry.payload.clone()))
    }

    pub(super) fn sent(&mut self, key: String, now: Instant) {
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.command = None;
            entry.due = now + self.stale;
        }
        self.active = Some((key, now));
        self.next = now + GAP;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dry_run_generic_and_disabled_profiles_never_poll() {
        assert!(Polling::configured(true, true, None).is_none());
        assert!(Polling::configured(false, false, Some(300)).is_none());
        assert!(Polling::configured(true, false, Some(0)).is_none());
        assert!(Polling::configured(true, false, None).is_some());
    }

    #[test]
    fn full_mqtt_queue_does_not_block_or_lose_pending_readback() {
        let t = Instant::now();
        let mut p = scheduler(t);
        // No broker or network: fill rumqttc's bounded channel without polling it.
        let (client, _eventloop) =
            rumqttc::AsyncClient::new(rumqttc::MqttOptions::new("test", "localhost", 1883), 10);
        for _ in 0..10 {
            client
                .try_publish("z/test/set", rumqttc::QoS::AtMostOnce, false, "{}")
                .unwrap();
        }
        let now = t + Duration::from_secs(30);
        let expected = p.candidate(now).unwrap().0;
        p.publish_due(&client, now);
        assert!(p.active.is_none());
        assert_eq!(p.candidate(now).unwrap().0, expected);
    }
    fn scheduler(now: Instant) -> Polling {
        let mut p = Polling::new(1, now);
        p.sync(
            (0..20)
                .map(|i| (format!("z/{i}/get"), serde_json::json!({"state":""})))
                .collect(),
            now,
        );
        p
    }
    #[test]
    fn fleet_is_paced_and_only_one_request_is_outstanding() {
        let t = Instant::now();
        let mut p = scheduler(t);
        assert!(p.candidate(t + Duration::from_secs(29)).is_none());
        let now = t + Duration::from_secs(30);
        let (key, _) = p.candidate(now).unwrap();
        p.sent(key.clone(), now);
        assert!(p.candidate(now + GAP).is_none());
        p.report(&key, now);
        assert!(p.candidate(now).is_none());
        assert!(p.candidate(now + GAP).is_some());
    }
    #[test]
    fn commands_coalesce_and_wait_for_latest_transition() {
        let t = Instant::now();
        let mut p = scheduler(t);
        p.command("z/0/get", 5.0, t);
        p.command("z/0/get", 10.0, t);
        p.report("z/0/get", t + Duration::from_secs(1));
        assert!(p.candidate(t + Duration::from_secs(7)).is_none());
        assert_eq!(
            p.candidate(t + Duration::from_secs(12)).unwrap().0,
            "z/0/get"
        );
    }
    #[test]
    fn reports_defer_refresh_and_offline_devices_are_skipped() {
        let t = Instant::now();
        let mut p = scheduler(t);
        for i in 0..20 {
            p.availability(&format!("z/{i}/get"), false);
        }
        p.availability("z/0/get", true);
        p.report("z/0/get", t + Duration::from_secs(20));
        assert!(p.candidate(t + Duration::from_secs(30)).is_none());
        assert!(p.candidate(t + Duration::from_secs(50)).is_some());
    }
    #[test]
    fn timeouts_back_off_even_when_more_commands_arrive() {
        let t = Instant::now();
        let mut p = Polling::new(30, t);
        p.sync(vec![("z/0/get".into(), serde_json::json!({"state":""}))], t);
        let now = t + Duration::from_secs(30);
        let (key, _) = p.candidate(now).unwrap();
        p.sent(key.clone(), now);
        assert!(p.candidate(now + TIMEOUT).is_none());
        p.command(&key, 0.0, now + TIMEOUT);
        assert!(p.candidate(now + TIMEOUT + GAP).is_none());
        assert!(p
            .candidate(now + TIMEOUT + Duration::from_secs(30))
            .is_some());
    }
}
