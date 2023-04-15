create table scenes (
  id serial primary key not null,

  scene_id text not null,
  config jsonb not null,

  unique(scene_id)
);