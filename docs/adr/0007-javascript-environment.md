# ADR 0007: JavaScript worker environment and contracts

Status: accepted target design (P00). Not yet implemented.

## Invocation contracts

Use the same `api_version` and normalized state access across four contracts:

1. Condition/filter: strict boolean or an explicit unknown result; no commands
   or state writes.
2. Routine handler: returns `{ actions, next_state? }` with bounded JSON state.
3. Scene materializer: returns typed scene configuration/overrides, not effects.
4. Computed source: returns one value matching its declared output schema, not
   commands.

All script work happens outside the state actor, including scene invalidation,
previews, validation, and startup materialization. Native helpers may execute in
Rust; user computation is isolated in workers.

Expose immutable `ctx.event`, `ctx.before`, `ctx.after`, fixed `ctx.now`,
timezone-aware time helpers, typed device/group/value/source accessors, current
per-owner memory, revision/provenance, and namespaced logging. `api` contains
pure truth/predicate, scene/action, timer, color, interpolation, and state-result
builders. Builders return data; they do not communicate with integrations.

A condition script returning a nonempty string, Promise, array, or object other
than the explicit unknown shape is an error, not a truthy success. Plain
JavaScript `!` is not a substitute for the SDK's unknown-preserving negation;
provide typed helpers.

No direct filesystem, network, process, DB, environment-secret, or raw MQTT
access. Integration actions are allowlisted typed commands dispatched normally.
There is no live `setTimeout`/`setInterval`; schedules/timers are plan
operations. A worker has no durable global state.

## Subscriptions vs read tracking

Subscriptions answer **when to invoke**; a read set answers **what the
invocation observed**. Do not conflate them. Native triggers derive exact
subscriptions from typed references. Script transition predicates and computed
sources declare devices/groups/values, event kinds, and time dependencies.
Conservative wildcard subscription is allowed with an explicit UI warning.
Undeclared reads in a strict v2 source/transition script fail visibly.
Regex/string searches in source may suggest declarations only.

## Worker supervision

Start with a small bounded worker pool (e.g. two workers, one invocation each)
and a default 200 ms planning budget, exposed as profiles only after measuring
real use. A worker is a separate server binary using length-prefixed JSON IPC.
The parent validates message size before allocating, associates
request/run/generation IDs, kills and reaps on timeout/crash/protocol error, and
replaces the worker. Clear inherited secrets/environment; do not inherit DB
handles. An OS child alone is not a complete hostile-code sandbox; fault
containment and security isolation are distinct and must be tested separately.

Do not call `spawn_blocking(...).await` from the state actor and call that
isolation. Fresh realms/contexts prevent global/prototype leakage between
invocations; construct Boa-owned objects inside their worker. Cache source
validation/fingerprints first; add compiled-program reuse only where the pinned
engine supports it and isolation tests prove it. Never cache condition results
merely because source text is unchanged.

## Coexistence with v1

Do not leave a direct actor script path while v1 rows exist. For each legacy
frame, capture native leaf results in original traversal order, apply legacy
trigger-memory updates under actor ownership, and identify script leaves by
stable path. Workers return only their leaf results, combined with captured
native results, never with a fresh live-state evaluation. V1 scene scripts keep
their separately identified expression/output format.
