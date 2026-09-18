# ADR 0001: Automation domain model and terminology

Status: accepted target design (P00). Not yet implemented.

## Context

The v1 system models automations as routines made of rules and actions. Rules
mix triggers and conditions in a single untagged tree, evaluation is folded into
the state actor, and external services (timer, cron, circadian) are modeled as
fake integrations with synthetic devices. Automation v2 separates these
concerns while keeping the state-actor/snapshot architecture.

## Decision

A **routine** is an event-triggered program:

`event -> eligible routine -> condition -> action plan -> actor acceptance -> dispatch`

A **computed source** uses the same execution infrastructure but returns a typed
value instead of commands:

`declared event/time dependency -> source evaluation -> value publication -> dependent scene refresh`

These are separate **output contracts**, not separate schedulers or scripting
environments.

### Terms

- **Event**: something occurred, with identity, origin, timestamp, and a
  coherent before/after view. A repeated identical sensor report is still an
  event.
- **Predicate**: a pure question about an explicitly selected state view. It
  returns true, false, or unknown. Evaluation failure is represented separately
  as an error (see ADR 0003).
- **Intent**: requested lighting mode, assigned scene, manual override, or
  desired device state. Intent is not proof of physical output.
- **Plan**: validated, resolved commands and internal operations produced by one
  invocation. Constructing a plan performs no effects.
- **Job**: a server-owned future invocation represented as data, not a sleeping
  JavaScript stack or captured closure.
- **Source**: a typed computed value with declared dependencies, freshness, and
  provenance.

## Consequences

- Native and scripted automations share triggers, the command planner, timers,
  diagnostics, and simulation. No second execution engine is introduced.
- Rust owns time, cancellation, persistence, subscriptions, validation,
  execution authority, and device communication. JavaScript owns bounded custom
  decisions and plan construction only.
- Circadian behavior becomes a computed light-profile source consumed by scenes;
  it must not become a periodic command to every light.
- `AppState` remains actor-owned with `StateHandle` mutation and ArcSwap reader
  snapshots. No `Arc<RwLock<AppState>>`, no cloning `AppState`, no mutation of
  live state from workers.
