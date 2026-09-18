# ADR 0006: Server-owned scheduler, timers, and recovery

Status: accepted target design (P00). Not yet implemented.

## Boundaries

The state actor owns authoritative timer/job state and validates every expiry. A
scheduler driver owns only a rebuildable wakeup index/min-heap and clock waits.
It emits `Wakeup(job_id, generation, due_at)` and never dispatches actions
directly. Lost/duplicate wakeups cannot bypass authoritative checks.

Use injected clocks with separate UTC wall time, timezone conversion, and
monotonic elapsed time. Never put `Utc::now`, `Local::now`, or real `sleep`
inside pure evaluator functions. Relative timers use monotonic deadlines during
a process lifetime; UTC due times are stored when persistence is enabled.
Calendar schedules use wall time and an explicit IANA timezone, and recheck
calendar waits after wall-clock changes.

## Job model

```
Job {
  id, owner_id, owner_definition_revision, key, generation,
  created_at_utc, due_at_utc, monotonic_deadline? [runtime only],
  handler_or_native_step, payload [bounded JSON],
  persistence: session | durable, misfire_policy,
  captured_target_intents?,
  status: pending | claimed | handled | cancelled | interrupted
}
```

Timer generations are distinct from run generations. Opaque IDs/revisions are
serialized safely for JavaScript; unbounded Rust u64 counters are not exposed as
imprecise JS numbers. `replace(key, after_ms, payload)` replaces only the same
owner/key and increments its generation. `cancel(key)` is idempotent. Zero delay
queues a later event, never inline recursion.

At expiry, capture a **new current frame** and invoke the named handler/native
continuation. The original event and bounded payload may be supplied as
provenance, but present-time conditions read the expiry frame. Do not execute a
captured list of old on/off commands without current guards.

## Recovery semantics

Defaults for new definitions:

- Motion/retriggerable short timers: `session`; restart cancels them.
- Durable delayed jobs: `skip` when overdue, unless the author selects
  `run_once` with a bounded maximum lateness.
- Recurring calendar schedules: skip missed occurrences by default; optional
  coalesced single catch-up; never an unbounded backlog.
- Computed sources: recompute once at startup/current time; do not replay every
  missed tick.

For durable expiry, transactionally claim a matching pending generation before
invoking it. If the process dies after claim but before completion, mark it
interrupted on recovery; do not blindly replay non-idempotent operations. This is
at-most-once attempt semantics, not exactly-once physical effects.

Use `Europe/Helsinki` as one DST test zone. Nonexistent spring-forward local
times are skipped; repeated fall-back local times run once at the earlier
occurrence by default. Persist occurrence identities/cursors so a handled
occurrence is not repeated after clock movement or restart.
