CREATE TABLE devices (
  id serial PRIMARY KEY NOT NULL,

  serial text NOT NULL,
  name text NOT NULL,
  path text NOT NULL,
  image bytea,

  UNIQUE(serial)
);