# Reusable JavaScript blocks and functions

Investigated 2026-10-01. **Proposal for discussion; no new JavaScript feature
has been implemented.** This describes the current code and a possible next
step, rather than an approved implementation plan.

## What works today

| Feature | Current behavior |
| --- | --- |
| Routine JavaScript | Sandboxed handlers and individual script actions return typed actions through the ordinary routine planner. A script can declare local functions inside its own body. |
| Reusable blocks | Database-backed action/condition templates with typed arguments. Native actions and helper reads/writes are supported. Validation explicitly rejects script actions inside blocks. |
| State helpers | Database-backed boolean, enum, number and string values. Scripts can read them through `api.values.get` and return writes through `api.actions.setHelper`. They are stored state, not executable functions. |
| Computed sources | Custom JavaScript already works, but currently takes parameters and injected time and produces a light profile. It does not read live sensor/device state or produce arbitrary boolean/number helper values. |
| Shared JavaScript functions | There is no user-managed module/function registry or script import/dependency field. Sharing code across script bodies currently requires copying it. |

Another routine can be invoked through the existing action, including one with
a script program. That runs as a separate routine; the invoke action supplies
its ID and an invocation mode, rather than typed block arguments in the caller's
execution frame.

These findings come from `AutomationBlock`, block validation/expansion,
`ScriptSpec`, `HelperDefinition`, `SourceCompute`, source invocation context,
and the actual worker prelude. Older architecture ADRs describe broader target
contracts and do not by themselves establish that a UI/runtime feature exists.

## Useful additions

**Scripted action blocks** are the most direct addition: define custom behavior
once, supply typed inputs, and use it as a visible node in several routines.
Good examples include selecting scenes according to a household mode helper
or interpreting single/double/hold/off button actions consistently.

**Pure shared functions** help when the repeated part is calculation: brightness
curves, color conversions, temperature-based warm-up calculations or scene
selection. They could be used by routine scripts and computed sources while
keeping each caller's existing execution contract.

**Scripted condition blocks** could return a strict boolean or the existing
explicit unknown result. This needs additional condition-runtime integration:
the present reusable condition schema has no JavaScript leaf. It is more than
allowing a script action in the existing action validator.

**Automatically computed state helpers** are a separate capability: for example,
an occupancy boolean or heating-demand number derived from sensors. They need
declared dependencies, recomputation scheduling, freshness/error reporting and
clear rules for whether the value is writable. Existing light-profile sources
cannot provide this just by changing their script body.

## Recommended scope

Start with reusable scripted action blocks if several routines already repeat
the same code. Extend the existing Blocks editor with a JavaScript body and its
typed inputs, preserving visual calls in routine flows. Shared pure functions
are a useful follow-up when calculations are duplicated across different kinds
of scripts. Generic computed helpers become valuable when there is a concrete
sensor-derived value to expose throughout the home.

Routine-local functions remain sufficient for code used in just one routine.
Native blocks already serve ordinary scene, dimming and helper operations.

## Implementation constraints

- Persist source, typed inputs and revisions in the database, with API/editor
  support and default-empty, round-trip-tested export/import representation.
- Pass arguments as validated data; never interpolate values into source text.
- Execute within the existing supervised worker system, outside the state
  actor, using the captured caller context and normal output validation.
- Action blocks return native action data. Pure functions produce values.
  Conditions preserve unknown values explicitly. No new direct device/I/O path
  is needed.
- Track fixed block/function dependencies and reject cycles. Edits must
  revalidate affected callers, advance their revisions and invalidate obsolete
  queued/in-flight results, as existing native blocks do.
- Load dependencies within the same bounded invocation, with fresh contexts
  and no shared mutable globals. Source calculations retain their restricted
  context; using a library must not silently give them live-device access.
- Show usages, argument validation and script diagnostics in the editor.
  Household members should still be able to understand the block's name,
  inputs and role without reading its implementation.

See [existing block behavior](automation-blocks.md) and
[routine script action examples](routine-scripts.md).
