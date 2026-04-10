CREATE TABLE IF NOT EXISTS device_display_overrides (
    device_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);