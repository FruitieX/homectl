# homectl

Discord: https://discord.gg/xP2s6EY8rd

🚧 WORK IN PROGRESS 🚧

Note: this project is still in quite early stages. Regardless, I've been using
this as a daily driver for over a year now. This is also my first "real" Rust
project, which brings with it the usual caveats. Luckily refactoring Rust code
is a fairly pleasant experience.

If you're not ready to get your hands dirty with Rust code, I would suggest
trying out other alternatives for now.

### Quick start

- Install the Rust toolchain using [`rustup`](https://rustup.rs/)
- Clone this repository
- From `server/`, run `RUST_LOG=homectl_server=info cargo run`

You should now have a demo/dummy homectl environment running.

By default, homectl reads `Settings.toml` from the current working directory
and starts from that config in memory.

To enable persistent storage, point homectl at PostgreSQL:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
RUST_LOG=homectl_server=info cargo run
```

If the database named in `DATABASE_URL` does not exist yet, homectl creates it
automatically before running migrations as long as the configured PostgreSQL
role has permission to create databases.

If persistence is unavailable at startup, you can still boot the server from a
JSON export backup or legacy TOML config:

```
RUST_LOG=homectl_server=info cargo run -- --config ./config-backup.json
```

When the database cannot be opened, homectl falls back to the backup config or
an empty runtime snapshot and continues in memory-only mode. If a configured
PostgreSQL database comes back later, homectl reconnects in the background and
seeds an empty database from the live in-memory snapshot. Manual PostgreSQL
config edits are only picked up on startup; while the server is running,
config changes are expected to go through homectl itself.

To control your home automation systems, edit `Settings.toml` or start from a
JSON export created via `/api/v1/config/export`. See below sections for
configuration instructions and examples.

### Health checks

The server exposes health endpoints suitable for Kubernetes or other orchestrators:

- Liveness: GET http://localhost:45289/health/live — always returns 200 OK while the process is up
- Readiness: GET http://localhost:45289/health/ready — returns 200 OK when startup warmup is complete and the database (if configured) is reachable, otherwise 503

Examples:

```
curl -sS http://localhost:45289/health/live | jq
curl -sS http://localhost:45289/health/ready | jq
```

## Description

This project aims to unify home automation (HA) systems from different
brands, and does so by assuming complete control over the individual systems.
It brings some features that I felt are missing from consumer HA systems,
and also other similar solutions to homectl:

- A common interface for configuring everything in one place (plaintext config file for now).

  - (Hopefully) no more figuring out obscure schedule/rule/condition/action
    configuration that vary per HA supplier. (Instead you have homectl's
    obscure configuration file format for now, but this will be improved upon
    later! :-))

- Allow complete control of actions performed when sensors/buttons are triggered.

  - Because homectl only reads sensor values from HA systems, we are not
    limited by what actions can be programmed into the individual HA system
    controllers.

  - For example, you can put your computer to sleep/wake when you turn off/on
    the lights to your office.

  - Or you could start a robot vacuum when leaving your home between certain
    times of the day.

  - You can also control other manufacturers devices than the one that made the
    light switch you pressed

- Don't trust that the HA systems always do what you want

  - Some HA systems are not as reliable as you would hope, and may for example
    miss a command that you send them.

  - Or a device might simply forget its state due to an accidental power cycle.

  - Due to this, homectl will keep track of the expected state for each device,
    and actively poll devices for their current state, automatically correcting
    any incorrect state it might find.

- An advanced scenes system allow controlling a large amount of devices to preset states.

  - Because homectl keeps track of a device's active scene, we can perform
    certain actions only when a device is in a certain scene. For example, we
    can bind a light switch to multiple scenes and cycle between the scenes.

  - Scenes may "link" state from other devices: "go look up what the state of
    this device is and copy the state from there".

  - These devices can be "virtual" devices, such as a device that returns the
    approximate color of the sky.

  - Combine these facts and you can e.g. have your lights smoothly follow a
    circadian rhythm. These transitions will be so smooth that you won't
    notice them. Every time homectl polls your lights their expected state is
    calculated and compared against the actual state. If the difference is
    large enough (still imperceptibly small), then homectl will update the
    lights to match the expected state.

## Setup

### CLI flags and environment variables (optional)

- `DATABASE_URL` or `--database-url`: Optional PostgreSQL connection string used
  for persistence.
- `CONFIG_FILE` or `--config`: Path to a JSON backup export or legacy TOML
  config file. Used to seed an empty database and as a startup fallback when
  the database is unavailable.
- `PORT` or `--port`: API port. Defaults to `45289`.
- `WARMUP_TIME` or `--warmup-time`: Override the configured warmup time in
  seconds.

### Persistence behavior

- No external database service is required. If `DATABASE_URL` is unset,
  homectl starts directly from `--config` or an empty in-memory runtime.
- If PostgreSQL is configured and the target database does not exist yet,
  homectl creates it automatically before running migrations.
- If PostgreSQL is configured but unavailable and `--config` is provided,
  homectl still starts from that JSON or TOML snapshot and keeps config changes
  in memory until persistence returns.
- If PostgreSQL reconnects later and the database is empty, homectl backfills it
  from the live in-memory runtime snapshot.
- If PostgreSQL reconnects later and already contains config, homectl keeps the
  current in-memory runtime until restart instead of live-reloading database
  edits.
- Manual PostgreSQL config edits should be done while homectl is stopped, then
  applied by restarting the server.
- `/api/v1/config/export` returns a JSON backup that can be reused with
  `--config` on a later startup.
- `/api/v1/config/runtime-status` reports whether persistence is currently
  available and whether the process is running in memory-only mode.

### Simulation mode

Simulation mode always runs the server with an in-memory runtime snapshot.

- `cargo run -- simulate --config ./config-backup.json` loads a JSON export or legacy TOML backup.
- `cargo run -- simulate --source-db ./legacy.sqlite` mirrors a legacy SQLite source database.
- `cargo run -- simulate --source-db postgres://postgres:postgres@localhost:5432/postgres` mirrors a PostgreSQL runtime database.

Simulation rewrites MQTT integrations into dummy integrations so the copied config can run locally without the original transport.
