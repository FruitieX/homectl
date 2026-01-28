-- homectl configuration tables migration
-- This migration adds tables for storing all configuration entities in PostgreSQL

-- Core settings (singleton table)
CREATE TABLE IF NOT EXISTS core_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    warmup_time_seconds INTEGER DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO core_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Integrations
CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    plugin TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hidden BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_devices (
    group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    integration_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    device_id TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (group_id, integration_id, device_name)
);

CREATE TABLE IF NOT EXISTS group_links (
    parent_group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    child_group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (parent_group_id, child_group_id)
);

-- Scenes - drop old table and create new schema
DROP TABLE IF EXISTS scenes CASCADE;

CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hidden BOOLEAN DEFAULT FALSE,
    script TEXT,  -- JS script for dynamic scenes (replaces evalexpr)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scene_device_states (
    scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
    device_key TEXT NOT NULL,  -- "integration_id/device_id" format
    config JSONB NOT NULL,      -- SceneDeviceConfig as JSON
    PRIMARY KEY (scene_id, device_key)
);

CREATE TABLE IF NOT EXISTS scene_group_states (
    scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    config JSONB NOT NULL,  -- SceneDeviceConfig as JSON
    PRIMARY KEY (scene_id, group_id)
);

-- Routines
CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    rules JSONB NOT NULL DEFAULT '[]',
    actions JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Floorplan
CREATE TABLE IF NOT EXISTS floorplan (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    image_data BYTEA,
    image_mime_type TEXT,
    width INTEGER,
    height INTEGER,
    grid_data TEXT,  -- JSON string for floorplan grid
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO floorplan (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS device_positions (
    device_key TEXT PRIMARY KEY,  -- "integration_id/device_id" format
    x REAL NOT NULL,
    y REAL NOT NULL,
    scale REAL DEFAULT 1.0,
    rotation REAL DEFAULT 0
);

-- Dashboard
CREATE TABLE IF NOT EXISTS dashboard_layouts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Default',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default dashboard layout
INSERT INTO dashboard_layouts (name, is_default) VALUES ('Default', TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id SERIAL PRIMARY KEY,
    layout_id INTEGER REFERENCES dashboard_layouts(id) ON DELETE CASCADE,
    widget_type TEXT NOT NULL,  -- 'clock', 'sensors', 'weather', 'spot_price', etc.
    config JSONB NOT NULL DEFAULT '{}',  -- Widget-specific configuration
    grid_x INTEGER NOT NULL DEFAULT 0,
    grid_y INTEGER NOT NULL DEFAULT 0,
    grid_w INTEGER NOT NULL DEFAULT 1,
    grid_h INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER DEFAULT 0
);

-- Config versions for import/export history
CREATE TABLE IF NOT EXISTS config_versions (
    id SERIAL PRIMARY KEY,
    version INTEGER NOT NULL,
    description TEXT,
    exported_at TIMESTAMPTZ DEFAULT NOW(),
    config_json JSONB NOT NULL
);

-- Indices for common queries
CREATE INDEX IF NOT EXISTS idx_group_devices_group_id ON group_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_group_links_parent ON group_links(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_group_links_child ON group_links(child_group_id);
CREATE INDEX IF NOT EXISTS idx_scene_device_states_scene ON scene_device_states(scene_id);
CREATE INDEX IF NOT EXISTS idx_scene_group_states_scene ON scene_group_states(scene_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_layout ON dashboard_widgets(layout_id);
