//! Paired devices (wall tablets, dashboards) and the pairing handshake.
//!
//! An unpaired device asks for a pairing: it gets a secret `pairing_id` that
//! only it knows and a short `code` it shows (as text and as a QR code). A
//! signed-in admin approves the code; the device's next poll then receives a
//! long-lived device token. Only a SHA-256 hash of the token is stored.
//!
//! Devices are cached in memory and written through to the `auth_devices`
//! table, so a database outage does not lock tablets out of a running server.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{hash_token, random_bytes, random_token};
use crate::db::{config_queries, is_db_connected};

/// How long a pairing code stays valid.
pub const PAIRING_TTL: Duration = Duration::from_secs(600);
/// Upper bound on concurrent pending pairings; the oldest is dropped first.
const MAX_PENDING_PAIRINGS: usize = 32;
/// `last_seen` is kept exact in memory but written to the database at most
/// this often per device.
const LAST_SEEN_PERSIST_INTERVAL: Duration = Duration::from_secs(300);
/// Prefix that makes homectl device tokens recognizable (e.g. in secret scanners).
pub const DEVICE_TOKEN_PREFIX: &str = "hcd_";
/// Unambiguous characters for codes typed by hand.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DeviceRecord {
    pub id: String,
    pub name: String,
    pub token_hash: String,
    pub created_at: String,
    pub created_by: String,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub last_seen_at: Option<String>,
    #[serde(default)]
    pub last_seen_ip: Option<String>,
}

struct DeviceEntry {
    record: DeviceRecord,
    last_persisted: Option<Instant>,
    cookie_renewed: Option<Instant>,
}

#[derive(Default)]
pub struct DeviceStore {
    entries: Mutex<HashMap<String, DeviceEntry>>,
    loaded: AtomicBool,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn persist(record: DeviceRecord) {
    if !is_db_connected() {
        return;
    }
    tokio::spawn(async move {
        let document = match serde_json::to_string(&record) {
            Ok(document) => document,
            Err(error) => {
                warn!("Failed to serialize paired device {}: {error}", record.id);
                return;
            }
        };
        if let Err(error) =
            config_queries::db_save_auth_device_document(&record.id, &document).await
        {
            warn!("Failed to persist paired device {}: {error}", record.id);
        }
    });
}

/// Result of looking up a device token.
pub struct DeviceMatch {
    pub id: String,
    pub name: String,
    /// The device cookie should be re-issued (browsers cap cookie lifetimes,
    /// so a used credential keeps extending itself).
    pub renew_cookie: bool,
}

impl DeviceStore {
    /// Load stored devices once the database is reachable. Devices paired
    /// while it was unavailable are written back then.
    pub async fn ensure_loaded(&self) {
        if self.loaded.load(Ordering::Acquire) || !is_db_connected() {
            return;
        }
        let documents = match config_queries::db_list_auth_device_documents().await {
            Ok(documents) => documents,
            Err(error) => {
                warn!("Failed to load paired devices: {error}");
                return;
            }
        };
        if self.loaded.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut unsaved = Vec::new();
        {
            let mut entries = self.entries.lock().unwrap();
            let stored: HashMap<String, DeviceRecord> = documents
                .iter()
                .filter_map(|document| serde_json::from_str::<DeviceRecord>(document).ok())
                .map(|record| (record.token_hash.clone(), record))
                .collect();
            for entry in entries.values() {
                if !stored.contains_key(&entry.record.token_hash) {
                    unsaved.push(entry.record.clone());
                }
            }
            for (hash, record) in stored {
                entries.entry(hash).or_insert(DeviceEntry {
                    record,
                    last_persisted: Some(Instant::now()),
                    cookie_renewed: None,
                });
            }
        }
        for record in unsaved {
            persist(record);
        }
    }

    pub fn lookup(&self, token: &str, ip: Option<&str>) -> Option<DeviceMatch> {
        let hash = hash_token(token);
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.get_mut(&hash)?;
        entry.record.last_seen_at = Some(now_rfc3339());
        if let Some(ip) = ip {
            entry.record.last_seen_ip = Some(ip.to_string());
        }
        let now = Instant::now();
        if entry
            .last_persisted
            .is_none_or(|at| now.duration_since(at) >= LAST_SEEN_PERSIST_INTERVAL)
        {
            entry.last_persisted = Some(now);
            persist(entry.record.clone());
        }
        let renew_cookie = entry
            .cookie_renewed
            .is_none_or(|at| now.duration_since(at) >= Duration::from_secs(24 * 3600));
        if renew_cookie {
            entry.cookie_renewed = Some(now);
        }
        Some(DeviceMatch {
            id: entry.record.id.clone(),
            name: entry.record.name.clone(),
            renew_cookie,
        })
    }

    pub fn contains_id(&self, id: &str) -> bool {
        self.entries
            .lock()
            .unwrap()
            .values()
            .any(|entry| entry.record.id == id)
    }

    /// Create a device and return its record and plaintext token.
    pub fn create(
        &self,
        name: &str,
        created_by: &str,
        user_agent: Option<String>,
    ) -> (DeviceRecord, String) {
        let token = format!("{DEVICE_TOKEN_PREFIX}{}", random_token());
        let record = DeviceRecord {
            id: random_token()[..16].to_string(),
            name: name.to_string(),
            token_hash: hash_token(&token),
            created_at: now_rfc3339(),
            created_by: created_by.to_string(),
            user_agent,
            last_seen_at: None,
            last_seen_ip: None,
        };
        self.entries.lock().unwrap().insert(
            record.token_hash.clone(),
            DeviceEntry {
                record: record.clone(),
                last_persisted: Some(Instant::now()),
                cookie_renewed: Some(Instant::now()),
            },
        );
        persist(record.clone());
        (record, token)
    }

    pub fn list(&self) -> Vec<DeviceRecord> {
        let mut records: Vec<DeviceRecord> = self
            .entries
            .lock()
            .unwrap()
            .values()
            .map(|entry| entry.record.clone())
            .collect();
        records.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        records
    }

    pub fn rename(&self, id: &str, name: &str) -> Option<DeviceRecord> {
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.values_mut().find(|entry| entry.record.id == id)?;
        entry.record.name = name.to_string();
        let record = entry.record.clone();
        drop(entries);
        persist(record.clone());
        Some(record)
    }

    /// Revoke a device. Returns its record when it existed.
    pub async fn revoke(&self, id: &str) -> Option<DeviceRecord> {
        let removed = {
            let mut entries = self.entries.lock().unwrap();
            let hash = entries
                .iter()
                .find(|(_, entry)| entry.record.id == id)
                .map(|(hash, _)| hash.clone())?;
            entries.remove(&hash).map(|entry| entry.record)
        };
        if is_db_connected() {
            if let Err(error) = config_queries::db_delete_auth_device(id).await {
                warn!("Failed to delete revoked device {id} from the database: {error}");
            }
        }
        removed
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PairingStatus {
    Pending,
    Approved {
        device_id: String,
        name: String,
        token: String,
    },
    Denied,
}

#[derive(Clone, Debug)]
pub struct Pairing {
    pub pairing_id_hash: String,
    pub code: String,
    pub requested_name: Option<String>,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
    pub requested_at: String,
    pub created: Instant,
    pub status: PairingStatus,
}

impl Pairing {
    pub fn expires_in(&self) -> Duration {
        PAIRING_TTL.saturating_sub(self.created.elapsed())
    }
}

#[derive(Default)]
pub struct PairingStore {
    pending: Mutex<Vec<Pairing>>,
}

/// Uppercase a typed code and drop separators, so `abcd 2345` matches `ABCD-2345`.
pub fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn new_code() -> String {
    let bytes = random_bytes::<8>();
    let chars: String = bytes
        .iter()
        .map(|b| CODE_ALPHABET[(*b as usize) % CODE_ALPHABET.len()] as char)
        .collect();
    format!("{}-{}", &chars[..4], &chars[4..])
}

pub enum PollResult {
    Pending(Duration),
    Approved {
        device_id: String,
        name: String,
        token: String,
    },
    Denied,
    Unknown,
}

impl PairingStore {
    fn prune(pending: &mut Vec<Pairing>) {
        pending.retain(|pairing| pairing.created.elapsed() < PAIRING_TTL);
    }

    /// Start a pairing; returns the secret pairing id and the code to show.
    pub fn start(
        &self,
        requested_name: Option<String>,
        user_agent: Option<String>,
        ip: Option<String>,
    ) -> (String, Pairing) {
        let pairing_id = random_token();
        let mut pending = self.pending.lock().unwrap();
        Self::prune(&mut pending);
        if pending.len() >= MAX_PENDING_PAIRINGS {
            pending.remove(0);
        }
        let mut code = new_code();
        while pending.iter().any(|p| p.code == code) {
            code = new_code();
        }
        let pairing = Pairing {
            pairing_id_hash: hash_token(&pairing_id),
            code,
            requested_name,
            user_agent,
            ip,
            requested_at: now_rfc3339(),
            created: Instant::now(),
            status: PairingStatus::Pending,
        };
        pending.push(pairing.clone());
        (pairing_id, pairing)
    }

    pub fn find_by_code(&self, code: &str) -> Option<Pairing> {
        let code = normalize_code(code);
        let mut pending = self.pending.lock().unwrap();
        Self::prune(&mut pending);
        pending
            .iter()
            .find(|p| normalize_code(&p.code) == code && p.status == PairingStatus::Pending)
            .cloned()
    }

    /// Mark a pending code approved with an already created device.
    pub fn approve(&self, code: &str, device_id: String, name: String, token: String) -> bool {
        let code = normalize_code(code);
        let mut pending = self.pending.lock().unwrap();
        Self::prune(&mut pending);
        match pending
            .iter_mut()
            .find(|p| normalize_code(&p.code) == code && p.status == PairingStatus::Pending)
        {
            Some(pairing) => {
                pairing.status = PairingStatus::Approved {
                    device_id,
                    name,
                    token,
                };
                true
            }
            None => false,
        }
    }

    pub fn deny(&self, code: &str) -> bool {
        let code = normalize_code(code);
        let mut pending = self.pending.lock().unwrap();
        Self::prune(&mut pending);
        match pending
            .iter_mut()
            .find(|p| normalize_code(&p.code) == code && p.status == PairingStatus::Pending)
        {
            Some(pairing) => {
                pairing.status = PairingStatus::Denied;
                true
            }
            None => false,
        }
    }

    /// Poll by the secret pairing id. An approved or denied result is handed
    /// out once and the pairing is then forgotten.
    pub fn poll(&self, pairing_id: &str) -> PollResult {
        let hash = hash_token(pairing_id);
        let mut pending = self.pending.lock().unwrap();
        Self::prune(&mut pending);
        let Some(index) = pending.iter().position(|p| p.pairing_id_hash == hash) else {
            return PollResult::Unknown;
        };
        match pending[index].status.clone() {
            PairingStatus::Pending => PollResult::Pending(pending[index].expires_in()),
            PairingStatus::Approved {
                device_id,
                name,
                token,
            } => {
                pending.remove(index);
                PollResult::Approved {
                    device_id,
                    name,
                    token,
                }
            }
            PairingStatus::Denied => {
                pending.remove(index);
                PollResult::Denied
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_short_unambiguous_and_normalized() {
        let code = new_code();
        assert_eq!(code.len(), 9);
        assert!(code
            .chars()
            .all(|c| c == '-' || CODE_ALPHABET.contains(&(c as u8))));
        assert_eq!(normalize_code(" abcd-2345 "), "ABCD2345");
    }

    #[tokio::test]
    async fn pairing_hands_out_the_token_once() {
        let store = PairingStore::default();
        let (pairing_id, pairing) = store.start(Some("Hallway".into()), None, None);
        assert!(matches!(store.poll(&pairing_id), PollResult::Pending(_)));
        assert!(matches!(store.poll("wrong"), PollResult::Unknown));

        let typed = pairing.code.to_lowercase().replace('-', " ");
        assert!(store.find_by_code(&typed).is_some());
        assert!(store.approve(&typed, "d1".into(), "Hallway".into(), "hcd_t".into()));
        // An approved code cannot be approved again or looked up as pending.
        assert!(!store.approve(&pairing.code, "d2".into(), "x".into(), "y".into()));
        assert!(store.find_by_code(&pairing.code).is_none());

        match store.poll(&pairing_id) {
            PollResult::Approved { token, .. } => assert_eq!(token, "hcd_t"),
            _ => panic!("expected approval"),
        }
        assert!(matches!(store.poll(&pairing_id), PollResult::Unknown));
    }

    #[tokio::test]
    async fn denied_pairings_report_once() {
        let store = PairingStore::default();
        let (pairing_id, pairing) = store.start(None, None, None);
        assert!(store.deny(&pairing.code));
        assert!(matches!(store.poll(&pairing_id), PollResult::Denied));
        assert!(matches!(store.poll(&pairing_id), PollResult::Unknown));
    }

    #[tokio::test]
    async fn pending_pairings_are_bounded() {
        let store = PairingStore::default();
        let (first, _) = store.start(None, None, None);
        for _ in 0..MAX_PENDING_PAIRINGS {
            store.start(None, None, None);
        }
        assert!(matches!(store.poll(&first), PollResult::Unknown));
    }

    #[tokio::test]
    async fn device_tokens_authenticate_until_revoked() {
        let store = DeviceStore::default();
        let (record, token) = store.create("Kitchen tablet", "rasse", Some("UA".into()));
        assert!(token.starts_with(DEVICE_TOKEN_PREFIX));
        assert_ne!(record.token_hash, token);
        let found = store.lookup(&token, Some("192.168.1.9")).unwrap();
        assert_eq!(found.id, record.id);
        assert_eq!(store.list()[0].last_seen_ip.as_deref(), Some("192.168.1.9"));
        assert!(store.lookup("hcd_other", None).is_none());
        assert_eq!(store.rename(&record.id, "Hallway").unwrap().name, "Hallway");
        assert!(store.revoke(&record.id).await.is_some());
        assert!(store.lookup(&token, None).is_none());
        assert!(!store.contains_id(&record.id));
    }
}
