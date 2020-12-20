-- Groups can be used to control a large amount of devices at once.
-- CREATE TABLE groups (
--   id serial PRIMARY KEY NOT NULL,
--   name text NOT NULL,
-- );

-- Devices can belong to groups.
-- CREATE TABLE group_devices (
--   group_id integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
--   device_id integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
-- );

-- Groups can also belong to groups, which means "include all devices from child
-- group in parent group".
-- CREATE TABLE group_groups (
--   parent_id integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
--   child_id integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
-- );

-- Scenes can be created for storing and recalling a given state for devices.
CREATE TABLE scenes (
  id serial PRIMARY KEY NOT NULL,

  name text NOT NULL
);

CREATE TABLE scene_state (
  scene_id integer NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  device_id integer REFERENCES devices(id) ON DELETE CASCADE,
  -- group_id integer REFERENCES groups(id) ON DELETE CASCADE,
  group_id text,

  -- Optional link to another device, if set it means "copy state from linked device".
  link_id integer REFERENCES devices(id) ON DELETE CASCADE,

  -- State set on device or group when scene is activated.
  -- If link_id is set, these act as overrides.
  power boolean,
  color jsonb,
  brightness float8,

  PRIMARY KEY (scene_id, device_id, group_id),
  CONSTRAINT device_or_group CHECK ((device_id is not null and group_id is null) or (device_id is null and group_id is not null))
);