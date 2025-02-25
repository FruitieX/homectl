create table scene_overrides (
  scene_id text primary key not null,
  overrides jsonb not null
);
