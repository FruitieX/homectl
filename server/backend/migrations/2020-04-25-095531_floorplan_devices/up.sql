CREATE TABLE floorplan_devices (
  id serial PRIMARY KEY NOT NULL,

  floorplan_id integer NOT NULL REFERENCES floorplans(id) ON DELETE CASCADE,
  device_id integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  x float8 NOT NULL,
  y float8 NOT NULL,

  UNIQUE(floorplan_id, device_id)
);