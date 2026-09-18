# ADR 0002: Triggers and temporal behavior

Status: accepted target design (P00). Not yet implemented.

## Decision

1. `triggers` are OR-ed. One domain event matching several triggers invokes the
   routine once and records all matching trigger IDs.
2. Different reports are different events even if payloads and timestamps are
   equal. Do not deduplicate by value.
3. Two independent events close together do not form an implicit AND. Time-window
   correlation must be an explicit state machine or a later temporal feature.
4. State-only condition changes do not run a routine. Use a
   `predicate_transition` trigger when that is desired.
5. A transition is known false -> known true by default. Unknown -> true, first
   discovery, startup, and configuration reload seed state without firing.
   Explicit startup/recovery triggers are separate.
6. Transition memory is keyed by `(routine_id, definition_revision, trigger_id)`,
   never just device ID. Update memory when the trigger is evaluated, even when
   an enclosing condition later prevents execution.
7. Observe report payloads for report triggers; observe the coherent frame for
   state transitions. Distinguish received reports, desired-state commands,
   observed-state changes, and source publications by event kind/origin.
8. No v2 `level` trigger. Use a condition, transition trigger, or explicit
   recurring schedule. A hidden `legacy_internal_update` adapter may exist only
   for compatibility.
9. A `predicate_for` trigger starts a server timer when the predicate becomes
   known true. It cancels on false/unknown and rechecks generation and predicate
   at expiry. Startup/reload seeding does not start a sustained-predicate timer
   for an already-true predicate unless an explicit startup reconciliation option
   requests it.
10. Group membership, device availability, and relevant configuration changes are
    dependency events. Configuration reload normally reseeds transition state
    rather than firing it.

## Trigger vocabulary

`report`, `state_change`, `predicate_transition`, `predicate_for`, `schedule`,
`timer_fired`, `startup`, `manual`. A scripted trigger is a declared
subscription plus a pure filter/transition predicate, never JavaScript
registering hidden listeners during execution.

## Consequences

- v1 trigger modes (`pulse`, `edge`, `level`) remain the v1 interpreter's
  behavior until a routine is deliberately migrated (see ADR 0005 / P01/P02).
- The current bug where queued reports are evaluated against the latest snapshot
  (characterized as E01 in P00) is a correctness target for P02.
