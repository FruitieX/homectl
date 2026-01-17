CREATE TABLE IF NOT EXISTS floorplans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_data BLOB,
    image_mime_type TEXT,
    width INTEGER,
    height INTEGER,
    grid_data TEXT,
    sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO floorplans (
    id,
    name,
    image_data,
    image_mime_type,
    width,
    height,
    grid_data,
    sort_order,
    updated_at
)
SELECT
    'default',
    'Main floorplan',
    image_data,
    image_mime_type,
    width,
    height,
    grid_data,
    0,
    updated_at
FROM floorplan
WHERE NOT EXISTS (
    SELECT 1 FROM floorplans WHERE id = 'default'
);