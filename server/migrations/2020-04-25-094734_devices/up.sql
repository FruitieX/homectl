CREATE TABLE devices (
  id serial PRIMARY KEY NOT NULL,

  name text NOT NULL,
  integration_id text NOT NULL,
  device_id text NOT NULL,
  scene_id text,

  UNIQUE(integration_id, device_id)
);