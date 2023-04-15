create table devices (
  id serial primary key not null,

  name text not null,
  integration_id text not null,
  device_id text not null,
  scene_id text,

  state jsonb not null,

  unique(integration_id, device_id)
);