CREATE TABLE IF NOT EXISTS device_sensor_configs (
    device_ref TEXT PRIMARY KEY,
    interaction_kind TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);