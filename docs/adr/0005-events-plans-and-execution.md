# ADR 0005: Coherent events, action plans, and execution

Status: accepted target design (P00). Not yet implemented.

## Event frame

Introduce an owned immutable `AutomationFrame`:

```
EventId { boot_id, sequence }
kind, origin, cause_id, parent_event_id?, causation_depth
received_at_utc, evaluation_time_utc
config_revision, snapshot_revision, batch_id?
source identity and original report payload when relevant
before: Arc<AutomationSnapshot>
after: Arc<AutomationSnapshot>
changed resources and evidence metadata
```

`before` and `after` are from the same logical transaction. A worker must never
pair an event's old/new payload with whatever ArcSwap snapshot happens to be
latest. This is the correctness target for the queue-order hazard currently
characterized as E01 in P00.

## Mutation-to-event sequence

Within a state-actor command:

1. Capture the transaction's before view.
2. Normalize input and apply authoritative changes, recording actual reports
   separately from derived desired-state changes.
3. Update cheap native group/scene-derived state; enqueue asynchronous scripted
   scene/source materialization rather than running JS.
4. Capture the after view and create the domain event(s).
5. Evaluate native trigger eligibility and cheap native conditions against the
   frame; schedule bounded script work for candidates.
6. Publish reader snapshot changes. Commit plans through actor-owned acceptance;
   their mutations create causally linked transactions.

No recursive unbounded evaluation inside a mutation. A fixed budget and
causation limit terminate loops visibly. Preserve the legacy per-update
projection for v1 while it remains live.

## Action planning and execution

`ResolvedActionPlan` includes run/event/owner IDs, definition fingerprint,
frozen targets and source-derived values, expected intent revisions, internal
operations, command list, and trace information. Native and script-returned
actions pass the same validator/planner.

Execution policies, without unbounded parallelism:

- `single`: reject while one invocation is pending/in flight.
- `restart`: invalidate the previous run generation, retain only the latest.
- `queued`: preserve accepted event order up to a bound; overflow rejects with a
  trace. This is the default for general event-driven routines.

Routine-owned timers are separate from run concurrency. Named replacement only
cancels the same `(owner_id, timer_key)`. Disable/delete/definition edit
invalidates the owner's runs and jobs.

Do not claim DB durability can atomically commit physical lamp state. Durable
internal operations in one plan commit together or none do; external effects
occur afterwards and remain best effort. If device intents changed while
persistence was in flight, suppress stale device effects and report the partial
outcome rather than silently undoing committed internal state.
