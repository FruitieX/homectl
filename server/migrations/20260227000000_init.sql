-- homectl SQLite schema
-- Consolidated initial migration for SQLite

-- Devices (state cache)
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    state TEXT NOT NULL, -- JSON
    UNIQUE(integration_id, device_id)
);

-- Core settings (singleton table)
CREATE TABLE IF NOT EXISTS core_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    warmup_time_seconds INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO core_config (id) VALUES (1);

-- Integrations
CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    plugin TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}', -- JSON
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hidden INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

-- Scenes
CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hidden INTEGER DEFAULT 0,
    script TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scene_device_states (
    scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
    device_key TEXT NOT NULL,
    config TEXT NOT NULL, -- JSON
    PRIMARY KEY (scene_id, device_key)
);

CREATE TABLE IF NOT EXISTS scene_group_states (
    scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    config TEXT NOT NULL, -- JSON
    PRIMARY KEY (scene_id, group_id)
);

-- Scene overrides
CREATE TABLE IF NOT EXISTS scene_overrides (
    scene_id TEXT PRIMARY KEY NOT NULL,
    overrides TEXT NOT NULL -- JSON
);

-- Routines
CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    rules TEXT NOT NULL DEFAULT '[]', -- JSON
    actions TEXT NOT NULL DEFAULT '[]', -- JSON
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Floorplan
CREATE TABLE IF NOT EXISTS floorplan (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    image_data BLOB,
    image_mime_type TEXT,
    width INTEGER,
    height INTEGER,
    grid_data TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO floorplan (id) VALUES (1);

-- Device positions
CREATE TABLE IF NOT EXISTS device_positions (
    device_key TEXT PRIMARY KEY,
    x REAL NOT NULL,
    y REAL NOT NULL,
    scale REAL DEFAULT 1.0,
    rotation REAL DEFAULT 0
);

-- Dashboard
CREATE TABLE IF NOT EXISTS dashboard_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Default',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO dashboard_layouts (id, name, is_default) VALUES (1, 'Default', 1);

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    layout_id INTEGER REFERENCES dashboard_layouts(id) ON DELETE CASCADE,
    widget_type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}', -- JSON
    grid_x INTEGER NOT NULL DEFAULT 0,
    grid_y INTEGER NOT NULL DEFAULT 0,
    grid_w INTEGER NOT NULL DEFAULT 1,
    grid_h INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER DEFAULT 0
);

-- Config versions for import/export history
CREATE TABLE IF NOT EXISTS config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL,
    description TEXT,
    exported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    config_json TEXT NOT NULL -- JSON
);

-- UI state (key-value store)
CREATE TABLE IF NOT EXISTS ui_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL -- JSON
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_group_devices_group_id ON group_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_group_links_parent ON group_links(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_group_links_child ON group_links(child_group_id);
CREATE INDEX IF NOT EXISTS idx_scene_device_states_scene ON scene_device_states(scene_id);
CREATE INDEX IF NOT EXISTS idx_scene_group_states_scene ON scene_group_states(scene_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_layout ON dashboard_widgets(layout_id);
