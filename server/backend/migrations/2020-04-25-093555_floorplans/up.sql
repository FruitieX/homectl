CREATE TABLE floorplans (
  id serial PRIMARY KEY NOT NULL,

  name text NOT NULL,
  index integer NOT NULL,
  image bytea NOT NULL
)