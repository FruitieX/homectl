ALTER TABLE core_config
    DROP COLUMN IF EXISTS weather_api_url;

ALTER TABLE core_config
    DROP COLUMN IF EXISTS train_api_url;

ALTER TABLE core_config
    DROP COLUMN IF EXISTS influx_url;

ALTER TABLE core_config
    DROP COLUMN IF EXISTS influx_token;

ALTER TABLE core_config
    DROP COLUMN IF EXISTS calendar_ics_url;

CREATE TABLE IF NOT EXISTS widget_settings (
    key TEXT PRIMARY KEY,
    config TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);