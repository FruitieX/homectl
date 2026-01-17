-- Group positions for the floorplan viewport
CREATE TABLE IF NOT EXISTS group_positions (
    group_id TEXT PRIMARY KEY,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    z_index INTEGER NOT NULL DEFAULT 0
);
