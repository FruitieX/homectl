# homectl automation v2 — implementation plan and coding-agent handoff

**Baseline:** FruitieX/homectl, commit `5aef129c`.
**Purpose:** specification and implementation sequence; no repository code was changed to prepare this plan.
**Verification:** static source inspection, not a build, benchmark, live-DB inspection, or executed migration. Existing behavior is referenced in Appendix A. Everything named as a new type, module, endpoint, or policy below is a proposal, not an existing API.

## 0. Decision and working rules

Replace timer, cron, and circadian **integration wrappers**, not the services they provide. Build one automation runtime with native event triggers, conditions, action planning, a server-owned scheduler, and bounded JavaScript workers. Offer native UI presets and JavaScript extensions on the same contracts.

- Rust owns time, cancellation, persistence, subscriptions, validation, execution authority, and device/integration communication.
- JavaScript owns custom decisions, calculations, named event handlers, and action-plan construction. It may return bounded persistent state and schedule future named events.
- Circadian behavior becomes a computed light-profile source. Scenes continue to consume a reactive source; it must not become an indiscriminate periodic command to every light.
- Native and scripted automations use the same triggers, command planner, timers, diagnostics, and simulation infrastructure. Do not introduce another execution engine for scripts.

### Non-negotiable constraints

Retain `AppState`'s single state-actor ownership, `StateHandle` mutation entry points, and ArcSwap reader snapshots. Do not add `Arc<RwLock<AppState>>`, clone `AppState`, or mutate live state from workers. User-editable definitions, helper values, source parameters, scripts, and schedules belong in the DB, not Settings.toml. Preserve SQLite and PostgreSQL support and configuration export/import. [A1]

Keep v1 and v2 interpretation separate until migration is explicitly approved. Version absence means v1. Do not turn a legacy level predicate into a rising-edge trigger automatically. Do not delete integrations before a reference inventory and cutover tests succeed.

### How to use this with a coding agent

Implement one work package from Section 12 at a time. Each package must leave the repository buildable and retain the preceding package's tests. Before code changes, read root AGENTS.md and the listed baseline code. Record actual current symbol locations when working on a later revision; do not assume these baseline line numbers still apply.

For each package, require: changed-file summary, contract implemented, tests added and actually run, any intentional semantic changes, unresolved limitations, and the next package's prerequisites. A skipped test is not a passing test. Do not perform unrelated UI/library/framework upgrades. Do not modify production DB rows or automatically enable migrated automations while developing.

Use this kickoff instruction:

> Implement only work package Pxx from this plan. Read its prerequisites and applicable normative contracts first. Write characterization/regression tests before changing behavior. Preserve the v1 interpreter unless the package explicitly authorizes a named correctness change. Use DB-backed configuration and the existing actor/snapshot architecture. Do not add a second JavaScript automation runtime, real timers inside scripts, or an integration actor for an internal service. Run the specified checks and report exact results. Do not continue into the next package automatically.

## 1. Target model and terminology

A routine is an event-triggered program:

`event -> eligible routine -> condition -> action plan -> actor acceptance -> dispatch`

A computed source uses the same execution infrastructure but returns a typed value rather than commands:

`declared event/time dependency -> source evaluation -> value publication -> dependent scene refresh`

These are distinct **output contracts**, not separate schedulers or unrelated scripting environments.

### 1.1 Domain boundaries

**Event:** something occurred, with identity, origin, timestamp, and a coherent before/after view. A repeated identical sensor report is still an event.

**Predicate:** a pure question about an explicitly selected state view. It returns true, false, or unknown; evaluation failure is separately represented as an error.

**Intent:** requested lighting mode, assigned scene, manual override, or desired device state. It is not proof of physical output.

**Plan:** validated, resolved commands and internal operations produced by one invocation. Constructing a plan does not perform effects.

**Job:** a server-owned future invocation represented as data, not a sleeping JavaScript stack or captured closure.

**Source:** a typed computed value with declared dependencies, freshness, and provenance. A circadian light profile is a source, not a pretend external hardware connection.

### 1.2 Multiple triggers and temporal behavior

1. `triggers` are OR-ed. One domain event matching several triggers invokes the routine once and records all matching trigger IDs.
2. Different reports are different events even if their payloads and timestamps are equal. Do not deduplicate them by value.
3. Two independent events occurring close together do not form an implicit AND. A time-window correlation must be an explicit state machine or later temporal feature.
4. State-only condition changes do not run a routine. Use a `predicate_transition` trigger when that is desired.
5. A transition is known false -> known true by default. Unknown -> true, first discovery, startup, and configuration reload seed state without firing. Explicit startup/recovery triggers are separate.
6. Trigger transition memory is keyed by `(routine_id, definition_revision, trigger_id)`, never just device ID. Update memory when the trigger is evaluated even when an enclosing routine condition later prevents execution.
7. Observe report payloads for report triggers; observe the coherent frame for state transitions. Distinguish received reports, desired-state commands, observed-state changes, and source publications by event kind/origin.
8. No v2 `level` trigger. Use a condition, transition trigger, or explicit recurring schedule. A hidden `legacy_internal_update` adapter may exist only for compatibility.
9. A `predicate_for` trigger starts a server timer when the predicate becomes known true. It cancels on false or unknown and checks the generation and predicate again at expiry. It is not repeated delay scheduling on every unrelated update. By default startup/reload seeding does not start a sustained-predicate timer for an already-true predicate; an explicit startup reconciliation/initialization option can do so.
10. Changes to group membership, device availability, and relevant configuration are dependency events. Configuration reload normally reseeds transition state rather than firing it.

### 1.3 Conditions, unknowns, and errors

Use a tagged `ConditionExpr` with `Literal`, `All`, `Any`, `Not`, native predicates, and `ScriptCondition`. Supply stable node IDs for tracing. Reject empty `All`/`Any` in stored v2 definitions; an omitted routine condition normalizes to `Literal(true)`.

Truth tables use strong three-valued logic:

| Expression | Result |
|---|---|
| `not true`, `not false`, `not unknown` | false, true, unknown |
| `all(false, unknown)` | false |
| `all(true, unknown)` | unknown |
| `any(true, unknown)` | true |
| `any(false, unknown)` | unknown |

For the first implementation, evaluate all nodes of an eligible condition tree to produce a complete trace. Any evaluated error makes the condition evaluation an error and prevents execution, even when a sibling would otherwise decide the result. Do not convert a script error into false and then let `not` turn it into true. If short-circuit evaluation is later introduced, it requires an explicit semantics review and `not_evaluated` trace nodes.

Provide explicit `entity_exists`, `has_report`, `field_exists`, `is_known`, and availability/freshness predicates. These ask about metadata and can return a known false even when a value comparison would be unknown. Do not make `not(power == true)` the way to test existence or availability.

Unknown reasons are structured: `missing_entity`, `missing_field`, `offline`, `stale`, `empty_selection`, `not_initialized`, `unknown_source_value`. A reference known to be invalid at save time is normally a validation error, not a silently accepted unknown. An entity that disappears after save becomes a runtime unknown and visible diagnostic.

Native observed-state predicates use actual report/evidence metadata, not desired state relabeled as observation. An explicitly offline source makes observed current-state claims unknown. A fresh report need not have a separate online flag to be usable. Optional per-source `max_age_ms` controls staleness; do not invent one global timeout for all sensors. When freshness affects transitions, schedule an expiry dependency event rather than waiting for unrelated traffic. Restored cached observations start stale/unconfirmed unless a documented migration policy explicitly trusts them. Requested-state and intent predicates can remain known while a device is offline.

### 1.4 Group semantics

Build group membership from configured references, recursively flattened and deduplicated, **including unresolved configured members**. Do not use the current resolved-devices-only group view as the denominator. Detect group cycles at save/import time. Membership changes increment a group-definition revision. [A7]

Provide a common `GroupEvaluation` used by native rules, SDK helpers, and explanations:

`configured_count, true_count, false_count, unknown_count, members[], truth, reasons[]`

- `all`: false if any member is known false; true if all are known true; otherwise unknown.
- `any`: true if any member is known true; false if all are known false; otherwise unknown.
- `partial`: true if at least one known match and one known non-match exist. False if all members are known and no such mixture exists, or if fewer than two members are selected. Otherwise unknown.
- An empty selection is unknown for automation group predicates, including `any`; it must not make a negated predicate succeed.
- The default selector means all configured members. A future “available members only” selector must be explicitly selected and displayed; never filter unavailable members implicitly.
- Unsupported capability is a validation/type issue where statically knowable; a dynamic unavailable field is unknown, not a false physical fact.

Expose **requested mode**, **common assigned scene**, and **observation quality** separately. A group common-scene summary is `uniform(scene_id)`, `unassigned`, `mixed`, or `unknown`, accompanied by member details and quality. Do not infer intent from a majority scene or first device. Offline status does not erase a known assigned scene, but missing member assignments prevent a definitive complete summary.

## 2. Versioned definitions, compiler, and persistence layout

### 2.1 Definitions

Add new modules, initially without replacing `types/rule.rs`:

```
server/src/types/automation.rs
server/src/types/automation_event.rs
server/src/types/automation_script.rs
server/src/types/automation_schedule.rs
server/src/types/automation_source.rs
server/src/types/automation_trace.rs
server/src/core/automation/{mod,compile,evaluate,groups,plan,execute,trace,index}.rs
server/src/core/automation/scheduler/{mod,clock,calendar,jobs,recovery}.rs
server/src/core/automation/scripts/{mod,protocol,supervisor,sdk}.rs
server/src/core/automation/sources/{mod,circadian_compat}.rs
```

These names are proposed; split further only when implementation size warrants it. Reuse existing scene/device command normalization and integration dispatch, not raw MQTT publications from the new engine.

The external routine record remains metadata plus a versioned definition:

```
RoutineRecord {
  id, name, enabled,
  revision,
  semantics_version: 1 | 2,
  definition_v2?: RoutineDefinitionV2,
  rules?: legacy JSON,
  actions?: legacy JSON
}
RoutineDefinitionV2 {
  triggers: TriggerSpec[],
  condition: ConditionExpr,
  program: NativeProgram | ScriptProgram,
  execution: ExecutionPolicy
}
```

`semantics_version` is authoritative; do not create conflicting independently editable version fields. Unknown versions are rejected/quarantined, never interpreted as v1. V2 IDs are stable identifiers; rename display labels without rewriting IDs. Preserve existing v1 rename APIs during compatibility.

`TriggerSpec` includes a stable ID and an explicitly tagged body: `report`, `state_change`, `predicate_transition`, `predicate_for`, `schedule`, `timer_fired`, `startup`, `manual`. A scripted trigger is a declared subscription plus a pure filter/transition predicate, not JavaScript registering hidden listeners during execution.

`NativeProgram` contains a bounded sequence of typed actions, including ordered `choose`, schedule/replace/cancel timer, helper-value changes, and explicit routine invocation. Ordered `choose` executes the first true branch; a preceding unknown or error blocks selection by default, so uncertainty does not silently select a lower-priority branch. A later opt-in skip-unknown policy is not required initially.

`ScriptProgram` references a `ScriptSpec { api_version, source_body, declarations, limits_profile }`. Begin with function-body source so `return` is unambiguous. Normalize all v2 script contexts to the same invocation ABI. Existing top-level expression scripts remain a separately identified v1 format. [A8, A17]

### 2.2 Shared compiler

Define a pure compiler conceptually as:

`compile(definition, ConfigCatalog) -> CompiledDefinition | ValidationReport`

It returns normalized tagged data, resolved typed references, trigger subscriptions, resource dependencies, write capabilities, source locations/node IDs, and definition fingerprint. Syntax compilation for JS occurs in a worker, not the state actor. Only the completed validated result may be enabled.

The compiler must be used by save, enable, import, runtime load, simulation, reference inventory, and migration analysis. Do not duplicate traversal logic in each endpoint. Regexes/JSON-pointer syntax are validated once. Script dependency inference may offer suggestions, but must not be the sole scheduler authority.

Validation errors contain `{path, node_id?, code, message, related_entity?}`. Reject malformed JSON, ambiguous tags, unknown enum variants, duplicate IDs, missing action arguments, invalid durations, nonfinite/out-of-range values, incompatible capabilities, group/scene/source cycles, invalid timezone/cron expressions, unauthorized script commands, and impossible output schemas. A draft can be saved only as explicitly invalid and disabled; enabling requires successful validation. A disabled definition must still be inspected and included in dependency/migration inventories.

### 2.3 Additive database changes

Use the active SeaORM migration registry in `server/src/db/migrations/mod.rs`, not only the retained legacy SQL directory. Update `schema.rs`, query builders, and row serializers. [A2]

Proposed data:

| Storage | Contents |
|---|---|
| Existing `routines` | Add `semantics_version NOT NULL DEFAULT 1`, `definition_v2 NULL`, and `revision`; preserve legacy columns during migration. |
| `automation_values` | Typed helper definitions, names, enum options/ranges, initial value, persistence policy. |
| `automation_value_state` | Current durable helper value and revision; transient values live only in actor state. |
| `automation_sources` | Computed-source definition, output type, parameter JSON, script/builtin version, subscriptions, update policy. |
| `automation_owner_state` | Optional bounded JSON state per routine/source owner with optimistic revision. |
| `automation_jobs` | Durable named timers/continuations, generations, owner revision, due time, payload, recovery policy, status. |
| `automation_schedule_state` | Last handled occurrence/cursor for durable recurring schedules and definitions' fingerprints. |
| Migration archive/manifest | Original raw rows and source hashes, proposed mappings, approval state, intentional differences. |

Only create tables when the corresponding work package needs them. Do not build a generic entity/EAV framework.

Configuration exports include definitions, scripts, parameters, compatibility mappings, and an explicitly defined policy for current durable helper values. They exclude live jobs, VM state, and occurrence cursors by default. Restoring a configuration backup must not replay old timers or actions. A separate operational checkpoint, if ever needed, is a different format. New import fields default empty/absent; newer unsupported semantics must not be silently discarded.

DB-unavailable behavior must be explicit. The existing app has an in-memory fallback, so retain an observable ephemeral mode, but do not report durable writes as persisted. Durable-only automation operations fail without effects; ephemeral helper/timer operations may run with a visible nonpersistent status. [A1]

## 3. Coherent events and state-actor integration

### 3.1 Event frame

Introduce an owned immutable `AutomationFrame` containing:

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

Use an automation snapshot tailored to required data, not a serialization of every UI field. At this scale a measured full immutable state clone is an acceptable first implementation. It must contain configured membership and stable intent/evidence views.

`before` and `after` are from the same logical transaction. A worker must never pair an event's old/new device payload with whatever ArcSwap snapshot happens to be latest when it begins work. The current state-update queueing makes that an ordering hazard worth regression-testing. [A3]

### 3.2 Mutation-to-event sequence

Refactor mutation internals to collect `DeviceMutation`/domain transitions instead of sending routine-evaluation events to the tail of the general queue after mutating state.

Within a state-actor command:

1. Capture the transaction's before view.
2. Normalize the input and apply authoritative state changes, recording actual reports separately from derived desired-state changes.
3. Update cheap native group/scene-derived state; enqueue any asynchronous scripted scene/source materialization rather than running JS.
4. Capture the transaction's after view and create the domain event(s).
5. Evaluate native trigger eligibility and cheap native conditions against the frame; schedule bounded script work for candidates requiring it.
6. Publish reader snapshot changes. Commit plans through actor-owned acceptance logic; their mutations create subsequent causally linked transactions.

No recursive unbounded evaluation inside a mutation. An actor-local finite worklist may complete cheap synchronous derivations; a fixed budget and causation limit terminate loops visibly. Script-derived changes are later transactions with their own frame/revisions. Host causation IDs do not necessarily survive a trip through a physical integration; add per-owner invocation/action-rate bounds and suppress redundant desired-state commands as well. Do not claim a depth limit alone detects all external feedback loops.

A multi-device command is one logical batch for v2 state predicates. A raw report remains its own event. Spatial rollout or deliberately delayed steps are separate time-separated batches. Preserve the legacy per-update projection for v1 while it remains live; changing that granularity requires explicit migration approval.

### 3.3 Consistency and asynchronous completion

Workers receive immutable frames and never mutate trigger memory. The actor applies a script trigger result only for the expected definition/trigger generation, in per-owner input order. Stateful/edge processing must not coalesce reports.

Do not require the entire global snapshot revision to remain unchanged before accepting a plan: unrelated sensor traffic would starve scripts. Instead check owner/config revision, run generation, referenced definition revisions, explicit preconditions, and target intent generations. Event-time source values remain frozen; a new sensor value after the original event does not automatically rewrite its meaning.

Record target intent revisions separately from report/availability revisions. A late physical acknowledgment must not invalidate an otherwise current plan; a newer manual command or scene assignment should. For a plan targeting a group, recheck the relevant group definition revision. Reject an obsolete plan with a visible reason; do not silently rerun it against a newer snapshot.

## 4. Action planning, execution, and conflicts

### 4.1 One command path

`ResolvedActionPlan` includes run/event/owner IDs, definition fingerprint, frozen targets and source-derived values, expected intent revisions, internal operations, command list, and trace information. Run all native and script-returned actions through the same validator/planner.

Retain existing action capabilities, including scene activation/cycles, dimming, overrides, randomization, UI actions where applicable, integration custom actions, and routine invocation. Validate legacy-to-v2 mappings individually; do not forget static actions while adding dynamic values. [A9]

For scene activation, resolve the selected scene ID, fallback, group expansion, source-derived targets, and rollout origin at decision time. `mirror_from_group` already exists; expose that as a scene-value selector instead of implementing it a second time. V1 retains dispatch-time selection. [A10]

Validate every required target before publishing any command. Missing/unresolvable required targets fail the plan by default; partial-target execution must be explicitly requested and show exclusions. A scene intentionally defining only a subset of requested devices uses a documented intersection policy, not an unexplained missing-device failure. Preserve the legacy target-filter policy in its adapter.

Pin referenced scene definition revisions. Materialize dynamic scene scripts outside the actor before accepting an activation that needs their output. The initial target plan uses coherent event-time input; subsequent reactive updates are independent source/scene-refresh plans and must not reselect the activation's scene identity.

Relative commands such as dim/cycle intentionally use current authoritative target state at actor acceptance. Their type declares this. Do not give every scalar an arbitrary 'evaluate later' callback. If a script wants to read the result of a previous effect, it needs a later event/invocation; commands in an uncommitted plan do not secretly mutate `ctx`.

V2 routine invocation emits a causally linked manual/invoke event and evaluates the target condition. A separately authorized force-run operation bypasses conditions explicitly and records that fact, but still validates actions, honors cancellation/limits, and does not implicitly enable a disabled routine. Legacy ForceTriggerRoutine keeps its own bypass semantics until migration. A timer, schedule, startup, or force invocation has no device source unless one is explicitly supplied as provenance; source-group expansion must not invent it.

### 4.2 Execution policy

Implement these policies without unbounded parallelism:

- `single`: reject a new invocation while one is pending/in flight.
- `restart`: invalidate the previous run generation and retain only the latest pending invocation. Already published device commands cannot be undone. Do not use this mode for accumulating button pulses.
- `queued`: preserve accepted event order up to a configured queue bound; default for general event-driven routines. Overflow rejects with a trace; it does not silently drop the oldest pulse.

Deferred **routine-owned timers** are separate from immediate run concurrency. Starting a new invocation does not cancel every timer owned by that routine. Named replacement only cancels the same `(owner_id, timer_key)`. Disable/delete/definition edit invalidates the owner's runs and jobs. Expose cancellation status; do not fabricate a compensating device command unless configured.

Native routines matched by one event are visited in stable ID order. Asynchronous routines do not block every other routine while waiting for JS. Cross-routine conflicting writes use documented first-accepted optimistic intent guards; later plans based on older target intent are rejected. This is not a priority policy, and results may depend on actual completion order. Show conflicting owners in traces. Do not promise deterministic cross-worker priority without implementing an arbiter. Consolidate conflicting behaviors into one routine/mode where appropriate; a priority arbiter is deferred.

### 4.3 Internal durability versus external effects

Do not claim a DB transaction can atomically commit physical lamp state.

When a plan includes durable helper/state/job operations, serialize those operations through a bounded persistence coordinator. The state actor stages an immutable transaction request and reserves the affected owner/helper revisions; conflicting internal writes queue or reject. The coordinator executes only the supplied SeaORM transaction outside the actor and sends completion back. It does not independently mutate AppState.

After DB success the actor installs the durable values/jobs, rechecks run/target guards, and dispatches allowed external commands. Report success only after the relevant durability point. If device intents changed while persistence was in flight, suppress stale device effects and report the partial internal-commit/external-suppression outcome; do not silently undo committed internal state or pretend the device command succeeded. Scripts must never assume that planning or accepting a command proves physical delivery.

All durable internal operations in one plan commit together or none do. External effects occur afterwards and remain best effort. Persist disable/edit invalidation in owner order; an unacknowledged cancellation may be lost on crash, but an acknowledged cancellation must survive recovery. Runtime cancellation prevents further effects immediately while its durable write is pending.

## 5. Server-owned scheduling and timers

### 5.1 Scheduler boundaries

The state actor owns authoritative timer/job state and validates every expiry. A scheduler driver owns only a rebuildable wakeup index/min-heap and clock waits. It emits `Wakeup(job_id, generation, due_at)`; it never dispatches actions directly. Lost/duplicate wakeups cannot bypass authoritative checks.

Use injected clocks with separate UTC wall time, timezone conversion, and monotonic elapsed time. Tests can advance wall and monotonic time independently. Never put `Utc::now`, `Local::now`, or real `sleep` inside pure evaluator functions.

Relative timers use monotonic deadlines during a process lifetime. Store UTC due time as well when persistence is enabled; monotonic instants are not persisted. After restart, reconstruction uses UTC and the job's documented recovery policy. Calendar schedules use wall time and an IANA timezone. Recheck calendar waits after wall-clock changes instead of assuming one initial UTC-to-monotonic conversion remains correct forever.

### 5.2 Timer model

```
Job {
  id, owner_id, owner_definition_revision,
  key, generation,
  created_at_utc, due_at_utc,
  monotonic_deadline? [runtime only],
  handler_or_native_step,
  payload [bounded JSON],
  persistence: session | durable,
  misfire_policy,
  captured_target_intents?,
  status: pending | claimed | handled | cancelled | interrupted
}
```

Keep timer generations distinct from run generations. Serialize opaque IDs/revisions safely for JavaScript; do not expose unbounded Rust u64 counters as imprecise JS numbers.

`replace(key, after_ms, payload)` replaces only the same owner/key, increments its generation, and schedules a new deadline. `cancel(key)` is idempotent and invalidates old wakeups. Allow zero delay as a new queued event, never inline recursion; bound durations and per-owner job count. Prefer helpers with units in their names.

When a timer expires, capture a **new current frame** and invoke the named handler/native continuation. The original event and bounded payload can be supplied as provenance, but present-time conditions read the expiry frame. Do not execute a captured list of old on/off commands without current guards.

An explicit `capture_target_intents` scheduling option records post-acceptance intent tokens for selected targets, including intent changes made by earlier commands in that accepted plan. At expiry, a guarded action may act only on unchanged tokens. This prevents a delayed motion-off command from overriding a more recent manual scene. Relative to ordinary event-time action resolution, this is a deliberately specified commit-time bookkeeping operation, not an arbitrary dynamic expression.

Support a native 'delay then continue' as a persisted step ID and locals/payload. No serialized closures, VM heaps, JS stacks, or automatic async-function continuation capture.

### 5.3 Recovery and delivery semantics

Defaults for **new** definitions:

- Motion/retriggerable short timers: `session`; restart cancels them. A template may provide an explicit startup reconciliation step.
- Durable delayed jobs: `skip` when overdue, unless the author selects `run_once` with a bounded maximum lateness.
- Recurring calendar schedules: skip missed occurrences by default; optional coalesced single catch-up. Never replay an unbounded backlog.
- Computed sources: recompute once at startup/current time; do not replay every missed tick.

For durable expiry, transactionally claim a matching pending generation before invoking it. If the process dies after claim but before completion, mark it interrupted on recovery; do not blindly replay non-idempotent operations. This provides an at-most-once **attempt policy**, not exactly-once physical effects or guaranteed delivery. Explicit idempotent reconciliation may recover desired-state operations. Do not auto-retry toggle, cycle, dim, or arbitrary integration actions.

Persist recurring occurrence identities/cursors to prevent a handled occurrence being repeated after clock movement/restart. An occurrence includes schedule definition revision, scheduled UTC instant, and local calendar identity when DST policy requires it. A cursor is not merely 'last time the loop ran'.

### 5.4 Cron/calendar semantics

Expose common daily/weekly schedules as native UI fields and raw cron as advanced input. Fix the supported grammar in tests against the pinned parser; do not assume cron field count or day-of-month/day-of-week semantics. Preserve the deployed v1 parser behavior in compatibility conversion. [A5, A18]

A v2 schedule stores an explicit IANA timezone. Do not infer the server's former timezone from the user's browser timezone during migration. Recover the effective installation timezone from deployment configuration/operations and require confirmation if it is not known.

New-definition defaults: nonexistent spring-forward local times are skipped; repeated fall-back local times run once at the earlier occurrence. Store this policy and test it rather than trusting whichever occurrence the library happens to return. An opt-in 'both occurrences' mode may be added if needed. Use `Europe/Helsinki` as one test zone, not an automatic migration assumption.

Support next-occurrence preview, enable/disable, per-trigger status, and a maximum catch-up count. Timer wakeup and script delays must not alter the scheduled-occurrence identity.

## 6. JavaScript environment

### 6.1 Contracts and capabilities

Use the same `api_version` and normalized state access across four invocation contracts:

1. Condition/filter: strict boolean or an explicit unknown result; no commands/state writes.
2. Routine handler: returns `{ actions, next_state? }` with bounded JSON state.
3. Scene materializer: returns typed scene configuration/overrides, not side effects.
4. Computed source: returns one value matching its declared output schema, not commands.

All script work is outside the state actor, including scene invalidation, previews, validation, and startup materialization. Native helpers may execute in Rust, but user-defined computation is isolated.

Expose immutable `ctx.event`, `ctx.before`, `ctx.after`, fixed `ctx.now`, timezone-aware time fields/helpers, typed device/group/value/source accessors, current per-owner memory, revision/provenance, and namespaced logging. `api` contains pure truth/predicate, scene/action, timer, color, interpolation, and state-result builders. Builders return data; they do not communicate with integrations.

A condition script returning a nonempty string, Promise, array, or object other than the explicitly supported unknown shape is an error, not a truthy success. Native/SDK three-valued helpers must agree. Plain JavaScript `!` is not a substitute for the SDK's unknown-preserving negation; document this and provide typed helpers. [A8]

No direct filesystem, network, process, DB, environment-secret, or raw MQTT access. Integration actions are allowlisted typed commands and go through normal dispatch. Schedules/timers are plan operations; there is no live `setTimeout`/`setInterval`. A worker has no durable global state. Do not advertise npm/Node compatibility merely because the language is JavaScript.

Default ambient `Date.now`/zero-argument Date and randomness must not break replay. Prefer explicitly deterministic `ctx.now` and seeded `api.random`; either disable ambient nondeterminism or implement it with the invocation's injected time/seed. Test the actual Boa globals instead of assuming browser behavior. Reject unsupported async return values rather than silently abandoning pending jobs.

### 6.2 Subscriptions versus read tracking

Subscriptions answer **when to invoke**; a read set answers **what the invocation observed**. Do not conflate them.

Native triggers derive exact subscriptions from typed references. Script transition predicates and computed sources declare devices/groups/values, event kinds, and any time interval/calendar dependency. Conservative wildcard subscription is allowed with an explicit UI warning. Runtime read tracking validates declarations and improves diagnostics, but observed reads from the last branch are not proof of all future dependencies.

Undeclared reads in a strict v2 source/transition script fail visibly; a broad compatibility declaration may subscribe to all relevant state. Missing-entity lookups still register dependencies, so later discovery can wake the script. Group access depends on membership revision plus member data. Conditional scripts behind an explicit motion trigger do not need to run on every read dependency change.

Regex/string searches in JS source may suggest declarations only. They are not sound dependency analysis, and existing literal extraction must not silently become the v2 source of truth. [A11]

### 6.3 Worker supervision

Start with a small bounded process pool, e.g. two workers, with one invocation per worker. Treat these as initial operational settings, not measured optimal values. Default planning budget can start at 200 ms per invocation with bounded input/output/queued work; expose profiles only after measuring real use. Keep legacy input/result limits until explicit compatibility review. [A8]

A worker process can be an additional server binary using length-prefixed JSON IPC. Parent validates message size before allocating large buffers, associates request/run/generation IDs, kills and reaps the worker on timeout, crash, or protocol error, then replaces it. Stdout is protocol only; diagnostic output is capped separately. Clear inherited secrets/environment, do not inherit DB handles, and limit child resource use on the supported deployment platform. An OS child alone is not a complete hostile-code sandbox; distinguish fault containment from security isolation and test memory/CPU enforcement explicitly.

Do not call `spawn_blocking(...).await` from the state actor and call that isolation. Tokio documents that a started blocking task cannot simply be aborted; a timeout around work is not a kill mechanism. [A19]

Fresh realms/contexts prevent global/prototype leakage between invocations. Construct Boa-owned objects inside their worker. Do not assume Boa compiled objects are Send/Sync or can be reused across contexts. Begin by caching source validation/fingerprints; add compiled-program reuse only where supported by the pinned engine and proven by isolation tests. Never cache condition results merely because the source text is unchanged.

Use per-owner bounded input queues and worker fairness. Scene/source refreshes may coalesce to the latest revision when their contract is current-value recomputation; reports, button presses, and scripted transition histories may not.

### 6.4 Legacy scripting during coexistence

P07 must also remove v1 rule-script execution from the actor; keeping the v1 interpretation does not permit keeping a blocking v1 execution path. Keep a worker invocation format for the old globals, raw expression completion, and boolean truthiness. For each legacy frame capture native leaf results in the original traversal order, apply/record the legacy trigger-memory updates under actor ownership, and identify script leaves by stable path. Workers return only their leaf results. Combine those results with the captured native results, never with a new live-state evaluation. Preserve per-routine event order for the combined decisions and reject results after owner disable/edit. Characterization tests must verify nested Any, shared-device edge interactions, and scripts interspersed with native leaves. Named bug fixes remain separately tracked.

V1 scene scripts also keep a separately identified expression/output format while being materialized off-actor by P08. Do not silently switch existing scripts to the strict v2 function-body ABI or output contract. This coexistence adapter is temporary execution plumbing, not a second user-facing script runtime.

### 6.5 State and reusable code

Per-owner memory is explicit bounded JSON with a revision, loaded in `ctx.state` and changed only through the returned `next_state`. Serialize invocations that read/write that memory. If persistence fails, no successful durable state update is reported. A failed/obsolete script result cannot advance memory or publish a source value. Disable/edit resets or migrates state only via an explicit policy.

Ship built-in pure helper libraries and versioned preset scripts as application assets; parameters and user modifications remain DB-backed. That does not create a second runtime configuration store. Shared user modules can be added after the core ABI, with pinned module revisions included in the definition fingerprint and no implicit network import. Do not build a package manager as part of this project.

## 7. Native UX primitives and explicit lighting intent

Provide a typed helper-value model first: boolean, enum, bounded number, and string. The staircase mode is an enum helper, not derived scene unanimity. Its default, current durable value, provenance, and edit history are visible. Decide explicitly which wall controls and schedules change the mode. Manual brightness adjustment need not change it.

Native scene selection supports literal scene, enum-value mapping, source device's assigned scene, or source group's common assigned scene with explicit fallback/unknown behavior. Keep source selection in the action planner. Do not redefine group scene as authoritative intent.

High-leverage templates:

- Motion pulse -> choose scene from mode -> replace named off timer.
- Occupancy level becomes false for a duration -> guarded off. This is not the same as time since last motion report.
- Button report -> scene cycle or dim, queued so pulses are not lost.
- Daily/weekly schedule -> native or scripted handler.
- Condition becomes true for a duration -> action, cancelled by false/unknown.
- Circadian/adaptive profile -> scene-linked source, respecting overrides.

A new motion template defaults to not overriding a newer manual intent. Define when automation resumes: the next motion event, override release, or a configured time; do not guess. Source-profile refresh must not invent a new user intent or reset override ownership.

A typical one-routine design has two explicit triggers: matching motion reports and its own named `off` timer expiry. The motion branch chooses the scene and replaces the timer. The expiry branch evaluates current state and timer/intent guards before turning off. Both branches use the same native `choose` machinery or the same JS handler; no hidden second routine is necessary.

### Illustrative script-facing API

The following illustrates the intended ABI; exact generated names are to be fixed by P07 and backed by executable fixtures. It is not runnable against the baseline repository.

```js
// Source is a function body invoked with immutable ctx and pure api.
if (ctx.event.kind === "timer_fired" && ctx.event.key === "off") {
  return {
    actions: [api.actions.setPower({
      targets: { group: "staircase" },
      power: false,
      timerIntentGuard: true,
    })],
  };
}

const mode = ctx.values.requireEnum("staircase_mode");
const scene = {
  normal: "staircase_normal",
  dark: "staircase_dark",
  night: "staircase_night",
  bright: "staircase_bright",
}[mode];
if (!scene) throw new Error("Unsupported staircase mode");

return {
  actions: [
    api.actions.activateScene({
      scene,
      targets: { group: "staircase" },
    }),
    api.timers.replace({
      key: "off",
      afterMs: 120000,
      payload: {},
      persistence: "session",
      captureTargetIntents: { group: "staircase" },
    }),
  ],
};
```

The trigger declaration restricts non-timer invocations to active motion reports. Helpers do not perform I/O. A group's targets are frozen for the scheduled ownership guard; membership changes must not let the later action accidentally control a newly added unguarded device. The expiry branch is intentionally “time since the last motion pulse,” not “the sensor has reported unoccupied continuously.”

## 8. Computed sources and circadian migration

### 8.1 Preserve the useful source abstraction

The baseline circadian integration calculates a color/optional brightness profile, exposes it as a color sensor, and updates periodically. Scene device links can consume color-sensor state, and invalidation refreshes linked scenes. [A6, A11]

Add a generic computed-source owner in the automation subsystem. Initially publish its output through a read-only synthetic device adapter so the existing `DeviceLink` scene machinery can be reused. New canonical keys may be `computed/<source_id>`; legacy IDs are compatibility aliases, not separate independently updated devices. Store origin/owner metadata explicitly; do not add one fake integration row per computed source.

Audit device listing, capability checks, persistence, disabling, cleanup, source validation, integration reload, and reference resolution. A computed source must not be deleted by an unrelated integration reload, nor accept normal actuator commands. A future dedicated scene `SourceLink` can replace the adapter, but it is not needed to retire circadian's integration wrapper.

V2 source output is a validated `LightProfile { color?, brightness?, transition_ms? }` with provenance and freshness. Its legacy color-sensor adapter supplies compatibility power semantics. Color units are explicit; use a named Kelvin helper for the repo's CT representation and test rounding/clamping. Do not silently change interpolation to mireds or a different color space during migration. [A6, A20]

### 8.2 Circadian implementation

Extract the old computation into pure functions accepting an injected local time and parameters. Freeze its output in golden tests, including color conversion/mixing, its distinct fade easing behavior, optional brightness, and boundary rounding. Do not 'clean up' the curve while claiming an equivalent migration.

Ship a versioned built-in JS preset using pure time/color/interpolation helpers. Users get a parameter form and can fork the preset into a custom script; the shipped script version is pinned in saved definitions. The host provides timezone-aware local time, not a guessed `Date` timezone.

For v1-compatible sources, preserve the effective installation timezone, normal cadence, transition values, and output mapping. Identify invalid/ambiguous configurations such as zero/negative durations, crossing-midnight fades, or overlapping windows; do not silently reinterpret them. New presets validate strictly and define cyclic-day behavior explicitly. A deliberate new curve or better night-crossing behavior gets a new preset version and migration diff.

Start with startup evaluation plus an explicit 60-second interval and parameter/dependency changes. Publish a new value only when the meaningful output changes; freshness may update without pretending a fresh physical report arrived. If v1 scripts rely on periodic identical sensor events, retain that periodic-event projection until they are migrated.

If evaluation fails, retain last-good output as **stale/error**, not healthy. New scene activation that requires a fresh source fails/explains or uses an explicit fallback. Existing lights do not receive a surprise fallback command just because a source worker failed.

Dependent scene refresh plans target only devices still governed by the relevant scene/source and obey current manual overrides, ownership, power policy, and capability limits. A stale source result cannot restore an old scene. Add explicit tests for a light manually switched off, mixed scene assignments, temporary overrides, and switching away while a computation is in flight.

Solar/astronomical curves are optional later presets, not required for parity with the current time-based integration.

## 9. Explanations, simulation, APIs, and UI

### 9.1 Decision trace

Record one bounded `DecisionTrace` per considered invocation:

```
run/event/owner IDs; definition fingerprint; snapshot/time references
matched trigger IDs and cause
condition tree with true/false/unknown/error and observed/requested distinction
script diagnostics, duration, declared/actual reads
source selectors, fallback reasons, resolved targets/actions
execution policy result, generation checks, intent conflicts
job operations and next due times
persistence/acceptance/dispatch/ack status
```

Statuses distinguish `not_eligible`, `condition_false`, `condition_unknown`, `evaluation_error`, `suppressed_busy`, `queue_full`, `cancelled`, `stale_plan`, `accepted`, `dispatched`, `interrupted`, and delivery result when actually known. Never show 'fired' for a status-only preview. Make a history result a record of the past frame, not recomputed against current state. [A4]

Bound logs, trace retention, raw payload capture, script console output, and queue sizes. Default to an in-memory ring for detailed traces with optional persisted summaries. Do not retain sensitive raw telemetry indefinitely just for debugging.

### 9.2 Pure evaluation and simulation

`evaluate(frame, compiled_definition, runtime_memory) -> decision + proposed_memory_delta` has no DB calls, event sends, history writes, clock reads, or real effects. The actor applies allowed deltas in live mode; preview does not consume edge memory, claim jobs, advance cron cursors, or alter live helper state.

Add a `CommandSink`/effect-dispatch boundary and a sandbox composition that cannot construct live MQTT/integration/HTTP publishers or production DB writers. Use the same scheduler with a fake clock and isolated job store. Current MQTT-to-dummy conversion is not sufficient coverage of all future effects. [A12]

Replay artifacts contain an initial relevant snapshot, configuration fingerprints, ordered input events, injected time changes/random seeds, and expected decision/plan outputs. They are fixtures, not a production event-sourcing system. Record dropped input/queue overflow explicitly; a truncated replay must not masquerade as complete evidence.

### 9.3 Proposed endpoints

Use existing API route composition/response conventions and actor/snapshot entry points. Keep the existing routine-config CRUD surface, extended with version-aware records. Add these proposed routes (they do not exist in the baseline):

| Method/path | Contract |
|---|---|
| `POST /api/v1/automation/validate` | `{kind, definition}` -> normalized definition/fingerprint plus structured diagnostics; no save/effects. |
| `POST /api/v1/automation/preview` | Draft definition, explicit event, and current-or-supplied sandbox snapshot -> decision trace/plan; no live writes. |
| `GET /api/v1/automation/traces` | Bounded owner/event filters and cursor pagination; traces identify their original definition revision. |
| `GET /api/v1/automation/jobs` | Filter by owner; expose status, generation, due time, persistence, and recovery policy. |
| `POST /api/v1/automation/jobs/{id}/cancel` | Expected generation -> idempotent cancellation result and durability status. |
| `POST /api/v1/automation/schedules/preview` | Schedule definition, starting instant, bounded count -> occurrence instants/local-time labels and diagnostics. |
| `GET/POST /api/v1/automation/value-definitions` and `GET/PUT/DELETE .../{id}` | DB-backed helper definitions; optimistic revision on updates. |
| `PUT /api/v1/automation/values/{id}` | `{expected_revision, value}` -> committed value/revision and persistence status. |
| `GET/POST /api/v1/automation/sources` and `GET/PUT/DELETE .../{id}` | DB-backed computed-source definitions; current source value/quality is included in read snapshots. |
| `POST /api/v1/automation/migrations/preview` | Configuration/owner selection -> immutable proposed manifest with source fingerprints. |
| `POST /api/v1/automation/migrations/apply` | Explicitly approved manifest ID/hash and current revisions -> cutover result; no automatic approval. |
| `POST /api/v1/automation/migrations/rollback` | Applied manifest ID and expected current revisions -> guarded rollback or conflict report. |

Fix these names in the P03 API contract; change them only as an explicit API-contract revision if the repository already has a conflicting route. Apply request size limits, the same admin authorization boundary as config writes, optimistic revisions, and bounded pagination. Read endpoints use snapshots; writes use the state actor/persistence coordinator. Never let a preview endpoint dispatch a `Custom` integration action. Validation/preview failures leave live state untouched.

### 9.4 UI

Keep the current frontend stack and reusable primitives. Add a v2 When / If / Then editor backed by generated Rust types; keep a clearly labeled v1 editor until migration ends. Do not rebuild the frontend as part of this effort.

Conditions display group quantifiers and unknown/error reasons. Trigger cards distinguish report, transition, sustained predicate, schedule, startup, and timer. Expose concurrency, retry/recovery, and advanced cron policies under advanced controls with visible summaries.

Use the existing Monaco dependency for the script editor, adding generated SDK declarations, actual API-version selection, source-located diagnostics, fixtures, and preview. Do not duplicate Rust semantics in TypeScript summary logic. Summaries and results come from the normalized definition/trace contract. Preserve scripts the visual builder cannot edit instead of round-tripping them through a lossy pseudo-AST. [A16, A17]

Provide helper-mode controls, timer countdown/status, schedule enablement, and computed-source profile preview. A schedule enabled flag is not a light's power field; compatibility controls may project it that way only while old dashboards remain. **Dropped by user decision:** the v1 cron "power as enable" compatibility control is a non-goal (100% v1 parity is not required); v2 schedule routines are enabled/disabled through the routine `enabled` flag.

## 10. Migration strategy

### 10.1 Inventory and compatibility baseline

Export all runtime configuration and inspect all approximately 35 routine rows, enabled or disabled, plus integration configs, groups, scenes, widgets, device metadata, and source mappings. The plan cannot name actual routine IDs because the live DB was not provided.

Capture baseline decisions as test fixtures, including defaults, same-value sensor pulses, all-level routines, nested Any, script truthiness, old/new state interaction, group unanimity, missing references, force triggers, source-group expansion, and dispatch-time mirroring. Preserve an untouched v1 evaluator fixture/oracle for differential testing.

Document named fixes separately: status evaluation writing history, silent decode fallbacks, edge-key collisions, and event/snapshot coherence. Their historical behavior need not be kept forever, but format migration must not hide them. Keep original raw rows and a manifest of which corrections a migrated routine adopts. [A3, A4]

### 10.2 Routine conversion

Classify each row as:

- **Mechanical candidate:** simple event leaf plus state guards, static actions, known references.
- **Needs semantic review:** any edge rules, multiple event leaves, mixed event/state Any, script/level-only definitions, missing state, dynamic source actions, force invocation.
- **Intentional redesign:** mode-based staircase, timer state machine, or consolidated four-outcome routine.

Even mechanical candidates are proposed, not immediately enabled. A candidate with a simple pulse and level guards can often map directly, but the replay must also cover different event sources and dispatch-time source changes.

Keep v1 execution available during migration. A legacy every-internal-update trigger is an explicit compatibility escape, not the default public v2 choice. Do not wrap all scripts in a function and claim compatibility: raw expression completion, top-level return syntax, and truthiness differ.

For each routine, compare old and new decisions/actions on identical frames and event traces; accept deliberate differences in a per-routine manifest. Enable cohorts, retain the original row/archive, and make rollback an atomic configuration operation. Never run old and new effects simultaneously in shadow mode.

### 10.3 Timer integration migration

The baseline timer owns a boolean synthetic device and raw start/duration metadata, and restarting it cancels the preceding task. [A5]

Inventory both its actions and all reads of its synthetic device/raw fields, including JS and dashboards. Introduce a compatibility adapter mapping old integration actions and timer device reads to one core timer. Preserve the old key, active/inactive events, metadata, and restart behavior through the adapter; do not run a second clock behind it.

For cutover, quiesce the old timer actor and establish a generation barrier before core ownership begins. An already-queued old expiry must be identifiable and rejected; if the legacy event envelope lacks identity, add a lifecycle epoch at ingress or drain it under an explicit cutover barrier. Do not assume stopping a task retracts a queued event.

Default migration does not guess the remaining lifetime of an in-flight timer. Either transfer using verified start/duration evidence under the barrier, or cancel explicitly and report it. Record restart-persistence changes as intentional; the old timer's in-process task behavior is not durable recovery.

Rewrite native routines to timer triggers/jobs and update dashboards. Dynamic script references that cannot be proven rewritten keep their alias or require manual review. Remove the integration wrapper only once the manifest shows no unresolved consumers and no live legacy owner.

### 10.4 Cron integration migration

The baseline cron creates a controllable schedule device whose power gates a directly dispatched action and calculates using local server time. [A5]

Map each schedule to a schedule trigger plus its action program. Preserve parser semantics, effective timezone, action payload, current enablement, and init-enabled behavior where relevant. Preserve old enable controls through a compatibility binding to an explicit helper/schedule flag. Do not infer current enabled state solely from its initial config flag.

Prevent duplicate firing with one owner/cutover epoch and occurrence IDs. Preview several next occurrences before and after conversion, including DST and day/month boundaries. A disabled cron integration must not emerge as enabled v2 schedules. Stop/quiesce old scheduling before enabling its mapped trigger; rollback performs the inverse without two active owners.

### 10.5 Circadian integration migration

Map each integration to one computed source, not a routine per target light. Keep a one-to-one alias from the old color-device key to that source; preserve reactive scene links until references are deliberately rewritten. Golden-test values across a representative day and boundary cases before the source controls production scenes.

Inventory references in scene device links, group assignments, scene scripts, routine scripts, selectors, and widgets. Group-member aliases must not double-count the same source/device. Preserve output units, brightness absence, transitions, and interpolation. Optional new curves/solar presets are a separate change.

Enable the source only after the old publisher has stopped and old lifecycle-epoch events are fenced out. Rollback restores the old integration config and aliases with the v2 publisher disabled.

### 10.6 Retirement criteria

Delete timer/cron/circadian integration loading branches only when conversion tests, dependency inventory, aliases, UI control migrations, and rollback have passed. Remove legacy aliases separately once opaque script references have been reviewed. Keep import-time conversion for old backups or reject unsupported old formats with a migration report; never silently ignore their integrations.

Changing v2 defaults for offline state, batching, timestamps, intent guards, and script errors is deliberate and documented. 'The new architecture is cleaner' is not sufficient migration evidence.

## 11. Performance and operational bounds

At approximately 35 routines / 50 devices, prioritize correctness and script isolation rather than an advanced incremental inference engine. No performance bottleneck was established by this review.

Instrument actor command and queue latency, report-to-decision/dispatch latency, native evaluation time, script queue/run time, stale-result rate, scheduler lateness, trace overhead, source refresh rate, and allocations/serialization size. Reuse existing actor metrics/watchdog infrastructure where useful. [A13]

Bound all new automation queues and trace stores explicitly. The baseline StateHandle channel is unbounded; these additions alone do not prove a whole-process queue bound. Measure actor ingress separately and surface overload. A core ingress/backpressure redesign should be a separate justified package if its limit is reached, not an incidental rewrite during timer migration.

Build a simple index keyed by event kind and source/owner. The compiler supplies dependencies; exact evaluation remains authoritative. Keep wildcard/v1 subscriptions. Group membership, reference edits, deleted devices, and availability changes must rebuild/invalidate affected entries. Differential-test indexed evaluation against a scan-all v2 evaluator.

Use representative replay at observed normal and burst rates. Acceptance is unchanged decisions, bounded memory/queues, and no actor hostage to a script. Add machine-specific latency targets after measuring baseline. Do not assert a universal millisecond guarantee from routine/device counts alone.

Optimize in order: avoid irrelevant invocations; share immutable frame preparation; reuse validated references/regexes and supported script compilation; coalesce current-value source refreshes; only then consider result caching. Do not parallelize the state actor or introduce a Rete engine.

## 12. Work packages, dependencies, and completion gates

Effort labels are relative scope, not time estimates. Do not merge packages into one sprawling agent task.

### P00 — Baseline, ADRs, fixture harness (small; highest leverage)

**Dependencies:** none.
**Touch:** new docs/ADRs and test fixtures; existing routines/event/scripting/integration tests only to add characterization.
**Steps:** record baseline revision; inspect authoritative architecture; export a sanitized test configuration; write terminology/defaults from Sections 1–6 into ADRs; build a replay fixture format with no live sinks; record current behavior without fixing it.
**Tests/gate:** B01–B06 and E01 characterization; capture current failures as named expectations, not hidden passing tests. Existing checks remain unchanged. No runtime semantics changed.

### P01 — Validation and truthful history (small–medium; very high impact)

**Dependencies:** P00.
**Touch:** `core/routines.rs`, `api/config/routines.rs`, shared validator module, routine history/status types, UI error rendering.
**Steps:** remove malformed-row defaulting; retain bad raw rows and their stored enabled flags unchanged, but quarantine them as runtime-invalid/nonrunnable with a visible error; validate rules and actions; distinguish validation, preview, match, acceptance, and dispatch; stop status refresh from writing trigger history; correct v1 level documentation to describe implemented behavior; keep a compatibility fixture for original behavior.
**Tests/gate:** V01–V05, X01. Saving invalid config cannot report a healthy enabled routine; status reads do not mutate edges/history. Do not change level matching or v1 group rules here.

### P02 — Coherent frames and event origin (medium–large; very high impact)

**Dependencies:** P00.
**Touch:** `types/event.rs`, `core/devices.rs`, `core/event.rs`, `core/state/actor.rs`, `core/snapshot.rs`, new automation-event types.
**Steps:** add IDs/origin/lifecycle epochs; mutation collector; before/after frames; explicit v2 batching; source/intent revisions; source reports distinct from derived commands. Keep v1 projected events for compatibility. Reproduce and fix the queue-order issue as a named correction, or revise the hypothesis if the regression demonstrates it does not occur.
**Tests/gate:** E01–E08. Two queued contradictory reports each retain their own frame. No duplicate physical publish introduced. Startup, overrides, rollout, and scene invalidation regression suites pass.

### P03 — V2 schema and compiler, not yet enabled (medium)

**Dependencies:** P00, P01.
**Touch:** new tagged types/compiler; active SeaORM migrations/schema/config queries; export/import; generated bindings.
**Steps:** additive routine columns; strict version dispatch; type/reference compiler; invalid draft support; native trigger/condition/action schemas and stable node IDs; compile metadata reused by reference inventory/simulation.
**Tests/gate:** V01–V08, M01–M03. Old exports load as v1 unchanged; SQLite and Postgres store both versions; unknown versions fail visibly. No v1 row is automatically converted.

### P04 — Native evaluator and explicit group quality (medium)

**Dependencies:** P02, P03.
**Touch:** new evaluator/group modules; group configured-membership API; runtime status snapshots.
**Steps:** three-valued conditions and separate errors; OR trigger eligibility; per-trigger transition memory; configured group membership and explicit quantifiers; report versus transition behavior; observed/requested fields; startup/reload seeding.
**Tests/gate:** C01–C10, T01–T06, G01–G07. Scan-all v2 evaluator is correct and pure before adding an index. V1 group behavior remains behind its interpreter.

### P05 — Action plans, explicit helpers, and native staircase slice (medium–large; very high UX impact)

**Dependencies:** P04.
**Touch:** planner/executor, helper DB/state APIs, existing scene/device command paths, traces.
**Steps:** common action normalization; frozen source/target resolution; scene-selector mapping/mirror/fallback; intent revisions; bounded concurrency; typed enum helper; no-script mode -> scene vertical slice. Apply native plan acceptance through the actor.
**Tests/gate:** A01–A09, X02–X04. Mixed bedroom scene IDs do not prevent the explicitly mode-based staircase fixture from running. Manual intent guards work. V1 mirrors still resolve at legacy timing.

### P06 — JavaScript worker proof and supervisor (large; architectural safety gate)

**Dependencies:** P02, P03.
**Touch:** worker binary, IPC protocol/supervisor, pinned Boa adapter, deployment packaging.
**Steps:** prove function-body execution, strict output parsing, bounded protocol, kill/reap/restart, fresh-context isolation, no secrets/live state handles, capped logs/resources. Inspect pinned Boa APIs; do not assume newer capabilities. No integration migration in this package.
**Tests/gate:** S01–S09. Infinite-loop, long native operation, allocation/output abuse, and worker crash cannot stall the state actor; manual control/read endpoints remain usable. Record exact memory containment guaranteed by supported deployment, not just timeout claims.

### P07 — Script ABI, state, subscriptions, and routine integration (medium–large)

**Dependencies:** P04, P05, P06.
**Touch:** generated SDK, script compiler/validation endpoint, worker coordinator, owner memory and capability validation.
**Steps:** four output contracts; immutable context; deterministic time/randomness policy; declaration validation; per-owner queues; stale result and memory CAS; pure action/timer builders; executable script fixtures. Implement the off-actor v1 rule-script leaf adapter from Section 6.4, preserving its ABI separately; do not leave a direct actor script path while v1 rows exist.
**Tests/gate:** S10–S17, X05. Native and script fixtures produce equivalent typed plans/traces. Promise/truthy/nonfinite results rejected. An edit/disable invalidates pending results. No hidden VM-global state survives.

### P08 — Move every scene-script path off actor (large; do not omit)

**Dependencies:** P05–P07.
**Touch:** `core/scenes.rs`, event/scene command handling, materialization caches and dependency metadata.
**Steps:** locate all script call sites including refresh, reload, preview, and startup; stage immutable scene requests; worker materialization; commit only current revisions/intent; cache last-good results with explicit stale/error quality; source/scene cycles and obsolete refresh prevention.
**Tests/gate:** SC01–SC06. No direct Boa execution remains reachable from state-actor commands. A slow scene script cannot freeze unrelated control. A result from an old scene selection cannot change the newly selected scene.

### P09 — Clock abstraction, named timers, schedules (medium–large)

**Dependencies:** P04, P05; P07 for JS builders.
**Touch:** scheduler modules, trigger kinds, timer snapshots/control APIs.
**Steps:** injected clocks, derived wakeup heap, actor-authoritative generations, report-safe replacement/cancel, interval/calendar schedule, fixed cron grammar, explicit timezone/DST/misfire defaults. Session timers first; durable operation is disabled until P10.
**Tests/gate:** J01–J09, K01–K06. All timing tests use fake time; real sleeps only in worker supervision/process integration tests where needed. No old integration is removed yet.

### P10 — Restart behavior for timers (thin; user-scoped)

**Dependencies:** P09.
**Touch:** named-timer persistence, startup load/drop, startup log.
**Steps:** persist **named timer jobs only**, best-effort, so a restart does
not lose "turn the hallway light off in 10 minutes". Write through to the
database on schedule/replace/cancel; at startup load jobs whose due time is
still in the future and drop past-due jobs with a log line. Schedule
occurrences and predicate deadlines are not persisted: schedules re-arm from
`now` and predicates re-evaluate from state, both with visible logs. Cancel
and replace must survive a restart. No transactional coupling of jobs to
state writes, no claim/generation CAS layer, no interrupted-state protocol,
no export/checkpoint integration, no exactly-once language: if the database
is unavailable, persist nothing, log a warning, and keep session behavior.
Config restore/import already drops stale jobs by owner revision; keep that.

**Dropped for a single-node home system:** J12–J15, J17, M04–M06.
**Tests/gate:** future named timers survive restart; past-due timers are
logged and dropped; acknowledged cancel/replace survives restart; a config
import never resumes old jobs; DB-unavailable degrades to session behavior
with a warning.

### P11 — Computed sources and circadian parity (medium–large)

**Dependencies:** P07–P10.
**Touch:** source definitions/registry, source synthetic-device adapter, scene dependencies, extracted circadian pure functions/preset assets.
**Steps:** typed LightProfile source; generic owner metadata/aliases; pure legacy curve oracle; built-in versioned script; validated timezone/units; periodic refresh; stale/last-good policy; current scene/override preservation.
**Tests/gate:** D01–D10, SC04–SC06. Golden values agree with legacy within explicitly fixed rounding tolerance. No new commands go to lights not governed by the source. Integration reload cannot delete computed owners.

### P12 — Native patterns and full v2 editor (medium–large; UX is the primary deliverable)

**User-visible bar:** the settings UI must stop being a TOML form dump.
Design from situations ("I see this device is wrong; I want to change how it
behaves in this scene"), keep context when navigating (device → scene →
routine), and prefer inline edit over page-hopping. Gate U01–U06 remain as a
floor, not the ceiling; the concrete first deliverable is the floorplan
device dialog offering a direct/linked edit of that device's state in a scene.

**Dependencies:** P05, P07, P09–P11.
**Touch:** new When/If/Then components, `RuleBuilder.tsx`, `routine-summary.tsx`, action builder, config pages, Monaco SDK declarations, generated bindings.
**Steps:** motion/occupancy/schedule/profile presets; choose/delay/restart controls; mode widget; timer/source status; next-occurrence preview; unknown explanations; legacy badges; script authoring/fixtures. Consume server traces instead of reimplementing evaluation in UI.
**Tests/gate:** U01–U06. Both native and script staircase definitions are authorable and previewable; unsupported scripts survive editor round trips; existing v1 UI remains functional.

### P13 — True dry-run, differential migration tooling — **CUT**

**Status:** cut by user decision (see the §16 "plan change" entry). The effect
sink, differential comparison, manifests, and M07–M09 are not built. Safe
validation is provided by the existing `--simulate` mode plus the offline
converter's dry-run report; trace/status work already delivered by P05/P07
stays. Dropped gates: X06/X07, M07–M09.

### P14 — Cut over timers and cron — **CUT**

**Status:** cut by user decision (see §16). The offline converter runs with the
server stopped, so there are no dual emitters, epochs, or cohorts; dropped
gates M10–M13. Cleanup of the retired timer/cron wrappers becomes a manual
follow-up in P17 after the conversion report is clean.

### P15 — Cut over circadian and routine cohorts — **CUT**

**Status:** cut by user decision (see §16). Legacy rows are converted by the
one-time script (or authored manually in the P12 editor); there is no
approval ledger or cohort rollback because cutover is offline with a JSON
archive as the rollback. Dropped gates M14–M18; the M18 intent (old backups
convert or fail with an explicit per-row report) lives in the converter.

### P16 — Measure and selectively optimize (small–medium; conditional)

**Dependencies:** stable v2 behavior through P13; may run before/after cohort cutover.
**Touch:** metrics, trigger index, immutable-context preparation, verified compilation cache.
**Steps:** collect baseline/burst timings; add kind/source index; invalidation on membership/references; compare to scan-all; optimize only demonstrated costs.
**Tests/gate:** PF01–PF05 performance tests below. No changed decisions or dropped report pulses. Bound memory/queues at sustained load. Document measured results and machine; no broad unsupported speed claims.

### P17 — Final audit and removal of compatibility debt (small–medium)

**Dependencies:** P14–P16 and all retirement gates.
**Touch:** docs/AGENTS accuracy, unused integration branches/assets, reference aliases only when safe, final source audit.
**Steps:** remove dead wrappers, not useful generic source/timer helpers; deprecate v1 authoring only after routine ledger is complete; keep old-backup conversion tests; publish semantics and operational recovery documentation.
**Tests/gate:** full backend/frontend/DB/deployment checks; search all Boa evaluation sites; exercise default ephemeral and DB-backed startup. Verify no fake integrations remain necessary for new automation creation.

## 13. Acceptance-test catalog

Write descriptive Rust/TypeScript test names using these IDs in comments or fixture metadata. Cases describe required assertions, not merely scenarios to run.

### Baseline and validation

| ID | Required assertion |
|---|---|
| B01 | Legacy defaults remain sensor/raw pulse and device/group level until explicit conversion. |
| B02 | A matching legacy all-level routine can match again on an unrelated eligible update; v2 does not acquire this behavior by default. |
| B03 | Legacy mixed Any and multiple event-leaf fixtures preserve actual paired-bit behavior in the oracle. |
| B04 | Script expressions/truthiness and malformed rows are characterized separately from the proposed strict v2 contract. |
| B05 | Legacy group scene/mirroring timing, source groups, and relative actions are captured. |
| B06 | Timer, cron enablement, and circadian source samples captured without hardware. |
| V01 | Malformed/ambiguous/unknown-version JSON returns a path-specific error; no empty fallback definition is enabled. |
| V02 | Invalid script syntax fails at save/enable; validation does not execute arbitrary top-level effects. |
| V03 | Nonfinite/range/type/duration/capability errors are rejected in native and script outputs. |
| V04 | Disabled invalid definitions remain visible, editable, and present in export/inventory. |
| V05 | Status refresh cannot write fired history or change transition memory. |
| V06 | Group/scene/source cycles are rejected with a useful path. |
| V07 | Definition compiler output is identical across save/load/import/simulation entry points. |
| V08 | Unsupported/new fields cannot be lost through a legacy editor/API write to a v2 row. |

### Events, triggers, and state knowledge

| ID | Required assertion |
|---|---|
| E01 | Queue true then false before handling derived work; first decision sees its own true frame, second its false frame. |
| E02 | Repeated identical sensor/button reports have different event IDs and preserve pulse counts. |
| E03 | Command acknowledgments, desired changes, and raw reports do not become indistinguishable trigger events. |
| E04 | One scene batch updates several devices; v2 group transition sees coherent before/after, not partial intermediate groups. |
| E05 | Delayed rollout steps are separate timed batches and preserve source/cause metadata. |
| E06 | Startup/config reload seeds transitions without accidental firing. |
| E07 | An obsolete integration lifecycle event is rejected after reload/cutover. |
| E08 | Causation loops stop at a configured bound with trace and without unbounded recursion/queue growth. |
| T01 | One event matching two triggers creates one invocation listing both IDs. |
| T02 | Condition-only changes never invoke an event-triggered routine. |
| T03 | Known false -> true fires once; true -> true does not; true -> false rearms. |
| T04 | Unknown -> true does not fire under default transition policy. |
| T05 | Two triggers reading one device have independent history and survive unrelated trigger edits correctly. |
| T06 | A trigger transition advances history even if the routine condition is false. |
| C01–C03 | Exhaustive truth tables for all/any/not, including unknown. |
| C04 | Evaluated error stays an error under not/any/all; no error authorizes execution. |
| C05 | Omitted routine condition normalizes to literal true; empty stored all/any is rejected. |
| C06 | Missing field/entity becomes unknown at runtime, not a false physical observation. |
| C07 | Offline observed state unknown; requested mode/scene remains known where stored. |
| C08 | Fresh report without separate availability metadata can still provide known evidence. |
| C09 | Freshness expiry wakes an affected transition without unrelated device traffic. |
| C10 | Preview uses an isolated copy of trigger memory and produces no live memory delta. |
| G01 | One missing configured member is counted as unknown, not removed. |
| G02 | Nested groups deduplicate members and preserve missing references. |
| G03 | Empty group is unknown; not(empty-group-all) is also unknown. |
| G04 | Partial requires known disagreement; all-on false is not treated as all-off true. |
| G05 | Mixed scene assignments produce mixed, not arbitrary/majority scene selection. |
| G06 | Membership changes invalidate predicate subscriptions and pending target-resolution guards. |
| G07 | Native group result, script helper, and UI trace agree exactly. |

### Plans, workers, and scene materialization

| ID | Required assertion |
|---|---|
| A01 | Scene selected from mode remains the event-time choice; changing source scene before dispatch does not silently change v2 selection. |
| A02 | V1 dispatch-time mirroring remains legacy behavior until deliberately migrated. |
| A03 | A newer manual target intent rejects a stale plan; a report-only revision change does not. |
| A04 | A missing/mixed mirror source uses only the configured fallback and records why. |
| A05 | Source-derived targets are frozen and deduplicated; no-source invocation does not invent a device/group. |
| A06 | Relative dim/cycle uses documented acceptance-time target state and is never automatically retried as idempotent. |
| A07 | Queued button presses retain order/count; restart invalidates old results; single reports suppression. |
| A08 | Queue overflow is bounded and visible; routine-owned timers survive unrelated new invocations. |
| A09 | Script/native commands pass the same target/capability/action validator and preserve calibration/override processing. |
| S01–S03 | Infinite loop, deep recursion, and long computation time out/terminate without blocking actor progress. |
| S04 | Worker memory/output abuse is contained within the documented platform limits. |
| S05 | Worker crash/protocol truncation produces a bounded failure and successful replacement worker. |
| S06 | Prototype/global changes from one invocation cannot affect the next. |
| S07 | No ambient network/filesystem/process/secret capability is exposed. |
| S08 | Worker is killed and reaped, not merely abandoned after a timeout. |
| S09 | Compile/preview/scene work cannot bypass worker limits. |
| S10 | Condition rejects strings, Promise, arrays, and wrong-shaped objects; explicit unknown is accepted. |
| S11 | Frozen context, fixed clock, seeded randomness produce repeatable results. |
| S12 | Owner state changes only for a successful current result and correct revision. |
| S13 | Missing-entity lookup is tracked; discovery can wake declared dependencies. |
| S14 | Undeclared source/transition reads fail or use an explicitly broad compatibility subscription. |
| S15 | Conditional reads cannot unsafely narrow subscriptions to the previous execution's branch. |
| S16 | Disabled/edited routines cannot publish late script results. |
| S17 | Stale-plan rejection uses relevant guards, not every global snapshot change. |
| SC01 | Startup/reload/preview/invalidation all use off-actor scene materialization. |
| SC02 | Scene-script errors mark stale/error materialization rather than silently reporting a healthy empty override. |
| SC03 | An old scene result cannot overwrite a later scene selection. |
| SC04 | Manual override and manually-off policy survive source refresh. |
| SC05 | Devices not assigned to the dependent scene receive no source-refresh command. |
| SC06 | Group/config/source dependency changes invalidate only current scene materializations and reject stale workers. |

### Timers, calendar time, and persistence

| ID | Required assertion |
|---|---|
| J01 | Replace timer then deliver old wakeup: zero expiry action from old generation. |
| J02 | Cancel twice succeeds; queued obsolete expiry cannot revive the timer. |
| J03 | Same timer key in two routines does not collide. |
| J04 | Zero delay queues a later event; it does not recurse inline. |
| J05 | Expiry evaluates current conditions, not captured original conditions. |
| J06 | Continuous predicate timer cancels on false or unknown; expiry rechecks both state and generation. |
| J07 | Relative timer duration ignores a wall-clock jump within a running process. |
| J08 | Intent captured after scene activation prevents later delayed-off from overriding manual changes. |
| J09 | New group members cannot receive unguarded delayed actions from an old frozen target set. |
| J10 | Session jobs vanish on restart with a visible policy; durable jobs follow their misfire policy. |
| J11 | Acknowledged durable replace/cancel survives process restart. |
| J12 | Crash before/after pending-job claim yields documented pending/interrupted behavior, not silent duplicate attempts. |
| J13 | Durable state/helper/job transaction either commits all internal writes or none. |
| J14 | DB-unavailable durable operation does not dispatch its device effects or falsely report persisted success. |
| J15 | Manual intent change during persistence suppresses obsolete external effects and records internal-commit status accurately. |
| J16 | Configuration backup restore does not resume old jobs or replay old cron occurrences. |
| J17 | Owner disable/edit generation persists in correct order relative to pending jobs and state writes. |
| K01 | Cron grammar and DOM/DOW behavior match the explicitly pinned/parser-tested policy. |
| K02 | Explicit timezone next occurrences independent of process/container timezone. |
| K03 | Spring-forward missing local time skips according to policy. |
| K04 | Fall-back repeated local time occurs once at earlier instant by default; no accidental duplicate. |
| K05 | Wall clock forward/backward changes and restart do not repeat an already handled occurrence. |
| K06 | Missed recurring ticks coalesce/skip as configured, with a finite catch-up bound and accurate next-occurrence preview. |

### Sources, UI, migration, and performance

| ID | Required assertion |
|---|---|
| D01 | Legacy circadian golden output matches on representative minute samples and fade boundaries. |
| D02 | Optional brightness absence, color units, color mixing, easing, clamping, and transition preserved. |
| D03 | Invalid/overlapping/cross-midnight config is reported or deliberately versioned, not silently normalized. |
| D04 | Startup recomputes current profile once; missed ticks are not replayed. |
| D05 | Same computed value need not cause repeat physical commands; legacy periodic event projection remains when required. |
| D06 | Source error retains last-good value with stale/error quality, not false healthy status. |
| D07 | Source key alias resolves one entity and does not double-count group membership. |
| D08 | Integration reload/disable cleanup respects computed ownership. |
| D09 | Computed source rejects actuator writes and has no physical integration publisher. |
| D10 | Preset fork/edit changes a DB-backed script/definition without mutating the shipped preset for other users. |
| X01 | Status/preview cannot change history, live edges, helper values, jobs, or scheduler cursors. |
| X02 | Trace explains selected scene/fallback, targets, and suppression. |
| X03 | Match/accepted/dispatched/acknowledged are separate statuses. |
| X04 | Trace size/log limits remain bounded under faults. |
| X05 | Native/script equivalent fixtures yield equivalent command plans. |
| X06 | Every effect category routes through the sandbox sink in dry-run, including custom integration commands and callbacks. |
| X07 | Identical replay/time/seed yields identical decisions; incomplete input capture is marked incomplete. |
| U01–U03 | Native rule, script rule, and legacy definition round-trip without losing supported data. |
| U04 | Builder quantifiers/unknown reasons agree with server traces. |
| U05 | Schedule timezone/DST/misfire, timers, and execution policy have accurate readable summaries. |
| U06 | Presets create DB-backed definitions and remain usable without editing JS. |
| M01–M03 | SQLite/Postgres schema migration, old export import, and mixed-version round trip succeed. |
| M04–M06 | Durable recovery, explicit ephemeral mode, and no operational-state replay on config restore. |
| M07–M09 | Per-routine differential comparison, preserved raw archive, and atomic enable/rollback manifest. |
| M10 | Timer cutover rejects queued old epochs and does not run both clocks. |
| M11 | Cron cutover preserves current enabled state/timezone/action payload and avoids duplicate occurrences. |
| M12 | Disabled legacy integrations do not create enabled routines/sources. |
| M13 | Opaque unresolved script/dashboard references prevent deleting required aliases. |
| M14 | Circadian cutover produces one publisher and preserves linked scenes. |
| M15 | Four scene-outcome staircase routines can deliberately consolidate around one explicit mode. |
| M16 | Every migrated row has an approval/difference record; no unreviewed automatic enablement. |
| M17 | Rollback restores old owner/definitions without dual scheduling/publication. |
| M18 | Old backup import converts retired wrappers or returns a specific migration report, never ignores them. |
| PF01 | Scan-all and indexed v2 evaluation produce identical decisions on generated/replayed events. |
| PF02 | Burst report input retains pulse count/order under queued policy and exposes overflow honestly. |
| PF03 | Slow/failing scripts leave actor/native control responsive. |
| PF04 | Source-refresh coalescing changes no event-triggered pulse behavior. |
| PF05 | Sustained supported load has bounded new automation queues/trace/worker memory; actor ingress is measured separately; timings include environment and event rate. |

## 14. Validation commands and release gate

Use the repository's active workspace conventions; verify commands against the current revision before running. The pinned CI includes a locked, single-test-thread backend test run and separate fmt/clippy checks; UI package scripts include lint, typecheck, and build. The Hurl harness can skip when its executable is absent, so CI must verify that prerequisite explicitly. [A14, A15, A16]

```sh
# From repository root (verify workspace layout first):
cargo test --all --locked -- --test-threads=1

# Backend checks:
cd server
cargo check --locked
cargo fmt --all -- --check
cargo clippy --locked -- -D warnings

# Frontend checks, from repository root in another shell:
cd ui
pnpm install --frozen-lockfile
pnpm lint
pnpm tsc
pnpm build
```

Also execute both backend-specific DB tests, fake-clock tests, worker process-failure tests, source parity tests, migration rollback tests, and sandbox-effect tests. Add CI verification for the worker binary in the deployment image and required OS limits. Regenerate ts-rs bindings through the repository's established export tests/process; do not hand-edit generated files. Run `git diff --check` and inspect generated binding changes.

Release is blocked if any path evaluates user JS in the state actor, any old/new integration owners can both publish, a preview can reach a live effect, malformed config silently becomes an enabled empty definition, or a durable acknowledgment can be rolled back by ordinary restart.

## 15. Explicit deferrals

Do not implement a Rete network, arbitrary temporal correlation language, automatic dependency proof for JavaScript, generic expression-valued fields everywhere, automatic closure persistence, unrestricted npm/Node environment, distributed scheduler/leader election, whole-system event sourcing, or a blanket exactly-once effect claim.

Do not redesign device integration protocols, replace Warp/SeaORM/SQLite/Postgres/React, or remove the actor architecture. Do not erase virtual sources merely because fake integration wrappers are removed. Defer fully general shared-script modules, sophisticated action priorities, a new scene engine, and profile astronomy until the core model and real authoring needs justify them.

A small server-owned scheduler, explicit helper values, bounded script workers, coherent frames, and one shared command path are not over-engineering here: they are the minimum infrastructure for the proposed scripted fallback to remain understandable and safe to operate.

## Appendix A. Pinned implementation evidence

Line ranges below use GitHub's 1-based lines and enclose the relevant code at `5aef129c`. They are navigation references, not claims that the proposed modules already exist.

| Ref | Baseline location | Relevance |
|---|---|---|
| A1 | [AGENTS.md:88–115, 183–200](https://github.com/FruitieX/homectl/blob/5aef129c/AGENTS.md#L88-L115) | State actor/snapshot architecture and DB runtime-config policy. |
| A2 | [server/src/db/mod.rs:88–105](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/db/mod.rs#L88-L105); [db/migrations/mod.rs:1–25](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/db/migrations/mod.rs#L1-L25); [db/config_queries.rs:56–64,177–205](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/db/config_queries.rs#L56-L64) | Active migration registry, routine storage, export structure. |
| A3 | [core/devices.rs:568–633](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/devices.rs#L568-L633); [core/event.rs:267–317](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/event.rs#L267-L317) | State insertion/queued internal update and later evaluation against actor state. |
| A4 | [core/routines.rs:183–226,287–395,400–648](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/routines.rs#L183-L226); [types/rule.rs:15–45](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/types/rule.rs#L15-L45); [api/config/routines.rs:56–101](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/api/config/routines.rs#L56-L101) | Decode fallbacks, history/evaluation coupling, matching/edge keys, documented level wording, save validation. |
| A5 | [integrations/timer/mod.rs:45–100](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/integrations/timer/mod.rs#L45-L100); [integrations/cron/mod.rs:20–31,62–145](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/integrations/cron/mod.rs#L62-L145) | Timer virtual device/restart; cron local-time loop and enabled-device gate. |
| A6 | [integrations/circadian/mod.rs:19–33,91–198](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/integrations/circadian/mod.rs#L91-L198) | Circadian parameters, curve, colors, optional brightness, periodic color-sensor output. |
| A7 | [core/groups.rs:66–91,215–249](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/groups.rs#L66-L91) | Flattening filters unresolved members; common-scene calculation. |
| A8 | [core/scripting.rs:23–60,71–119,142–174](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/scripting.rs#L23-L60); [server/Cargo.toml:68–74](https://github.com/FruitieX/homectl/blob/5aef129c/server/Cargo.toml#L68-L74) | Existing Boa budgets, group projection, expression/truthiness contract, pinned engine/parser. |
| A9 | [types/action.rs:26–62](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/types/action.rs#L26-L62) | Existing action inventory. |
| A10 | [types/scene.rs:37–110](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/types/scene.rs#L37-L110); [core/routines.rs:56–109](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/routines.rs#L56-L109) | Existing mirror descriptors and source-context action expansion. |
| A11 | [core/scenes.rs:24–88,138–176,705–768,988–1074](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/scenes.rs#L138-L176); [core/devices.rs:285–319](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/devices.rs#L285-L319) | Script dependency extraction, color-sensor links, script materialization and reactive scene refresh. |
| A12 | [core/simulate.rs:725–843](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/simulate.rs#L725-L843) | MQTT-to-dummy conversion and reference collection. |
| A13 | [core/state/actor.rs:29–38,136–178](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/core/state/actor.rs#L136-L178) | Existing actor metrics/watchdog wiring. |
| A14 | [.github/workflows/server-ci.yml:30–70](https://github.com/FruitieX/homectl/blob/5aef129c/.github/workflows/server-ci.yml#L30-L70) | Backend CI checks and DB-test prerequisite. |
| A15 | [server/tests/integration.rs:56–64,97–110](https://github.com/FruitieX/homectl/blob/5aef129c/server/tests/integration.rs#L97-L110) | Hurl prerequisite can cause tests to skip. |
| A16 | [ui/package.json:1–9,17–20,73–75](https://github.com/FruitieX/homectl/blob/5aef129c/ui/package.json#L1-L20) | UI scripts and existing Monaco dependency. |
| A17 | [ui/ui/RuleBuilder.tsx:893–915](https://github.com/FruitieX/homectl/blob/5aef129c/ui/ui/RuleBuilder.tsx#L893-L915); [ui/ui/routine-summary.tsx:1–33](https://github.com/FruitieX/homectl/blob/5aef129c/ui/ui/routine-summary.tsx#L1-L33) | Existing script-editor return example and summary/type coupling. |
| A18 | [croner 2.2.0 official API documentation](https://docs.rs/croner/2.2.0/croner/struct.Cron.html) | Pinned parser APIs; grammar and timezone behavior must be fixture-tested. |
| A19 | [Tokio spawn_blocking documentation](https://docs.rs/tokio/1.53.1/tokio/task/fn.spawn_blocking.html); [Tokio timeout documentation](https://docs.rs/tokio/1.53.1/tokio/time/fn.timeout.html) | Started blocking jobs are not forcibly aborted by cancelling a task; non-yielding work can exceed timeout. |
| A20 | [types/color.rs:4–24](https://github.com/FruitieX/homectl/blob/5aef129c/server/src/types/color.rs#L4-L24) | Color capability/temperature context; preserve representation and verify conversion helpers. |

## 16. Implementation progress log

This section is maintained by the implementing agent. It is not part of the
original specification. Status is per work package; "done" means code is
committed and the named checks were run locally.

### P00 — Baseline, ADRs, fixture harness: **done**

- `docs/adr/0001..0007` record the target model/defaults from Sections 1–6.
- Offline replay format + harness in `server/src/core/automation_baseline.rs`
  (no integration/MQTT/DB/clock sinks) plus `server/tests/automation_baseline.rs`
  and `server/tests/fixtures/baseline_pulse_framed.json`.
- Characterization tests B01–B06 and E01 pass; circadian curve extracted into
  injectable pure functions (`night_fade_at`, `circadian_color_at`,
  `circadian_brightness_at`) with golden samples. No runtime semantics changed.
- Commit: `test(automation): add v2 baseline ADRs and characterization harness`.

### P01 — Validation and truthful history: **done**

- New `server/src/core/routine_validation.rs` with path/code/message errors.
- Enabled routines with empty/malformed rules, invalid actions, non-finite
  values, invalid script syntax, or invalid spatial rollout are rejected at
  save; at load they are quarantined as non-runnable and surfaced through
  runtime status. Disabled invalid drafts remain stored.
- Status refresh/preview no longer writes routine history; v1 `level` docs
  corrected. Intentional semantic change: an enabled routine with zero rules is
  no longer stored as an always-false empty routine.
- Tests V01–V05 + X01 added. Commit:
  `feat(automation): validate routines and stop status refresh writing history`.

### P02 — Coherent frames and event origin: **done**

- `server/src/types/automation_event.rs` adds `EventId`, `EventSequencer`,
  `EventOrigin`, `EventCausation` (depth/parent/cause), `DeviceMutation`,
  `AutomationFrame`, `FrameDisposition`, and a bounded `FrameLog`
  (`MAX_CAUSATION_DEPTH=16`, `MAX_DERIVATION_STEPS=256`, capacity 256).
- `Devices` collects `DeviceMutation`s per actor command instead of emitting
  `InternalStateUpdate`; `Event::InternalStateUpdate` remains as a
  serde-compatible compat arm. Raw report paths are `EventOrigin::Report`,
  desired-state commands `Command`, internal materialization/rollout `Derived`,
  DB restore/reload seeding `Startup`.
- `AppState::flush_pending_frames` drains the collector once per actor command,
  performs bounded group/scene derivation into the same frame, and evaluates
  routines per mutation against the command's own coherent `after` state
  (fixes the P00 E01 hazard; E02 pulse counts preserved).
- Multi-device scene batches share one frame with pre-command `before` values
  (E04). Spatial rollout emits immediate and delayed `ApplyDeviceState` batches
  that keep the scheduling frame's `cause_id`/depth (E05). Startup and config
  reload seed edge transition memory without firing stale true predicates (E06).
- Integration instances get lifecycle epochs; a per-instance forwarder stamps
  data-plane events and events from superseded instances are rejected after
  reload (E07). Self-triggering action chains stop at `MAX_CAUSATION_DEPTH` with
  a visible `CausationLimited` frame instead of unbounded queue growth (E08).
- Tests E03–E08 added as unit tests in `core/event.rs`; E01/E02 remain in
  `automation_baseline.rs`. UI bindings regenerated (new `EventCausation.ts`).
- Commits: `feat(automation): evaluate queued updates against coherent event
  frames`, `test: wait for server readiness instead of liveness in the harness`,
  plus the P02 completion commit (mutation collector, origins, epochs, seeding,
  causation bound).

### Cross-cutting test-harness fix

`server/tests/common/mod.rs` now waits for `/health/ready` rather than
`/health/live`. The server ignores device updates and routine evaluation during
warmup, so several hurl tests previously raced the warmup window.

### Hurl suite repaired

The hurl suite (`server/tests/integration.rs`) previously failed for five
scripts. Causes and fixes:

- Warmup race: `/health/ready` is now the readiness gate (above).
- Ignored configs: legacy TOML `@config` blocks were silently ignored because
  `parse_config_backup` only accepts JSON exports. TOML support was deliberately
  **not** resurrected (it has been retired). Instead the four name-based scripts
  now reference id-based JSON export fixtures via a new `@configfile`
  front-matter directive (`server/tests/hurl/configs/*.json`).
- `config-api.hurl` created an enabled routine with zero rules, which P01 now
  rejects; it uses a valid rule.

All seven hurl scripts pass (`health`, `config-api`, `device-state`,
`group-any-rules`, `scene-cycling-mixed`, `staircase-motion`,
`trigger-modes`). Commit: `test: migrate hurl fixtures to JSON export configs`.

### Next package

P03 (v2 schema and compiler, not yet enabled): additive routine columns
(`semantics_version`, `definition_v2`, `revision`), strict version dispatch,
tagged v2 types, shared compiler, invalid-draft support, and M01–M03.

### P03 implemented: v2 schema and compiler (not yet enabled)

Commit: `feat(automation): add v2 routine schema and pure definition compiler`.

- Additive routine columns via migration `M20260919000000RoutineV2Semantics`:
  `semantics_version` (integer, default 1), `definition_v2` (text, nullable),
  `revision` (big integer, default 1). `RoutineRow` gained the matching fields
  plus `#[serde(skip_serializing_if)]` so v1 exports stay byte-identical; old
  exports/imports round-trip unchanged (M02).
- `types/automation_definition.rs` defines the tagged v2 schema:
  `RoutineDefinitionV2`, `TriggerSpec`, `ConditionExpr`, `ValueSource`,
  `Program`/`NativeProgram`/`ScriptProgram`, `NativeAction`, `TargetSpec`,
  `ExecutionPolicy`, stable `NodeId`/`TimerId`/`HelperId`/`SourceId`.
  `definition_v2` is stored as raw `serde_json::Value` so unknown/newer fields
  survive save/export/import verbatim; malformed stored text is preserved as
  `Value::String` rather than dropped.
- `core/automation/compile.rs` is a pure compiler shared by the API, runtime
  loader, and simulation: `compile_definition(_value)`, `compile_row`,
  `parse_definition`, `definition_fingerprint` (FNV-1a 64 over the serialized
  normalized definition; V07 identity across all entry points),
  `reference_inventory`, `referenced_devices`, `prepare_write`,
  `next_revision`, and `rewrite_invoked_routine_references`. Group/scene/source
  cycle and routine self-invocation detection report path-specific errors
  (V06).
- Strict version dispatch (V01): `semantics_version` is authoritative; unknown
  versions are rejected at save/import with `unsupported_semantics_version` and
  quarantined on load — never interpreted as v1. A v2 row without a body is a
  validation error; parse failures report the failing JSON path with no
  empty-definition fallback.
- Scripts (V02) are validated syntactically with a function-body wrapper
  (`(function __homectl_v2_body() { ... })`) via the existing Boa parser and
  are never executed at compile time. Declarations and API-version are
  bounded/validated.
- Bounds and range checks (V03): trigger/action/node/choose-depth/script
  declaration/duration/dim-step limits, empty `all`/`any`, duplicate node IDs,
  missing capability checks, and unknown group/scene/routine/timer/helper/
  device references produce `/path`-addressed errors.
- Invalid drafts (V04) are first-class: enabled rows must compile, disabled
  rows may not, and disabled invalid rows stay in the reference inventory,
  listed by the API, and included in exports.
- Runtime loader (`core/routines.rs`) dispatches by version: v1 rows compile
  through the legacy validator and stay in `runtime_config`; valid v2 rows
  land in a `compiled_v2` map with status (`semantics_not_executed`, P04
  pending); enabled malformed/unknown rows are quarantined with reports.
  Legacy status refresh still never writes history (V05).
- API writes: create/update validate shape with the snapshot-derived catalog
  (strict device resolution) and reject unknown versions; `prepare_write`
  preserves a stored v2 body on a legacy editor write (V08) and assigns
  `revision` (server-managed, 1 on create, +1 on update); renaming a routine
  rewrites v2 invoke references. Import validation applies the same rules
  (`validate_imported_routines`) while allowing disabled invalid drafts.
- Simulation: v2 columns are selected with a legacy fallback during migration
  windows, and `convert_mqtt_to_dummy` reuses `referenced_devices` so v2 rows
  contribute device references exactly like the compiler (V07).
- Gates: 13 compiler unit tests (V01–V08), migration M01 test, runtime
  quarantine/status test, two API integration tests (save/validate/draft/
  legacy-preservation and mixed-semantics SQLite round trip incl. restart,
  M02/M03), and a Postgres mixed-semantics restart test. Full suite:
  329 lib + 34 config-api + 7 postgres + 15 integration tests pass; clippy
  clean for new code; `ui/bindings/` regenerated with the 22 new TS types.

### P04 implemented: native evaluator and explicit group quality

Commit: `feat(automation): evaluate v2 triggers and conditions natively`.

- `core/automation/evaluate.rs` is the scan-all, side-effect-free decision
  engine. It evaluates every trigger of every compiled routine against one
  coherent actor frame (mutations plus before/after device views) and returns
  one decision per routine in stable ID order. Reports are individual events
  (E02/T02); `state_change` fires only on known false -> true in `transition`
  mode (T03) and on every true update in `level` mode; `predicate_transition`
  compares the predicate on the coherent before/after views (T04/E04);
  `report` triggers can require a raw payload pointer.
- Strong three-valued logic for `all`/`any`/`not` with full truth tables
  (C01–C03), structured unknown reasons (`missing_entity`, `missing_field`,
  `offline`, `stale`, `empty_selection`, `not_initialized`,
  `unknown_source_value`), and strict error separation: any evaluated error
  dominates `not`/`all`/`any` and never authorizes execution (C04).
- Device value paths distinguish evidence from intent: `/`, `/observed`,
  `/observed/*`, `/value` read observed state (unknown when offline or never
  reported; a fresh report without availability metadata stays known, C08);
  `/power`, `/brightness`, `/color`, `/scene_id`, `/requested_at_ms` read
  requested intent and remain known while offline (C07); `/availability/*`
  and `/last_report/*` expose evidence metadata. Comparison operators cover
  eq/ne/gt/gte/lt/lte/contains/starts_with/exists/truthy/regex with numeric
  coercion, nonfinite-number errors, and invalid-regex errors. No global
  freshness timeout is invented; freshness-expiry scheduling is deferred to
  P09 (C09).
- `TriggerMemory` is keyed by `(routine_id, definition_revision, trigger_id)`,
  never by device alone, advances whenever a trigger is evaluated even when
  the routine condition rejects the invocation (T06), survives unrelated
  routine edits, and is dropped for changed revisions (T05). Preview clones
  the memory and cannot mutate live history (C10).
- `core/automation/groups.rs` introduces the shared `GroupEvaluation`
  (`configured_count`, true/false/unknown counts, members, truth, reasons,
  scene summary). The denominator is configured membership from
  `Groups::configured_device_refs`: recursively flattened, deduplicated, and
  preserving unresolved references (G01/G02). Empty selections are unknown
  under negation (G03); `partial` requires known disagreement (G04); scene
  summaries are uniform/unassigned/mixed/unknown and never infer majority
  intent (G05). Group configuration loads bump
  `Groups::definition_revision`, which invalidates transition memory (G06).
  The group evaluation is attached to the condition trace node so native
  results and traces agree exactly (G07; SDK helpers follow in P07).
- `core/automation/runtime.rs` owns compiled definitions, memory, and
  statuses. `V2Runtime::evaluate_frame` runs once per actor transaction from
  `flush_pending_frames` with a before view that rolls back every mutation,
  so multi-device batches never present partial group state (E04).
  `Routines::seed_transitions` seeds v2 memory at startup/reload without
  firing (E06); `refresh_runtime_statuses` re-evaluates conditions for
  display without touching memory or history (V05/X01).
- `RoutineRuntimeStatus` gained an optional `v2` detail with the definition
  revision, fingerprint, matched trigger IDs, per-trigger statuses, the full
  condition evaluation/trace, `will_trigger`, and `execution_pending: true`
  (action planning lands in P05).
- Gates: 41 evaluator/group/pure tests (C01–C10, T01–T06, G01–G07), 4
  runtime lifecycle tests, and a `Routines` frame-path integration test.
  Full suite: 368 lib + 34 config-api + 7 postgres + 15 integration tests
  pass; clippy clean for new code; bindings regenerated (`TruthValue`,
  `UnknownReason`, `ConditionEvaluation`, `ConditionTraceNode`,
  `GroupEvaluation`, `GroupMemberEvaluation`, `GroupSceneSummary`,
  `RoutineV2RuntimeStatus`, `TriggerRuntimeStatus`, `Quantifier.partial`).
- Deferred intentionally: `predicate_for` arms server timers only once P09
  adds the scheduler; `schedule`/`timer_fired`/`startup`/`manual` triggers
  are recognized but do not fire yet; script helpers and script condition
  parity follow P07; V1 group/rules behavior remains on its own interpreter.

### P05 implemented: action plans, typed helpers, native staircase slice

Commit: `feat(automation): plan and dispatch v2 actions with typed helpers`.

- `core/helpers.rs` is the actor-owned registry for typed helpers
  (boolean/enum/number/string). Definitions carry an initial value and
  `durable`/`session` persistence; every write is validated against the
  declared kind (`HelperKind::validate_value`), so a helper can never hold an
  illegal value. Current durable values are persisted in
  `automation_value_state`; session values never leave the process.
- Database/export: new `automation_values` and `automation_value_state`
  tables (migration `M20260920000000AutomationHelpers`), queries
  (`db_get_helpers`, `db_upsert_helper`, `db_delete_helper`,
  `db_get_helper_states`, `db_upsert_helper_state`), and `ConfigExport`
  gained `helpers` plus `helper_values` (durable-only) with `serde(default)`
  so older exports import unchanged. `db_import_config` upserts definitions
  before durable values and skips values for undefined/session helpers.
- API: `GET /api/v1/config/helpers` (snapshot statuses),
  `PUT /api/v1/config/helpers/{id}` (validated definition upsert),
  `DELETE /api/v1/config/helpers/{id}`, and
  `PUT /api/v1/config/helpers/{id}/value`. Helper writes bump a revision,
  republish `helper_statuses`, and persist durable values through the
  deferred persistence lane (`DeferredEventWork::PersistHelperValue`).
- `types/automation_definition.rs` gained `SceneSelection`
  (`helper_enum` mapping with explicit fallback, `group_active` mirror with
  explicit fallback); `NativeAction::ActivateScene` now takes exactly one of
  `scene_id`/`select`. The compiler rejects ambiguous/missing selections,
  unknown helpers, non-enum helper mappings, invalid mapping keys, and
  `SetHelper` values that violate the helper kind; the catalog now resolves
  helper definitions (`with_helper_definition`).
- `core/automation/plan.rs` is the pure planner. It resolves scenes and
  targets at acceptance time and freezes them into the plan (A01), including
  helper-driven and group-mirror selection (fallbacks are explicit; mixed or
  unknown groups without a fallback suppress with a visible reason, A04),
  deduplicates and sorts targets (A05), evaluates `choose` branches against
  acceptance-time state, and records suppressed steps (timers until P09,
  awaited invocations, stale catalog entries, plan-bound overflow) instead of
  dropping them silently (X02).
- `IntentTracker` records monotonic intent revisions per device/group/scene.
  Only manual (`Command`) mutations and user-originated actions bump them;
  reports and derived changes do not. Plans capture the revisions of their
  targets and dispatch re-checks them, suppressing stale plans with
  `superseded_by_newer_intent` (A03).
- Execution: `flush_pending_frames` plans every `will_trigger` evaluation
  once per coherent frame, dispatches steps in order through the actor's own
  event channel (`RoutineAction`, new `RoutineSetHelper`), records a
  `PlannedRunStatus` (run id, acceptance, per-step disposition/reasons,
  dropped count), and republishes statuses with `execution_pending: false`
  (X03). `RoutineV2RuntimeStatus.last_run` exposes
  `PlannedRunStatus`/`PlannedStepStatus`/`StepDisposition`; plan suppressions
  bound the queue and stay visible (A08).
- Gates: 6 planner unit tests (A01/A03/A04/A05, timer deferral, stale
  catalog), the helper DB export/import round-trip test, a helper API
  integration test (validation, revision, export, delete, restart), and the
  staircase vertical slice through the actor (enum helper selects the scene,
  dispatched action is applied, run status separates match/accept/dispatch).
  Full suite: 384 lib + 35 config-api + 6 postgres + 15 integration tests
  pass; clippy clean for new code; bindings regenerated (`HelperDefinition`,
  `HelperKind`, `HelperPersistence`, `HelperRuntimeStatus`,
  `PlannedRunStatus`, `PlannedStepStatus`, `StepDisposition`,
  `SceneSelection`, `RoutineV2RuntimeStatus.last_run`).
- Deferred intentionally: native timers still land in P09 (plans surface
  `timers_not_implemented_until_p09`); script programs are suppressed until
  P06; `Dim` acceptance ignores the v2 `transition_ms` hint because the v1
  dim command has no transition field; v1 `mirror_from_group` resolution
  keeps its legacy execution-time timing (A02) while v2 mirrors are frozen.

### P06 implemented: JavaScript worker proof and supervisor

Commit: `feat(automation): run scripts in a supervised worker process`.

- `server/src/core/js_worker/` adds the worker architecture without migrating
  any existing call site:
  - `protocol.rs`: 4-byte big-endian length-prefixed JSON; frame length is
    validated against the direction's cap **before** allocating; zero-length
    frames, truncation, oversize frames, unknown fields, and id mismatches are
    protocol errors. Request/response carry `request_id`, per-incarnation
    `generation`, `run_id`, `api_version`, kind (`execute`/`validate`), script,
    and bounded `ctx`. Legacy caps stay: script 64 KiB, context 8 MiB, result
    1 MiB (+64 KiB frame headroom).
  - `engine.rs`: pinned Boa `=0.20.0` adapter. A fresh `Context`/realm per
    invocation; legacy runtime limits (10k loop iterations, recursion 64,
    stack 4096); `ctx` injected as a bounded JSON global; strict serialization
    rejects `undefined`, functions, symbols, `BigInt`, non-finite numbers,
    cycles, and oversize results. `validate` parses the P03
    `(function __homectl_v2_body() { ... })` wrapper without executing.
  - `supervisor.rs`: async pool (default 2 workers, one invocation per worker,
    32 outstanding requests). Invocation budget 200 ms; on timeout/crash/
    protocol error the child is `SIGKILL`ed with `.start_kill()` and reaped
    with `.wait()` (no `spawn_blocking`, no timeout-around-work), then eagerly
    replaced. A cancellation-safe `WorkerLease` kills and frees the slot if the
    caller drops the future. Children are spawned with `env_clear()`, no DB or
    live state, `RLIMIT_AS` 256 MiB, `RLIMIT_CPU` 5 s, `RLIMIT_CORE` 0; stderr
    is drained continuously into a capped 64 KiB ring so a flood cannot
    deadlock or grow server memory. Worker-reported script failures are bounded
    and do not retire the worker.
  - `server/src/bin/script-worker.rs`: process entry point; stdout is
    protocol-only; hidden `--test-mode` enables deterministic per-request fault
    injection (`echo`, `env`, `hang`, `alloc`, `crash`, `truncate`, `garbage`,
    `stderr_hang`) used by the tests.
- Deployment: `Dockerfile` copies `script-worker` next to the server binary and
  runs a `</dev/null` smoke check in the runtime image. `libc` is a unix-only
  dependency for the rlimits. No TypeScript types were added, so no binding
  regen.
- Measured containment on the supported deployment (NixOS/Linux, this host):
  trivial invocation including fresh realm + IPC takes **3.6 ms** against the
  200 ms default budget; the allocation probe (`try_reserve` until failure)
  held **128 MiB** before the 256 MiB `RLIMIT_AS` refused the next doubling;
  the stderr flood was capped at 8 KiB in-test while supervision stayed
  drained; timed-out pids disappear from `/proc` after `.wait()`.
- Gates S01–S09: 18 process-level tests in `server/tests/script_worker.rs`
  (plus 16 unit tests in the module). Infinite loop/long computation
  terminate via engine limits; native hangs time out; a current-thread ticker
  keeps advancing during a 400 ms hang; crash/truncation/garbage produce a
  bounded failure plus a working replacement; globals and prototypes do not
  leak; no ambient process/network/filesystem/secret capability and an empty
  inherited environment; kill+reap verified via `/proc`; validate requests use
  the same timeout/kill path and pre-worker request limits.
- Full suite: 402 lib + 18 script-worker + 10 baseline + 15 config-api +
  35 config-api-integration + 7 integration + 6 postgres + 11 routine-rules +
  6 scene-cycling + 4 scripting pass; clippy clean for new code (pre-existing
  warnings unchanged).
- Deliberate scope limits: P06 keeps every script call site untouched. v1
  rule/scene scripts and the P03 parse-only script syntax check still run
  in-process; routing them through `execute`/`validate` is P07 (v1 rule-leaf
  adapter) and P08 (every scene path). S09 is proven at the supervisor
  boundary (compile/validate work shares timeout, kill, and input caps); the
  caller migration is tracked by those packages. P07 also owns the four output
  contracts, deterministic time/randomness, subscriptions, owner memory, and
  per-owner queues.

### P07 (part 1) implemented: script ABI, contracts, and owner coordinator

Commit: `feat(automation): add the script ABI, contracts, and owner coordinator`.

- `core/automation/script_prelude.js` is the fixed, versioned ABI asset
  injected into every invocation realm by the P06 worker
  (`js_worker::engine`): deep-frozen `ctx`, seeded `api.random` (mulberry32)
  and `Math.random`, fixed `api.now`/`Date.now`/zero-argument `new Date`
  derived from `ctx.now_ms`, unknown-preserving `api.not`/`api.unknown`, pure
  `api.actions.*`/`api.timers.*` builders, and `api.values.get/requireEnum`.
  No I/O, no live timers, no ambient nondeterminism.
- `core/automation/script_contract.rs` implements the four output contracts
  with strict parsing: condition (strict boolean or explicit
  `{kind:"unknown", reason?}`; strings/Promises/arrays/wrong objects are
  errors), routine handler (`{actions, next_state?}` normalized into the
  shared typed `NativeAction` model with stable `script/<index>` IDs and
  bounded action nodes), scene materializer, and computed source. Bounds:
  128 action nodes, 64 KiB `next_state`, 256 materialized devices.
- `core/automation/script_coordinator.rs` is the pure owner bookkeeping:
  per-owner generation (bumped on edit and enable/disable transitions),
  bounded per-owner pending queues, `Queue` vs `LatestWins` coalescing, memory
  CAS by state revision, and visible stale reasons
  (`definition_changed`, `owner_disabled`, `superseded`, `state_changed`).
  Contract parsing happens after staleness checks, so obsolete results are
  rejected as obsolete even when malformed. Disable/edit drops pending results
  without resetting memory; deletion drops both.
- Gates S10/S11/S12/S16: 5 process-level tests in `server/tests/script_abi.rs`
  drive the real worker through the coordinator (strict condition rejection
  incl. Promise results, replayable clock/randomness across fresh realms,
  frozen `ctx`, memory CAS, edit/disable invalidation) plus 10 module unit
  tests in the contract/coordinator modules. Full suite: 413 lib + 18
  script-worker + 5 script-ABI + prior suites pass; clippy clean for new code.
- Still open in P07 (next part): wiring `Program::Script` and v2 scripted
  triggers into `plan_runs`/`flush_pending_frames` (submit off-actor, deliver a
  result event, plan/dispatch on apply, visible pending/failed statuses);
  declaration validation and read tracking (S13–S15); relevant-guard stale
  rejection (S17); native/script plan equivalence fixtures (X05); and the
  off-actor v1 rule-script leaf adapter from Section 6.4 (a worker invocation
  format for legacy globals, raw expression completion, and boolean
  truthiness, never a live-state re-evaluation).

### P07 (part 2a) implemented: execute v2 script programs off the actor

Commit: `feat(automation): execute v2 script programs off the actor`.

- `flush_pending_frames` now splits triggered v2 evaluations: native programs
  are planned and dispatched inline as before, while `Program::Script` runs are
  admitted through `ScriptCoordinator` and handed to a **lazy** supervised
  `JsWorkerPool` owned by `AppState.scripts` (`ScriptExecution`). No worker is
  spawned until an enabled script program actually has work; a missing
  `script-worker` binary caches the init failure and records a visible
  `script_worker_unavailable` rejection per run instead of panicking or
  blocking startup. Configuration reload clears the cached error.
- `core/automation/script_runtime.rs` owns owner reconciliation
  (`sync_owners`: revision changes bump the generation, removed definitions drop
  the owner), lazy pool creation, per-invocation seed derivation, and the
  declaration-scoped context builder. `ctx` carries
  `now_ms`/`seed`/`event`/`before`/`after`/`values.helpers`/`state`, and
  `before`/`after` expose only declared devices plus the devices mutated by the
  triggering frame, so undeclared reads are absent rather than silently
  observed (S14/S15 direction; no branch-dependent narrowing is possible).
  `ctx.now_ms` comes from a single injected `fn() -> i64` clock (production
  default is the wall clock; P09 replaces it with a real clock abstraction).
- `Event::RoutineScriptResult` is the internal actor event for a completed
  handler invocation. It carries the identifying token fields plus either the
  strict worker result or a bounded error. The actor reconstructs the token,
  completes the coordinator (contract parsing after staleness checks), plans the
  returned typed actions against **acceptance-time** state through the shared
  native planner (`plan_script_actions`), dispatches with the original frame's
  child causation, and records the visible run. Stale/contract/worker failures
  record `accepted: false` with the reason in `last_run` and dispatch nothing
  (S16/X03). `V2Runtime::plan_runs` skips script programs; `record_script_failure`
  can create a status entry so a rejection after a reload stays visible.
- Metrics: `KIND_LABELS` is append-only; `HandleEvent:RoutineScriptResult` is
  index 15 and `KIND_MUTATE` stays 11. The result event deliberately does not
  report through `Event::causation()`: a result arriving at the causal bound
  still completes admission, and its planned actions are rejected at dispatch
  by the same depth bound as native plans.
- Gates: 3 actor-level tests in `core/event.rs` drive the real worker binary
  (vertical slice: pending status visible, typed `set_power` plan dispatched,
  memory `next_state` applied, device reached; edit-before-result rejected as
  `definition_changed`; missing binary visible and non-blocking), plus 6 new
  unit tests (X05 native/script plan equivalence, context scoping, injected
  clock/seed, owner sync). Full suite: 420 lib + 18 script-worker + 5 script-ABI
  + all prior suites pass; clippy clean for new code.
- Still open in P07 (next parts): the off-actor v1 rule-script leaf adapter
  from Section 6.4; explicit declaration enforcement beyond the scoped context
  (S13 missing-entity wake-up and a broader compatibility subscription are not
  wired); S17 stays satisfied by acceptance-time replanning plus per-target
  intent guards (no global-snapshot invalidation). v2 owner memory is
  in-process only until P10 owns durability; `next_state` therefore resets on
  restart and is documented rather than silently persisted.

### P07 (part 2b) implemented: off-actor v1 rule-script leaves

Commit: `feat(automation): route v1 rule scripts through the worker`.

- Worker ABI: a distinct `RequestKind::ExecuteLegacy` request kind plus a
  per-kind API version (`SUPPORTED_LEGACY_API_VERSION`) keeps v1 rule semantics
  explicit and separately versioned. `script-worker` evaluates the stored
  expression in a fresh realm with the scene-script helper prelude and injected
  `devices`/`groups` globals, then applies JS truthiness to the raw result;
  `return` statements remain syntax errors (v1 semantics). `core/scripting.rs`
  exposes `legacy_rule_context`/`legacy_groups_map` so the worker context is
  exactly the projection scene scripts already see.
- Deferral: `Routines` no longer runs a `ScriptEngine` in-process for
  `Rule::Script`. Frame evaluation captures native leaf decisions plus frozen
  actions, publishes a visible pending placeholder, and queues a
  `LegacyScriptRequest` per triggered row with stable leaf paths (`rules/{i}`,
  `rules/{i}/any/{j}`). Results resolve by request id (admission failures by
  path), combine with the captured native leaves, and dispatch only when every
  leaf of the oldest capture for that routine is complete (per-routine FIFO
  preserves dispatch order). Suppressed (depth-capped) frames count deferred
  actions and submit nothing; refresh/seed passes never execute or submit
  scripts and overlay captured pending statuses so a rebuild cannot clear an
  in-flight decision.
- Staleness: legacy owners register at `definition_revision = 0` and are
  re-registered on every owner sync, so any routine edit or reload bumps the
  generation and rejects in-flight leaves. `Event::RuleScriptLeafResult`
  (append-only `KIND_LABELS` index 16; `KIND_MUTATE` stays 11) carries the owner
  identity and rejects `owner_missing`/stale results without dispatch; leaf
  failures surface in the rule status as `script_worker_error` /
  `script_result_stale` / `script_contract_error`. Pool admission runs after
  `ensure_pool`, so a missing worker degrades to per-leaf visible errors without
  leaking coordinator tokens, and a capture that vanished before submission
  releases its admitted token.
- Gates S10–S12/S16 for v1 leaves: 6 new `routines.rs` unit tests (owner
  registration from v1 rows, native/script combination, nested `Any`
  combination, capture-time shared edge memory, reload rejection, refresh
  passivity) plus 2 actor-level `event.rs` tests through the real worker binary
  (off-actor execution with frozen dispatch, reload-before-result rejection)
  and a process-level `script_worker.rs` test for v1 truthiness/globals. Full
  suite: 432 lib + 18 script-worker + all prior suites pass; clippy clean for
  new code (also added the missing `too_many_arguments` allow on
  `spawn_handler_execution` that CI-style clippy flagged at HEAD).
- Known gap carried forward: while a v1 script leaf is pending, its routine
  status shows the provisional all-false placeholder (the resolved decision is
  visible after the leaf completes); declaration enforcement for v1 leaves is
  the capture-time snapshot, so S13 missing-entity wake-up remains open for the
  declarations/guards part.
- Measurement note: `tests/hurl/scene-cycling-mixed.hurl` is timing-flaky at
  HEAD (5/12 full-test failures when run repeatedly) independent of this change;
  the harness retries three times per run, so occasional full-suite retries are
  expected.

### P07 (part 2c) implemented: declaration enforcement and relevant guards

Commit: `feat(automation): track script declarations and broad reads`.

- `ScriptDeclaration::AllState` is the explicit broad compatibility
  declaration (S14 alternative): a script that opts in sees every device in the
  coherent frame (`before` + `after`) instead of an exact declaration-derived
  scope. Strict scripts keep undeclared devices absent, and the exposed set is
  still fixed per invocation from the current frame, so branch history can
  never widen or narrow it (S15).
- Script device/group declarations now tolerate entities that are not
  configured/discovered yet and register them as tracked dependencies
  (`CompiledDefinition.dependencies`) instead of failing compilation (S13).
  Until discovery the entity is simply absent from `ctx`; after discovery the
  next compile resolves it and the next frame exposes it, and v1 leaves fire
  once the device exists (scan-all wake-up). Typed trigger/condition/action
  references still reject unknown devices (`unknown_device`); only script
  declarations are forward-looking.
- Guards: an explicit S17 test proves a script plan's stale rejection is scoped
  to its captured target intents. An unrelated device/scene intent bump leaves
  the plan dispatchable; a bump on a planned target supersedes it. No global
  snapshot revision is consulted.
- Regenerated `ui/bindings`: `ScriptDeclaration.ts` gains `all_state`, and
  `Event.ts` now includes the part 2a/2b `RoutineScriptResult` and
  `RuleScriptLeafResult` variants (the earlier commits deliberately skipped
  binding regeneration; this closes that gap).
- Gates: 8 new unit tests (compile: forward declaration tracking, broad
  declaration, unknown-trigger rejection; `script_runtime`: broad frame
  exposure, branch-independent scope, missing-entity discovery; `routines`: v1
  missing-device wake; `plan`: relevant guards). Full suite: 440 lib + all
  prior suites pass; clippy (including CI `-D warnings`) clean.
- Deferred deliberately: worker-side read tracking (returning actual reads,
  failing undeclared reads strictly) requires the worker result ABI and is
  planned with the indexed subscription work (P11) and editor diagnostics
  (P12). `AllState` is the explicit compatibility escape hatch until then.

### P08 (part a) implemented: legacy scene materializer worker ABI

Commit: `feat(automation): add the legacy scene materializer worker API`.

- Worker protocol: `RequestKind::ExecuteLegacyScene` with its own
  `SUPPORTED_LEGACY_SCENE_API_VERSION`, so the v1 scene expression format, the
  v1 rule truthiness format, and the v2 function-body ABI can never be mixed.
  `engine::execute_legacy_scene_script` shares the exact legacy compatibility
  realm (scene helper prelude plus `devices`/`groups` globals) with legacy rule
  leaves, but returns the raw `JSON.stringify` completion like the retired
  `eval_json`; non-object completions and `undefined` stay raw/null, and the
  server keeps the legacy per-entry parsing and skip-on-invalid semantics
  instead of the strict v2 scene-materializer contract.
- Coordinator: `complete_legacy_scene` performs the same staleness checks
  (generation/revision/pending/superseded) without parsing the strict v2
  contract, so v1 scene results are gated but not reinterpreted.
- Runtime: `sync_owners` also reconciles scene owners, and
  `prepare_scene_materialization` admits `LatestWins` scene refreshes. `Scenes`
  now tracks per-scene script revisions derived from the source content,
  bumping only when the script actually changes (SC06 direction); the actor
  already passes them through `sync_script_owners`.
- Tests: engine worker-format tests (helpers/globals/raw JSON, v2 `return`
  rejection), a protocol version test, a coordinator-backed scene owner test
  (unchanged revision applies, edit rejects with `definition_changed`,
  removal drops the owner), a process-level worker test, and a scenes revision
  test. Full suite: 445 lib + 20 script-worker + all prior suites pass; clippy
  (including CI `-D warnings`) clean.
- Still open for P08 (next parts): `Scenes` still executes `ScriptEngine`
  in-process for activation, cycle detection, invalidation, startup, and
  reload. The next part replaces that with the last-good off-actor cache and
  result events, queues refreshes from invalidations, and surfaces
  stale/error materialization quality (SC01–SC05).

### P08 (part b) implemented: last-good scene materialization off actor

Commit: `feat(automation): materialize scene scripts off the actor`.

- `Scenes` no longer executes `ScriptEngine`: script evaluation is gone from
  `find_scene_devices_config`, which now merges the last-good per-scene
  overrides and keeps the legacy warn/skip semantics (invalid key, unknown
  device, activation filter) at the merge point. Per-scene state carries the
  revision, parsed overrides, and a `SceneScriptQuality`
  (`Fresh`/`Refreshing`/`Error`) for SC02.
- Invalidations (`invalidate`/`force_invalidate`/`apply_runtime_scenes`) queue
  `SceneMaterializationRequest`s built from the coherent frame
  (`legacy_rule_context`) and mark the scene `Refreshing`; activation and
  cycle detection never block on a worker and keep serving statics plus
  last-good output. First-ever activation before materialization is
  statics-only by design (chosen activation semantics).
- `Event::SceneMaterializedResult` carries the request identity; the handler
  completes through `complete_legacy_scene` (or `abandon` on worker failure),
  applies current revisions via `Scenes::apply_scene_script_result`, refreshes
  the affected target devices through `Devices::invalidate` (so devices
  already active in the scene update), and marks snapshot changes. Stale
  results are ignored; failures keep last-good and record the error on the
  scene. Admission failures (missing worker, coordinator rejection) record a
  visible scene error instead of stalling.
- `AppState::apply_runtime_scenes` now reconciles script owners as well, so
  runtime scene creation/edits register `OwnerKind::Scene` owners; without it
  admissions failed silently.
- Tests: scenes unit tests for queue/last-good/refresh/staleness/error
  quality and edit-drop behavior; the `config_api_integration` scene-script
  e2e now retries activation until the async materialization lands (its first
  activation legitimately gets statics only). Full suite: 447 lib + 35
  config-api + 20 script-worker + all else pass; the known hurl flake
  (`scene-cycling-mixed.hurl`) appeared once in three full runs; clippy clean
  apart from pre-existing warnings.

### P08 (part c) implemented: dependency gates and SC audit

Commit: `test(automation): gate scene materialization invalidation targets`.

- SC01 audit: no direct Boa/`ScriptEngine` execution is reachable from state
  actor commands. `scripting.rs` is now only used for `legacy_rule_context`
  and the worker prelude (`SCENE_SCRIPT_HELPERS`); the `ScriptEngine` value
  itself has no production caller and remains as characterization code for
  the migration oracle until P13/P17.
- SC03/SC05/SC06: `scene_invalidation_queues_only_dependent_scenes` proves a
  device/group dependency change queues a refresh only for the scenes whose
  scripts reference it, results refresh only that scene's target devices, and
  a result for one scene cannot leak into another scene's materialization.
  Revision gating (SC03) and last-good-on-error (SC02) remain covered by the
  part-b unit tests.
- SC02 surfacing: quality lives on `Scenes` (`scene_script_quality`) and
  failures warn while keeping last-good; exposing it in snapshots/API and the
  editor is P12 diagnostics work. SC04 (manual override / manually-off policy
  under source refresh) has no v1 scene analogue yet and is gated with the
  P11 source refresh policy.
- P08 is complete: startup, reload, activation, cycling, invalidation, and
  device discovery all materialize scene scripts off actor. Full suite: 448
  lib + 35 config-api + 20 script-worker + all else pass; clippy clean apart
  from pre-existing warnings.

### P09 (part a) implemented: clocks, owner-scoped session timers, wakeups

Commit: `feat(automation): schedule named timers off the actor`.

Design decisions recorded from plan-author review (2026-09-18):

- Timer ownership is owner-scoped: the logical key is
  `(routine_id, timer_id)` and the validity token is
  `(routine_id, definition_revision, timer_id, generation)`. `TimerId` is now
  documented as "within its owning routine, not globally unique". Two
  routines may each own an `"off"` timer; scheduling/replacing/cancelling one
  never affects the other, and `TimerFired` matches only the owning routine.
  Definition edits/disable/delete drop the previous revision's jobs via
  `TimerStore::retain_current`; the generation counter never resets, so an
  old queued wakeup can never become valid again. Run generations stay
  separate from timer generations (a new invocation does not cancel timers).
- `capture_target_intents` (J08/J09) stays P09b: it becomes an explicit
  `capture_target_intents: Option<TargetSpec>` on `ScheduleTimer`/`ReplaceTimer`
  (missing = None), resolved at planning, recorded at actor acceptance after
  earlier plan steps bumped intents, and enforced at expiry fail-closed
  (reject the guarded action, never expand an old group capture). No
  automatic inheritance of original plan guards.
- PredicateFor/freshness jobs stay P09b on the same wakeup driver with
  distinct job kinds (`NamedTimer`, `PredicateDeadline`, `FreshnessExpiry`,
  `ScheduleOccurrence`). Arming contract: false/unknown -> true starts a new
  interval from now; true -> true keeps the original deadline/generation;
  false/unknown/error cancels and invalidates; a matured episode is consumed
  once, even if the routine condition then blocks execution; freshness is
  evaluated before predicate maturity when they coincide.
- Calendar schedules stay P09b: keep the pinned `croner = 2.2.0` grammar
  (six fields `second minute hour day-of-month month day-of-week`, DOM/DOW-OR
  preserved, field-count mode configured explicitly) but do not reuse
  croner's calendar resolution for DST semantics; add `chrono-tz`, store an
  explicit IANA timezone, and make normalized policy part of the schema and
  fingerprints now (defaults: skip nonexistent spring-forward locals, run
  repeated fall-back locals once at the earlier occurrence, skip missed
  backlog, optional at most one coalesced catch-up with bounded lateness).
  Scheduler lateness and misfire/backlog are distinct, separately tested
  concerns. K05's in-process clock-movement behavior is P09; its durable
  restart/cursor guarantee is P10.
- Timer visibility stays P09b: `RuntimeSnapshot.timers` + `SnapshotChanges`
  projection (owner, revision, key, job identity/generation, status, deadline
  information, persistence/recovery policy; sampled remaining duration
  alongside the wall-clock estimate) plus an actor-routed generation-checked
  cancellation operation. P09a may omit these only while tracked here; P09 is
  not complete until jobs are visible.
- `ctx.now_ms` is frozen per coherent frame: the actor's injected
  `Arc<dyn Clock>` is sampled once in `flush_pending_frames` and threaded
  into script contexts; `ScriptExecution` no longer owns a clock function,
  and a relative timer's duration starts at actor acceptance. Worker
  watchdogs keep real operational monotonic time.
- Timer conflicts are structured and rejected before effects: `dispatch_v2_plan`
  validates the plan's timer operations against a staged store clone, and a
  conflicting required `ScheduleTimer` returns `accepted: false` with every
  step suppressed (`timer_already_pending` plus generation for the conflicting
  step, `plan_rejected` for the rest) and publishes no events. Ordered
  cancel-then-schedule in one plan is valid.

What P09a implements:

- `core/clock.rs`: `Clock` (wall + monotonic), `SystemClock`, `ManualClock`.
- `core/automation/timers.rs`: owner-scoped `TimerStore` with apply/
  consume/retain/wakeups, bounded delay and per-owner jobs, generation
  fencing, `TimerOperation`/`TimerOperationError`/`TimerFire`/`TimerWakeup`.
- `core/scheduler.rs`: rebuildable wakeup-heap driver (`SchedulerHandle`)
  that emits `Event::TimerWakeup`; the actor republishes the authoritative
  pending set after every command. Duplicate/lost wakeups re-validate.
- `Event::RoutineTimerOperation` (with definition revision) and
  `Event::TimerWakeup`; metrics indices 18/19; `FrameContext.fired_timers`
  and the `TimerFired` evaluator arm; planner emits
  `PlannedStepBody::TimerOperation`; generated bindings updated
  (`TimerOperation.ts`, `Event.ts`, `TimerId.ts`).
- Tests: timers store (replace/cancel/idempotence, per-owner isolation,
  monotonic vs wall, bounds, revision retention), scheduler driver
  (paused-time, emit-once), evaluator/actor (`p09_named_timer_fires...`,
  `p09_timer_conflicts_reject_the_plan_before_effects`), plan
  `timer_actions_plan_as_timer_operations`.
- Full suite: 460 lib + 35 config-api + 20 script-worker + all else pass;
  clippy clean apart from pre-existing warnings.

Still open for P09 (P09b gates, tracked separately):

- J05/J06 with sustained-predicate and freshness jobs, C09 together.
- J08/J09 intent capture schema, planning, acceptance, and fail-closed
  enforcement; until then capture requests are unsupported and the
  manual-override-safe motion preset is not complete.
- Timer snapshot projection, per-trigger status (armed/deadline/error), and
  actor-routed cancellation API.
- K01–K06 calendar policy, timezone handling, previews, and misfire vs
  lateness tests; K05 durable portion waits for P10.
- Ambient JS time/random nondeterminism policy (Section 6.1) is still
  unaddressed in the worker engine.

### P09 (part b1) implemented: actor-routed, generation-checked cancellation

Commit: `feat(automation): add actor-routed timer cancellation`.

- `TimerStore::cancel_checked` / `pending_generation` and `TimerCancellation`
  (`Cancelled { generation }` / `NoOp` / `GenerationMismatch`). Administrative
  cancellation is explicitly addressed and idempotent; a mismatched expected
  generation removes nothing. Ordinary timer actions and triggers remain
  owner-scoped.
- `AppState::cancel_timer` applies the check inside the actor, and
  `StateHandle::cancel_timer` routes through the existing mutate command so
  the generation check is authoritative (no new command kind or HTTP surface).
- Tests: `p09_admin_cancellation_is_generation_checked` and
  `p09_actor_routed_cancellation_reaches_the_authoritative_store`. Full suite:
  462 lib + all else pass; clippy clean apart from pre-existing warnings.
- Still open for P09b: `RuntimeSnapshot.timers` projection and per-trigger
  status; sustained-predicate/freshness jobs (J05/J06/C09); intent capture
  (J08/J09); calendar policy and previews (K01–K06); ambient JS determinism.

### P09 (part b2) implemented: live timer status in the runtime snapshot

Commit: `feat(automation): publish live timer status in the runtime snapshot`.

- `TimerRuntimeStatus` (`routine_id`, `definition_revision`, `timer`,
  `generation`, `status`, `due_wall_ms`, sampled `remaining_ms`,
  `persistence`) plus `TimerJobStatus`/`TimerPersistence` bindings.
- `SnapshotChanges.timers` and `RuntimeSnapshot.timers` are wired through
  `publish_snapshot`; timer operation and wakeup events mark the flag, so
  lifecycle changes (create/replace/cancel/consume) republish the projection
  while `remaining_ms` stays a publish-time sample, not a ticking countdown.
- Websocket `StateUpdate`/`StatePatch` payload fields are deliberately not
  added yet; timer-only changes therefore do not emit a WS broadcast. UI
  consumption remains P12.
- Tests: `p09_timer_projection_publishes_lifecycle_changes`. Full suite: 466
  lib + all else pass (one known hurl flake, green on retry); clippy clean
  apart from pre-existing warnings.

### P09 (part b3) implemented: predicate deadline jobs in the timer store

Commit: `feat(automation): add predicate deadline jobs to the timer store`.

- Wakeups now carry a `TimerWakeupJob` (`NamedTimer`, `PredicateDeadline`)
  through the store, scheduler, and `Event::TimerWakeup`, so both kinds share
  the driver with distinct kinds (decision 3).
- `TimerStore` gained `ensure_predicate` (idempotent per episode so keeping a
  live job never churns generations), `cancel_predicate` (idempotent),
  `pending_predicate_generation`, and generation/revision-checked
  `consume_predicate`. Predicate jobs stay out of the named
  `RuntimeSnapshot.timers` projection and are dropped by `retain_current` on
  routine edits.
- The actor validates predicate wakeups into `AppState.pending_predicate_fires`
  for the next coherent frame.
- Tests: store arming/generation/cancel/retention and wakeup routing. Wiring
  into `predicate_for` trigger evaluation and the arming contract is the next
  slice (J05/J06 proper).

### P09 (part b4) implemented: sustained-predicate arming contract (J05/J06)

Commit: `feat(automation): arm sustained predicates from trigger frames`.

- `predicate_for` now arms a server-owned deadline job instead of staying
  inert. The arming contract is implemented as decided: seeded true does not
  arm; false/unknown -> true arms from now; true -> true keeps the live
  generation; false/unknown/error cancels and invalidates the episode;
  maturity fires once and stays latched until the predicate leaves true, even
  when the routine condition then blocks.
- Evaluation returns `PredicateJobIntent::{Arm, Cancel}` per routine;
  `flush_pending_frames` applies them to the authoritative store after the
  coherent frame (Arm idempotent per episode, Cancel idempotent). Predicate
  fires drive the same frame pipeline: new `FrameContext.predicate_fires`
  taken/restored like named timer fires so warming-up cannot drop them.
- At expiry the actor consumes the job generation-checked and the predicate is
  re-evaluated against the frame's current after-view, so expiry uses current
  state, not the captured episode (J05), and a replaced/canceled/edited episode
  can never mature (J06).
- Tests: `p09_predicate_for_arms_cancels_and_rearms`,
  `p09_predicate_expiry_rechecks_state_and_latches`. Full suite: 472 lib + all
  else pass (known hurl timing flakes, green when rerun); clippy clean apart
  from pre-existing warnings. C09 freshness expiry remains the next slice
  (needs per-source `max_age_ms`).

### P09 (part b5) implemented: captured target intents (J08)

Commit: `feat(automation): capture target intents for scheduled timers`.

- New schema: `capture_target_intents: Option<TargetSpec>` on
  `schedule_timer`/`replace_timer`, carried as `TimerIntentCapture` /
  `TimerIntentTarget` (bindings regenerated).
- `Event::RoutineTimerOperation` gained `capture`; the acceptance handler
  freezes tokens from the live `IntentTracker` after earlier plan steps were
  queued, and `TimerStore` keeps them with the generation. `TimerFire` carries
  them into the expiry frame, and the planner's `capture_guard` uses a frozen
  token for captured device targets instead of the live revision, so a newer
  manual intent suppresses the delayed action at dispatch (fail-closed).
- J09 group capture still needs frozen membership, so the compiler rejects
  group captures with `capture_group_intents_unsupported` (and empty specs with
  `invalid_capture_targets`); `plan_timer_capture` double-checks and suppresses
  defensively. That rejection comes out when the J09 freezing slice lands.
- C09 freshness expiry was deferred by decision (no per-source `max_age_ms`
  home in the v2 model yet; slot it alongside P11 computed sources or a later
  P09 slice).
- Tests: `p09_captured_target_intents_suppress_superseded_delayed_actions`
  (untouched capture runs, superseded capture is suppressed), compile rejection
  for group capture. Full suite: 475 lib + all else pass (known hurl timing
  flake, green on rerun); clippy clean apart from pre-existing warnings.

### P09 (part b6) implemented: frozen group membership for captures (J09)

Commit: `feat(automation): freeze group membership for captured intents`.

- `TimerIntentCapture` now carries `frozen_members` (per-group member devices
  resolved at plan time from the group's recursively flattened configured
  refs) and `TimerIntentTarget` gained a `Group` variant. Capture tokens cover
  the group and every frozen member device, so a later manual group or device
  command suppresses the delayed action.
- At expiry the planner replaces a captured group with the intersection of its
  current members and the frozen set, and removes the group from the emitted
  descriptor, so members added after the capture never receive the delayed
  action (`restrict_frozen_groups` in `plan.rs`). Uncapped groups are
  untouched.
- Compile validates capture devices/groups via the usual `resolve_device` /
  `resolve_group` paths (unknown targets and group cycles surface normally,
  references join the dependency inventory); the temporary
  `capture_group_intents_unsupported` rejection is gone.
- Tests: `captured_group_members_are_frozen_against_new_members` (new member
  excluded, group token freeze suppresses) and the updated compile test
  (group capture compiles, empty capture rejected). Full suite: 477 lib + all
  else pass; clippy clean apart from pre-existing warnings.

### P09 (part b7) implemented: calendar grammar and policy schema (K01/K02)

Commit: `feat(automation): validate calendar grammar and backlog policy`.

- `chrono-tz` added (pinned `=0.10.4`) and schedule timezones now resolve to
  IANA zones (or fixed offsets), so stored definitions carry a stable zone.
- Cron parsing configures `with_seconds_required()` explicitly: the pinned
  croner 2.2.0 grammar stays six-field (`second minute hour dom month dow`,
  DOM/DOW-OR untouched) and croner is never used for DST/occurrence
  resolution (that stays our own civil-time generation in the next slice).
- `ScheduleSpec` gained `backlog` (`skip` default, `catch_up_once`) and
  `catch_up_lateness_ms`; compile requires a bounded lateness in
  `1..=MAX_TIMER_DELAY_MS` for catch-up, rejects lateness without the policy,
  rejects calendar policy on `every_ms` schedules, and the fields are part of
  the normalized definition/fingerprint. DST defaults stay documented as
  fixed behavior for now: skip nonexistent spring-forward locals, run repeated
  fall-back locals once at the earlier occurrence.
- Tests: `k01_calendar_grammar_and_policy_are_validated`. Full suite: 479 lib
  + all else pass; clippy clean apart from pre-existing warnings.
- Remaining K work: schedule occurrence jobs on the wakeup driver (in-process
  clock/lateness for P09, durable cursor for P10), previews sharing the live
  policy, misfire vs lateness tests.

### P09 (part b8) implemented: civil-time occurrence generation (K02–K04)

Commit: `feat(automation): generate civil-time schedule occurrences`.

- New `core/automation/calendar.rs`: croner parses the pinned six-field
  grammar and iterates civil candidates as UTC-labeled instants (no timezone
  resolution inside croner), then each candidate resolves in the stored IANA
  zone via chrono-tz under the fixed DST policy — nonexistent spring-forward
  locals are skipped and repeated fall-back locals run once at the earlier
  instant. Next-occurrence lookup is strictly after the reference instant and
  bounded, with a doc comment stating the candidate/resolution split.
- Tests: spring-forward skip (Helsinki 2026-03-29 03:30), fall-back
  once-at-earlier plus no duplicate for the later instant, zone independence
  (Helsinki vs New York), six-field requirement, bad grammar errors.
- Not yet wired: schedule occurrence jobs on the wakeup driver, rearm after
  fire, lateness vs backlog handling, previews, and the durable cursor (P10).

### P09 (part b9a) implemented: schedule occurrence jobs in the store

Commit: `feat(automation): add schedule occurrence jobs to the timer store`.

- `TimerWakeupJob::ScheduleOccurrence { trigger }` added to the shared wakeup
  pipeline (driver keys stay owner + job, so schedule occurrences ride the
  same rebuildable index).
- `TimerStore`: `ensure_schedule` (idempotent per revision, no generation
  churn), `cancel_schedule` (idempotent), `pending_schedule_generation`,
  `consume_schedule` (revision + generation checked) returning
  `ScheduleOccurrenceFire`; schedule jobs stay out of the named snapshot
  projection and drop on edit via `retain_current`.
- `insert` was split into `insert_job` so calendar occurrences can exceed the
  named-timer delay bound (weekly-or-longer crons are legitimate).
- Actor routing: `Event::TimerWakeup` consumes `ScheduleOccurrence` fires into
  `AppState.pending_schedule_fires` (TS binding `TimerWakeupJob.ts` updated).
- Tests: arm/consume/rearm/limit-free projection, stale-revision rejection,
  actor-level stale vs current generation routing.
- Not yet wired: evaluation arm for `schedule` triggers, rearm after a
  coherent frame, initial arming on runtime apply, lateness vs backlog,
  previews.

### P09 (part b9b) implemented: schedule occurrences fire and rearm

Commit: `feat(automation): fire calendar schedules from the wakeup driver`.

- `FrameContext.schedule_fires` added; `TriggerSpec::Schedule` now fires when
  the coherent frame carries a validated occurrence for that routine/trigger
  (truth `true`, unknown otherwise).
- `AppState::arm_schedules` arms the next occurrence of every compiled
  schedule trigger and is idempotent per revision: intervals rearm
  monotonic-relative, calendar occurrences resolve through the civil-time
  generator in the stored zone (`schedule_due`), fixed offsets included.
  It runs on runtime apply, after each consumed wakeup (so a dropped
  occurrence never stalls the schedule), and after a schedule-bearing frame.
- Backlog/lateness policy applied at consume time
  (`AppState::schedule_spec` + `schedule_within_lateness`): `skip` always runs
  the emitted occurrence (lateness is not backlog), `catch_up_once` drops an
  occurrence beyond its bounded lateness; both paths rearm from the current
  time so missed occurrences are skipped, not replayed.
- Tests: interval/cron arming and rearm through the actor, stale-generation
  routing, late catch-up drop with rearm, zone resolution and lateness policy
  unit tests.
- Still open for P09: next-occurrence/preview consumption by the editor (P12),
  per-trigger armed/deadline status in the snapshot, and the durable cursor
  (P10).

### P09 (part b11) implemented: per-trigger armed/deadline status

Commit: `feat(automation): expose armed trigger deadlines in routine status`.

- `TriggerRuntimeStatus` gained `armed` and optional `due_wall_ms`
  (backward-compatible serde defaults; binding regenerated). Evaluation still
  reports frame outcomes; `AppState::annotate_trigger_arms` projects the
  authoritative store's live `predicate_for`/schedule jobs into the v2
  statuses before the snapshot projection is rebuilt, so a trigger without a
  live job reports unarmed.
- The schedule wakeup handler refreshes statuses after rearming, so a
  consumed/dropped occurrence updates its deadline without waiting for the
  next device frame. Actor test additionally asserts the snapshot reports the
  armed schedule and its occurrence instant.
- P09 is now complete for in-process scheduling: J01–J09, K01–K06
  (in-process portions), per-trigger status, and cancellation are done;
  preview consumption is P12 and the durable cursor/claims are P10.

### P09 (part b10) implemented: zero-delay timers are queued events (J04)

Commit: `feat(automation): allow zero-delay timers as queued events`.

- Compile validation accepts `delay_ms == 0` for `schedule_timer`/
  `replace_timer` (bound is now `0..=MAX_TIMER_DELAY_MS`); the delay still
  enters the store as a job due at the current instant and fires through the
  shared wakeup driver, so a zero delay queues a later event and never runs
  inline. Tests: compile accepts zero and rejects above the bound; store
  queues the job at the exact current monotonic/wall instant.
- Ambient JS determinism was already implemented and proven by S11
  (`s11_clock_randomness_and_context_are_deterministic_and_frozen`): frozen
  `ctx`, `api.now`/`Date.now`/zero-argument `new Date` pinned to `ctx.now_ms`
  and seeded `Math.random`/`api.random` replay across fresh realms. The older
  "still open" note is resolved.

### P10 implemented: best-effort durable named timers

Commit: `feat(automation): persist named timers across restarts`.

- New `automation_timer_jobs` table (migration
  `M20260921000000AutomationTimerJobs`): primary key `(routine_id, timer_id)`
  plus `definition_revision`, `generation`, `due_wall_ms`, and the serialized
  `TimerIntentCapture` spec. Deliberately not part of `ConfigExport`: timer
  jobs are runtime state, and a config import clears the table so previously
  acknowledged jobs can never resume (M18 intent without the manifest
  machinery).
- Write-through rides the existing deferred persistence lane
  (`DeferredEventWork::PersistTimerJob` / `DeleteTimerJob`): schedule and
  replace upsert the row, cancel and consumed wakeups delete it, and a
  definition edit deletes rows for the jobs `retain_current` dropped. Admin
  cancellation through `StateHandle::cancel_timer` also queues its delete
  (`AppState.pending_deferred_work`, drained by the actor after every command).
  The database being unavailable logs and keeps session behavior; nothing
  blocks or fails the actor.
- Startup (`restore_startup_timers` in `main.rs`): future-due rows for the
  current definition revision are restored with their persisted generation
  (the store's counter advances past it, so later generations cannot collide)
  and the monotonic deadline reconstructed from the stored UTC deadline;
  past-due rows are logged, dropped, and deleted; stale revisions are dropped;
  captures are re-frozen against the live intent tracker because stored tokens
  are process-local revisions. Schedule occurrences are not persisted — they
  re-arm from `now` (`arm_schedules_at_startup` logs the count) — and
  sustained predicates are not persisted; `log_predicate_recovery` makes the
  re-evaluation visible.
- The actor publishes startup wakeups to the scheduler driver before its first
  command, so a restored deadline cannot wait for unrelated traffic, and the
  startup snapshot republishes the timer projection.
- `TimerPersistence::Durable` is projected while a database is connected
  (`TimerStore::runtime_statuses(now, durable)`); `session` otherwise. Binding
  regenerated (`TimerPersistence.ts`).
- Tests: store restore/deadline/generation/bounds/limit-free projection;
  DB upsert/delete/import-clears round trip (asserting the export format has
  no `timer_jobs` key); four actor-level tests (write-through on
  schedule/replace, consume and admin-cancel deletes, edit drops rows, startup
  restore keeps future/drops past-due and stale); and a REST integration test
  that schedules a real timer through the API, restarts the SQLite-backed
  server (row survives, no double fire), disables the routine, and restarts
  again (row stays gone). Full suite: 500 lib + all integration suites pass;
  clippy clean apart from pre-existing warnings. `ui/tsc` has one pre-existing
  unrelated failure at HEAD (`CarHeaterModal.tsx`).
- Deliberately absent per the thin P10 decision: transactional job/state
  coupling, claim/CAS, interrupted-state protocol, export/checkpoint
  participation, exactly-once language. Dropped gates: J12–J15, J17,
  M04–M06. Retained thin gates J10/J11/J16 are covered by the restart,
  past-due-drop, and no-resurrection tests.

### P12 first deliverable implemented: floorplan device → edit device state in scene

Commit: `feat(ui): edit a device's state in a scene from the floorplan dialog`.

- Every `SceneList` entry (floorplan inspector, room pages, dashboard) now has
  an "Edit in scene settings" pencil that navigates to
  `/config/scenes?scene=<sceneId>&device=<deviceKey>`; the device key is only
  included when the list is scoped to exactly one device. From the floorplan
  device dialog the link also closes the dialog first.
- The scenes page consumes the deep link once per navigation (`location.key`
  guard): it clears a conflicting search filter, expands the scene card,
  opens the editor on the Devices tab, and highlights + scrolls the matching
  target editor for 2.5s (`focusTargetKey`/`focusNonce` on
  `SceneTargetSectionEditor`). If the device is not yet a target it is added
  to the draft with a notice that saving keeps it; cancel discards.
- Fixed a pre-existing `ui/tsc` failure: `CarHeaterModal.tsx` sent
  `SetInternalState` without the `origin`/`causation`/`integration_epoch`
  fields added to the binding earlier in this branch.
- Verified with `pnpm tsc`, `pnpm lint`, `pnpm build` (all green).

### Constraints update (user decision): thin P10, simple migration, UX-first UI, live work allowed

- **P10 is thin** (see the rewritten P10 section): only named timers survive
  restarts, best-effort; schedules re-arm from `now`, predicates re-evaluate;
  cancel/replace survive; no claim/CAS/transaction/interrupted-state layer.
- **Migration stays simple**: v1 rows keep running as long as convenient (that
  is free — the loader already dispatches them). Routines move to v2 via the
  small one-time converter (dry-run report, offline `--apply`, JSON archive)
  or by manual authoring. Retired integration wrappers are deleted only when
  nothing references them. No manifests, ledgers, or cohorts.
- **UI is a first-class goal now.** The current settings UI is largely a
  TOML-shaped form dump. New UI work should be situation-driven: start from
  what the user is looking at (a device on the floorplan, a room, a scene)
  and put the relevant edit within reach. First concrete deliverable: from
  the floorplan device dialog, edit that device's state in a scene directly
  or via a link to the scene editor. Treat P12 as ongoing UX work rather
  than a fixed gate list.
- **Live instance, config, database, and deployment may be modified** during
  this work (user lifted the earlier restriction; it is daytime). Mandatory
  safety net before any live config/database change: create a backup
  (config export and, where applicable, `pg_dump`) and keep a tested restore
  path, so the system is always revertible while the user is away. Never
  leave the running instance broken; deploy only after local tests pass.

### Plan change (user decision): P13–P15 migration machinery cut; offline one-time converter

Decision (user, this session): do not build the P13–P15 migration subsystem
(shared effect sink covering every category, differential comparison,
migration manifests, approval ledger, epoch/cohort cutover and rollback
tooling). The complexity is out of proportion to a single-operator home system.

Kept:
- `core/simulate.rs` and `--simulate`/`--source-db` stay as-is: running the
  server against a mirrored config with dummy integrations is the safe way to
  validate a conversion before applying it.
- Trace/status work already delivered by P05/P07 (X02/X03/X05) stays.
- Reference inventory and the strict compiler stay the single conversion
  authority (V07); a converter must call `compile_row`/`compile_definition`
  and never duplicate traversal.

Replaced by: an offline one-time conversion script (new bin or CLI subcommand):
- Dry-run by default: reads the live DB (or an export), converts legacy v1
  routine rows and cron/timer integration configuration into v2 definitions
  through the existing compiler/normalizer, and prints a per-row report
  (converted / needs manual authoring / unsupported with reason).
- `--apply` runs only with the server stopped, requires a clean report or an
  explicit `--force`, writes all rows in one transaction, and first dumps the
  pre-conversion rows to a JSON archive.
- Rollback is restoring the archive; the server restarts with v2 only.
  Because the cutover is offline there are no dual emitters, epochs, cohorts,
  or approval ledgers to track.
- Old backups are converted by the same script or fail with the explicit
  per-row report; nothing silently ignores retired wrappers (M18 behavior
  without the manifest machinery).

Dropped gates: P13's X06/X07, M07–M09; P14's M10–M13; P15's M14–M18.
P10 (J10–J17, M04–M06) stays but stays thin: restart survival and
no-resurrection of acknowledged cancels for jobs that actually need
durability; defer export/checkpoint participation and partial-failure claim
CAS until a measured need exists.

### Security fix implemented: cross-origin requests are restricted (origin guard)

Commit: `fix(api): restrict cross-origin requests to allowed origins`.

- Finding: the API wrapped every route in `warp::cors().allow_any_origin()`.
  `warp::cors()` already allows any origin unless an allowlist is configured,
  so the entire API was readable and callable from any web page in a browser
  on the network: `GET /api/v1/config/export` (widget secrets such as the
  InfluxDB token and private calendar URL), `POST /api/v1/config/import`
  (rewrites all runtime config), every device/scene write, and cross-site
  websocket handshakes. homectl has no authentication at all.
- Fix: `server/src/api/origin.rs` classifies every request before any route
  handler runs. Requests without `Origin` (curl, CLI, health probes,
  same-origin GETs) pass through. Requests with `Origin` are allowed when the
  origin authority matches the request `Host` (the bundled same-origin UI),
  when the origin is a loopback host (local development), or when the origin
  is listed in `HOMECTL_ALLOWED_ORIGINS` (comma separated). Disallowed origins
  get `403` before handlers run, with no CORS headers; allowed preflights get
  `204` with `Access-Control-Allow-*`; allowed cross-origin responses echo
  `Access-Control-Allow-Origin` plus `Vary: Origin`. The guard wraps the whole
  route set, so it also blocks cross-site websocket handshakes.
- Tests: eight unit tests for the policy (same-authority, default-port and
  trailing-slash normalization, loopback, explicit list, `null` origin, denied
  and preflight responses) plus two integration tests that spawn a real server
  and drive `HOMECTL_ALLOWED_ORIGINS` through the new `extra_env` knob in
  `TestServerConfig`: foreign GET/POST/preflight rejected, same-origin (Host
  override), loopback, and configured origins accepted. clippy clean apart
  from pre-existing warnings. Full suite green apart from the pre-existing
  flaky `scene-cycling-mixed.hurl`, verified failing identically at HEAD.
- Known limitation (documented in the module): the same-host comparison trusts
  the `Host` header, so DNS rebinding could still present a matching pair.
  homectl trusts the local network; a configured host allowlist is the
  follow-up if that threat matters.
### Security follow-up implemented: secrets stay out of responses and default exports

Commit: `fix(api): keep config secrets out of responses and default exports`.

- `GET /api/config` no longer returns `influx_token` / `calendar_ics_url`
  (the UI never read them; per-widget values come from widget settings).
- `GET /api/v1/config/core` returns the same payload minus the secrets;
  `PUT /api/v1/config/core` keeps accepting `influx_token` /
  `calendar_ics_url` as write-only patch fields that update
  `widget_settings` (omitted = preserve, `""` = clear).
- `GET /api/v1/config/export` drops secret `widget_settings` fields
  (`influxdb.token`, `calendar.icsUrl`) unless `?include_secrets=true`
  asks for a restorable backup. `POST /api/v1/config/import` restores
  stored values for secret fields missing from the incoming file, so
  re-importing a redacted export does not wipe tokens; an explicit value
  (including `""`) still wins.
- UI: the import/export page has an "Include secrets" checkbox (off by
  default); `useConfigExport().exportConfig(includeSecrets)` passes the
  query flag; unused `influxToken` / `calendarIcsUrl` fields removed from
  the app config types and normalizer.
- Ops: `~/backups/homectl/README.md` now exports with
  `?include_secrets=true` so documented backups stay restorable.
- Tests: four unit tests (redaction drops only secret fields, round-trip
  preserves stored secrets, explicit values win, removed rows stay
  removed) and one integration test that writes secrets through the core
  patch, checks `/api/config` + core responses, default-export redaction,
  `include_secrets=true`, import preservation, and explicit clearing.
  512 lib + 39 config_api_integration green; full suite green apart from
  the pre-existing flaky `scene-cycling-mixed.hurl` (passes on retry).
- Remaining secret surfaces: per-dashboard-widget credentials
  (`sensors.influxToken`, `train_schedule.trainApiUrl` in
  `dashboard_widgets.config`, which the direct-query widget feature needs in
  the browser) and integration plugin credentials (e.g. mqtt
  `username`/`password` in `integrations[].config`). **Resolved by user
  decision:** plaintext browser exposure is accepted under the trust model
  (any client that can reach the API can already control the house, and there
  is no authentication); storage stays plaintext DB columns, widget-export
  redaction and the `?include_secrets=true` opt-in remain as-is, and no
  server-side query proxy is built.

### P12 second deliverable implemented: live trigger and timer status on routines

Commit: `feat(ui): show live v2 trigger and timer status on routines`.

- Server: `StateUpdate`/`StatePatch` now carry `timers` (live named timer
  jobs), and `has_websocket_changes` plus patch building include the
  existing `SnapshotChanges.timers` flag, so timer lifecycle changes reach
  browsers without polling. `TimerRuntimeStatus`, `TimerJobStatus`, and
  `TimerPersistence` gained `Deserialize` so the websocket message types
  round-trip; bindings regenerated (`StateUpdate`, `StatePatch`).
- UI: `useTimers()` reads the new websocket payload. The routine card view
  renders a `RoutineRuntimePanel`:
  - v2 routines: each native trigger with kind, a human label resolved
    from `definition_v2` (cron/interval schedules, predicate hold
    duration, device report / state change with display names), status
    badge (fired / armed / ready / waiting / unknown / error), next fire
    time for armed triggers (relative plus local clock, 15s tick),
    unknown reasons and errors; condition state and last-run summary;
    collapsible raw native definition.
  - named timers owned by the routine: persistence badge and due time.
  - v2 cards show a `v2` badge and trigger/armed counts instead of the
    empty legacy rule/action counts; the legacy rule/action lists are
    hidden for v2 rows.
- Tests: two unit tests assert timers appear in the full state and in
  timer-only patches and stay absent from unrelated patches. 514 lib tests
  green; full suite green apart from the pre-existing flaky
  `scene-cycling-mixed.hurl` (timing race: asserts device state immediately
  after a PUT; passed on retry).
- Follow-up commit `f314c4ad feat(ui): explain v2 conditions with the
  server trace`: the panel renders `v2.condition.trace` as a collapsed tree
  with per-node truth, group counts/reasons, and unknown explanations, so a
  non-true condition shows which node failed. This consumes the evaluator's
  own trace instead of reimplementing evaluation in the UI (P12 step).
- Still open for the full P12 editor: native v2 definition editing (the
  visual RuleBuilder/ActionBuilder still edits legacy rules/actions, so v2
  rows are view-only apart from name/enabled), next-occurrence preview
  inside the editor form itself, and the secret surfaces noted above.

### Fix implemented: v2 trigger rows and live arms publish before the first frame

Commit: `fix(automation): publish v2 trigger rows before the first frame`.

Found while end-to-end testing the trigger editor: after a routine save the
published status carried an empty `triggers` list (and no armed deadlines)
until the next device frame, because `refresh_statuses` inserted a
placeholder status when none existed and `annotate_trigger_arms` ran before
those rows existed. For a schedule-only routine that meant no visible status
until it fired, possibly hours later.

- `display_trigger_statuses` builds display-only rows for a routine that has
  not evaluated a frame yet: predicates evaluate against the current view and
  state-change truth comes from seeded transition memory, without writing
  memory or emitting jobs (V05/X01).
- `Rules::refresh_runtime_statuses` now takes the live wakeup arms map and
  annotates after the rows are inserted but before the published projection
  is rebuilt, so a freshly saved routine reports armed schedules and
  predicate deadlines in the same publish.
- State keeps `timer_wakeup_arms()` (shared by `annotate_trigger_arms`) and
  passes the map through `refresh_routine_statuses`.
- Tests: `status_refresh_does_not_touch_memory` now also asserts the display
  rows (kind, truth from seeded memory, unarmed); new
  `v2_status_refresh_populates_trigger_rows_and_arms` asserts a schedule row
  is armed with its due time in the same projection. 515 lib tests green.
  Full suite green apart from the pre-existing flaky
  `scene-cycling-mixed.hurl` (timing race; confirmed failing on unmodified
  code too in this environment).

### P12 visual v2 trigger editor implemented: native triggers are editable

Commit: `feat(ui): edit native v2 routine triggers`.

- New `ui/ui/TriggerBuilder.tsx` edits `definition_v2.triggers` in place for
  all eight kinds: report and state_change (device via `DeviceSelect`, mode),
  predicate_transition and predicate_for (flat predicate editor: device
  comparison with path datalist plus operator and typed value, or group
  condition with quantifier/power/scene; nested/advanced predicates are shown
  read-only with a replace action), schedule (calendar cron / fixed interval,
  timezone, backlog policy, catch-up lateness), timer_fired, startup, manual.
  Triggers get stable auto ids (`<kind>_<n>`) with a duplicate-id warning;
  each row shows the live status badge and next fire time from
  `v2.triggers` when present.
- `Routine.definition_v2` is retyped to the raw-preserving
  `RoutineDefinitionV2Body` (`triggers?: TriggerSpec[]` plus opaque
  condition/program/execution) so editing triggers never round-trips
  untouched parts through the strict binding.
- `ui/ui/routine-runtime.tsx` exports `StatusBadge`, `formatDue`,
  `formatUnknownReason`, and `triggerBadge` for reuse in the editor.
- Routines page: v2 rows get Basics | Triggers | Definition (JSON) tabs
  (legacy Actions tab hidden), the JSON tab edits the raw native definition,
  and the save handler sends `semantics_version: 2` with the edited
  `definition_v2` while preserving stored `rules`/`actions` for v1
  compatibility.
- Verified end-to-end against a local server: the exact payload shape the
  editor sends is accepted by POST/PUT (device comparison predicate, interval
  and cron schedules), renames and trigger edits round-trip with the revision
  advancing, and the websocket shows trigger rows immediately (armed cron
  with next due time; predicate deadline arms after the next frame). Note:
  the server rejects a native program with no steps ("A native program must
  contain at least one action"); the editor preserves the existing program,
  so this only affects hand-written JSON.
- Still open for P12: condition and program (action) editors, next-occurrence
  preview inside the form, and creating new routines directly as v2.

### P12 native program editor implemented: v2 action steps are editable

Commit: `feat(ui): edit native v2 routine programs`.

- New `ui/ui/ProgramBuilder.tsx` edits `definition_v2.program` in place for
  all nine native actions: activate_scene (fixed scene or a replace action
  for dynamic `select`, target override), set_power, dim (relative step,
  optional transition, device/group targets), schedule_timer and
  replace_timer (timer name, delay, optional captured target intents),
  cancel_timer, set_helper (value editor follows the helper kind: boolean,
  number, enum options, string; raw JSON when the helper is unknown),
  invoke_routine (routine plus fire-and-forget/await mode), and choose
  (branches are shown read-only with condition and step summaries until the
  condition editor lands). Steps can be added, retyped, renamed, reordered,
  and removed; IDs are auto-generated and duplicate detection covers nested
  choose branch steps too.
- Shared inputs moved to `ui/ui/builder-fields.tsx` (`selectClassName`,
  `DurationInput` and its unit guessing) so the trigger and program editors
  use the same controls; TriggerBuilder now imports them.
- `useHelpers()` lists helper definitions from `/api/v1/config/helpers` for
  the set_helper step.
- Routines page: v2 rows get a Program tab (Basics | Triggers | Program |
  Definition); the JSON tab description now points at the remaining
  JSON-only parts (conditions, script programs, choose branches).
- Verified against a local server: a multi-step program using every action
  kind (including a choose branch with a nested step) compiles and
  round-trips; the server rejects `capture_target_intents` with no targets,
  which the editor now warns about before saving. UI tsc/lint/build green.
- Still open for P12: condition editor (next), choose branch editing, script
  program bodies, next-occurrence preview, and create-as-v2.

### P12 native condition editor implemented: nested conditions are editable

Commit: `feat(ui): edit native v2 routine conditions`.

- New `ui/ui/ConditionBuilder.tsx`: recursive `ConditionEditor` for all six
  expression kinds (literal, comparison, group, all, any, not) with
  arbitrary nesting; comparison sources cover device paths (with the sensor
  and controllable path suggestions), helpers, and computed sources, plus
  the operator and typed value editor; group checks expose quantifier,
  power, and scene. Empty all/any groups are flagged inline (the server
  rejects them), and `describeCondition` renders readable one-line
  summaries used by the program editor. Shared `ConditionDatalists` keeps
  the path suggestion datalists in one place.
- TriggerBuilder's predicate_transition and predicate_for triggers now use
  the full recursive editor, replacing the flat editor and the read-only
  "advanced predicate" fallback, so nested predicates are editable in
  place. TriggerBuilder gains a `helpers` prop for helper sources.
- ProgramBuilder choose steps are now fully editable: each branch has an
  id, a nested ConditionEditor, and a recursive step list with add, remove,
  and reorder; branches can be added and removed. This closes the choose
  gap noted in the program editor entry.
- Routines page: v2 rows get a Condition tab (Basics | Triggers |
  Condition | Program | Definition).
- Verified against a local server: a nested all/any/not condition with
  device and helper comparisons compiles and round-trips, an empty all/any
  group is rejected with the same message the editor warns about, and the
  websocket status reports the nested condition truth. UI tsc/lint/build
  green.
- Still open for P12: script program bodies, next-occurrence preview, and
  create-as-v2.

### P12 create-as-v2 implemented: the add-routine modal creates native v2 routines

Commit: `feat(ui): create new routines as native v2`.

- `CreateRoutineModal` gains a Routine type picker (Native v2 recommended /
  Legacy v1). A v2 draft is edited with the same TriggerBuilder,
  ConditionEditor, and ProgramBuilder the editor uses, so a new routine is
  built natively from the start; v1 keeps the existing rules/actions flow.
- v2 starting points: blank (manual trigger), device change activates a
  scene (state_change trigger), schedule activates a scene (cron trigger),
  and reuse of an existing v2 definition. v1 copy lists only v1 routines
  and v2 copy lists only v2 routines, since the semantics do not translate.
- v2 preview shows the raw definition JSON. Create validation requires at
  least one trigger, a native program with at least one step, a scene for
  every activate_scene step (including nested choose branches), and
  non-empty all/any conditions before the server sees the payload. The
  created row sends `semantics_version: 2` with empty rules/actions.
- Verified against a local server: the default and filled v2 create
  payloads round-trip with `semantics_version: 2` and the routines list
  classifies them as v2. UI tsc/lint/build green.
- This completes the visual v2 editor arc (triggers, program, condition,
  create). Remaining P12 polish: script program bodies, next-occurrence
  preview, and the secret surfaces noted earlier.

### P12 script program authoring implemented: sandboxed scripts are editable

Commit: `feat(ui): author native v2 script programs`.

- ProgramBuilder gains a program type switch (native steps / sandboxed
  script) and a full script editor: read-only API version and limits profile
  (the server supports only v1 and `default`), a monospace function body
  editor with an "Insert starter" button, and a declarations list editor for
  device, group, timer, and broad all-state declarations. AllState shows the
  explicit broad-subscription warning; devices and groups may be declared
  before they are discovered.
- The starter template matches the RoutineHandler contract
  (`return { actions, next_state? }`) and uses `ctx.state.memory`,
  `ctx.now_ms`, and `api.actions.*`, so an inserted starter compiles as-is.
- The create modal accepts script programs: validation requires a non-empty
  body instead of native steps, so a new routine can start from a script.
- Verified against a local server: the exact starter template compiles;
  `api_version: 2`, empty bodies, and syntax errors are rejected with the
  server's messages; and a script routine triggered by a device transition
  executed its `api.actions.setPower` action end-to-end (the lamp was reset
  to off and the script turned it back on). UI tsc/lint/build green.
- Still open for P12: next-occurrence preview, script fixtures/simulation
  tooling, and the secret surfaces noted earlier.

### P12 next-occurrence preview implemented for schedule triggers

Commit: `feat(api,ui): preview schedule trigger occurrences`.

- New core helper `automation::schedules::preview_occurrences` walks the same
  calendar rules the runtime uses: interval schedules step by `every_ms` from
  the reference instant, cron schedules resolve in the stored zone, and the
  result is clamped to 16 occurrences. Six unit tests cover intervals, zone
  resolution, strict-after semantics, clamping, empty schedules, and
  bad-cron/unknown-zone errors.
- `POST /api/v1/config/routines/schedule-preview` previews an unsaved
  schedule (default `from_ms` is the server clock) and returns
  `{ occurrences: [ms] }`; validation errors reuse the runtime's messages
  with 400.
- The trigger editor's schedule fields now show a debounced live preview of
  the next five fire times rendered in the schedule's timezone, with server
  validation errors inline. Occurrences are formatted with
  `Intl.DateTimeFormat` in the stored zone, falling back to local time.
- Verified against a local server: a summer `Europe/Helsinki` 18:00 cron
  resolves to 15:00Z, intervals step from the reference instant, bad cron and
  unknown zones return their runtime messages, empty schedules return no
  occurrences, and `count` is clamped to 16. Server: 521 lib tests, clippy
  clean. UI: tsc/lint/build green.
- Still open for P12: script fixtures/simulation tooling and the secret
  surfaces noted earlier.

### P11 slice 1 implemented: computed source model and the shared circadian oracle

Commit: `feat(automation): add computed source model and circadian oracle`.

- New `types/automation_source.rs`: `LightProfile` (color/brightness/
  transition_ms with validation), `SourceQuality`/`SourceOutput`
  (freshness plus provenance), strict `CircadianCompatParams`, and
  `SourceCompute`/`SourceDefinition` (canonical `computed/<id>` key, legacy
  aliases, revision, refresh cadence, pinned preset version). The default
  cadence is the legacy 60 seconds.
- New `core/automation/sources/circadian_compat.rs`: the versioned preset
  oracle extracted from the legacy integration. `from_params` validates
  strictly (D03: zero/negative durations, cross-midnight windows,
  overlapping fades, out-of-range brightness, bad `HH:MM`), while `new`
  preserves the original silent interpretation for historical configs.
  `profile_at` composes the frozen curve: linear day fade, sine-eased night
  fade, Kelvin interpolation with whole-Kelvin rounding, optional brightness
  preserved as optional, and the legacy 60-second transition.
- The circadian integration delegates to the shared curve through
  `mk_circadian_device_at` (injected local time for deterministic tests), so
  the legacy adapter and the v2 preset cannot drift.
  `DeviceColor::new_from_kelvin` / `Ct::from_kelvin` name the Kelvin unit at
  call sites.
- Tests: D01 goldens (fade boundaries and quarter/half samples), D02 (Kelvin
  rounding, HS endpoint mixing, optional brightness, transition), D03 (all
  invalid classes reported), and the integration delegation test. 528 lib
  tests pass; clippy clean apart from pre-existing warnings; bindings
  exported (`LightProfile`, `SourceQuality`, `SourceOutput`,
  `CircadianCompatParams`, `SourceCompute`, `SourceDefinition`).
- `scene-cycling-mixed.hurl` re-confirmed as a pre-existing timing flake
  (it passed/failed on unmodified HEAD too; the hurl GET races the async
  routine pipeline).
- Still open for P11: runtime owner (DB row, registry, synthetic device
  adapter, startup + interval refresh, stale/last-good), compiler/evaluator
  resolution, built-in JS preset and forks, and UI.

### P11 slice 2a implemented: computed source definitions are DB-backed and validated

Commit: `feat(api): persist and validate computed source definitions`.

- New `automation_sources` table (`M20260922000000AutomationSources`):
  id, name, enabled, server-owned revision, timezone, refresh interval,
  aliases JSON, compute JSON. The computed value, freshness, and refresh
  cursors stay runtime state and are deliberately not persisted.
- `ConfigExport.sources` (serde default) round-trips through export/import;
  `db_get_sources`/`db_upsert_source`/`db_delete_source` follow the helper
  query pattern, and `db_has_config` counts source rows.
- `GET/PUT/DELETE /api/v1/config/sources[/:id]` mirror the helpers routes.
  Writes validate strictly: id/name, IANA timezone via the shared schedule
  zone parser, refresh interval bounds (1s..=24h), duplicate aliases, and
  the compute body — unsupported circadian preset versions and the strict
  `CircadianCompatCurve::from_params` errors are reported with 400. The
  server owns the revision (first write 1, each write +1).
- Tests: unit validation matrix plus
  `source_crud_validation_and_export_import` in `config_api_integration`
  (revision bumps, list, invalid variants rejected, export contains the
  row, delete clears it, import restores it). Full suite: 529 lib + 40
  config-api tests pass; clippy clean apart from pre-existing warnings;
  `scene-cycling-mixed.hurl` flaked once and passed on rerun.

### P11 slice 2b implemented: runtime owner publishes computed sources

Commit: `feat(automation): refresh computed sources through a read-only device`.

- New `core/automation/sources/registry.rs`: `Sources` keeps definitions,
  last-good outputs, and refresh cursors in actor state. `load_rows`
  preserves outputs for unchanged revisions (dropping them, and the cursor,
  when a revision changes so edits recompute immediately) and returns
  removed ids. `due_sources(now)` gates on each source's own cadence;
  startup has no cursor, so every enabled source computes once (D04).
  `record_failure` retains the last good profile as `Stale { message }` and
  never invents an output (D06).
- `evaluate_source` resolves the stored zone through the shared schedule
  parser (`ScheduleZone::local_time_at`), builds the frozen preset curve,
  validates the profile, and returns the injected civil time for
  provenance. `synthetic_device` publishes a read-only `Sensor::Color`
  under `computed/<id>`; the adapter integration id `computed` matches no
  integration row, so integration reload cannot delete computed owners
  (D08/D09).
- Runtime: `AppState.sources` + `apply_runtime_sources()` (load rows, drop
  devices for removed sources, rebuild aliases, refresh due sources) wired
  into startup (before the startup seed, so the first profile joins the
  warming-up frame), config commit/import, and source upsert/delete. The
  actor gained `Event::SourceRefreshTick`; `main.rs` runs a one-second
  ticker (validated cadence minimum is one second) and per-source due
  checks stay in actor state. Publication reuses the extracted
  `apply_internal_state` helper so `SetInternalState` and source refresh
  cannot drift.
- Aliases (D07): `Devices.source_aliases` maps legacy keys to the canonical
  device; `get_device`/`get_device_by_ref` resolve them after checking real
  devices first, so an alias is never a second entity and never shadows a
  real device. Scene link resolution inherits this, so a scene linking
  `circadian/color` materializes from `computed/circadian`.
- Tests: D04 cadence, D06 stale retention, D09 read-only sensor + alias
  map, timezone evaluation, unknown-zone reporting, alias resolution in
  `Devices`, and an actor-level publish/alias/corruption test. New
  `source_refresh_publishes_read_only_synthetic_device` in
  `config_api_integration` covers disabled-never-computes, immediate
  compute on enable, single canonical entity, D08 under integration
  create/delete, and device removal on delete. Full suite: 536 lib + 41
  config-api tests pass; clippy clean apart from pre-existing warnings;
  `s04_output_abuse_is_bounded_and_keeps_the_worker` flaked once and passed
  on rerun.
- Live E2E: with a one-second cadence, the published profile advanced
  through the day fade (brightness 0.5044 → 0.5120, Kelvin 2507 → 2520); a
  scene linking the legacy alias materialized the lamp to the exact source
  profile; a device override storing `power=false` survived source
  refreshes (SC04); the alias never appeared as a duplicate device;
  deleting the source removed the device; server log clean.
- Follow-ups: alias keys are resolved in device lookup but are not listed
  as devices in API/snapshot output; imported configs are not yet validated
  for source rows (API writes are), and source outputs/freshness are not
  exposed in snapshots or the UI yet.

### P11 slice 3 implemented: conditions resolve computed sources through the published device

Commit: `feat(automation): resolve computed sources in conditions`.

- `ValueSource::ComputedSource` gained a `path` field (serde default `/`;
  malformed pointers are rejected at compile time as
  `invalid_json_pointer`), so source reads address a profile field the same
  way device reads address a device path.
- Evaluator: computed-source reads resolve through the published synthetic
  device (`resolve_device_path(&source_device_key(source), path, view)`),
  so conditions observe exactly the last-good value scenes and devices see;
  there is no second evaluation path and the registry remains the only
  writer (D05).
- `resolve_sensor_path` fallback now traverses serialized color-sensor
  state as a JSON pointer (`/value` prefix stripped) instead of mapping a
  fixed field set, so `/brightness` and `/color/x` both work.
- Compile: `ConfigCatalog::from_export` populates `sources` from the export,
  so a routine referencing a missing source fails with `unknown_source` and
  malformed paths fail with `invalid_json_pointer`.
- Startup ordering (`main.rs`): source devices are seeded (load rows,
  evaluate due sources, publish with `EventOrigin::Derived`) before
  `ConfigCatalog::new`/`Routines::load_config_rows`, so an enabled routine
  referencing `computed/<id>` compiles at startup instead of being
  quarantined. `evaluate_due_sources` is shared by the startup seed and the
  runtime refresh path.
- UI: the condition builder's computed-source variant carries `path`
  (default `/`) and renders a path input; `describeSource` includes it.
- Tests: compile resolution/validation, evaluator resolution through the
  synthetic device, and an actor-level startup-ordering test (same routine
  rejected before the device is seeded, compiled after). Full suite: 539
  lib + 41 config-api tests pass; clippy baseline unchanged (also fixed a
  toolchain-new `manual_is_multiple_of` lint in the test harness).
- Findings/decisions: `state_change` triggers never fire for `Sensor::Color`
  because `device_active_truth_from` returns Unknown for non-boolean
  sensors, so source-change reactions use predicates
  (`predicate_for`/`predicate_transition`) on a source condition. A
  `predicate_for` already true when the routine loads is seeded true and
  never arms (J06 "seeded true does not arm"), so restart verification
  cannot rely on an already-satisfied predicate; both behaviors are
  pre-existing semantics and were left unchanged.

### P11 slice 4 implemented: shipped script preset, forks, and the worker-backed source path

Commit: `feat(automation): run computed sources through scripted presets`.

- `SourceCompute::Script { preset, source_body, params }`: exactly one of a
  pinned shipped preset (`SourcePresetRef { id, version }`) or a DB-backed
  inline body (a fork). Presets are immutable application assets
  (`sources/presets/circadian_v1.js`, `include_str!`), so a later preset
  update never mutates saved definitions (D10). `GET
  /api/v1/config/sources/source-presets` lists each preset with its
  forkable body and default parameters.
- The shipped circadian v1 preset is a JavaScript port of the frozen curve
  using new pure prelude helpers: `api.time` (strict `HH:MM` parsing,
  injected civil time, lerp, sine easing) and `api.color` (Kelvin/HS
  constructors and mixing). Server-side validation pins the preset version,
  strictly validates the shared `CircadianCompatParams` shape plus a
  same-kind rule (Kelvin/Kelvin or HS/HS), and bounds inline bodies at
  64 KiB.
- Runtime: script sources dispatch through the supervised worker pool
  (`prepare_source_invocation` -> `spawn_source_execution` ->
  `Event::SourceScriptResult`) with the coordinator's computed-source owner
  contract, `LatestWins` coalescing, and revision/generation staleness
  (S16). Dispatch marks the cadence cursor and a pending marker (60 s
  lost-result backstop); completion validates the result as a
  `LightProfile`, records freshness, and publishes through the same
  read-only synthetic device as built-in sources. Failures keep last-good
  as `Stale`, never publish, and never invent an output (D06).
- Startup: built-in sources still seed before routines compile; script
  sources compute on the first refresh tick, and the first successful
  result recompiles routines so references to `computed/<id>` resolve (a
  quarantined routine compiles when its source device appears). Source
  contexts are pure: parameters plus injected civil time, never live
  devices.
- Tests: preset pinning/parameter unit matrix, body resolution,
  actor-level publish/stale/invalid/failure plus the first-result routine
  recompile, worker goldens comparing the JS preset against the Rust
  oracle within +/-1 K with pinned HS-arc/brightness behavior, forked
  inline body execution, API validation/listing/fork round trip, and a
  live end-to-end script source computation. Full suite: 545 lib + 43
  config-api + 3 source-preset tests pass; clippy baseline unchanged; UI
  tsc/lint/build green.
- Decisions/follow-ups: the scripted preset supports Kelvin/Kelvin or
  HS/HS pairs (mixed pairs stay on `circadian_compat`); HS hue mixing uses
  the shortest arc with ties walking the positive direction. Source
  outputs/freshness are still not exposed in snapshots or the UI (slice
  5), and imported configs are not re-validated beyond the API path.
- Correction: the presets route is `GET /api/v1/config/source-presets`
  (mounted beside `sources`, not nested under it); verified live while
  building slice 5.

### P11 slice 5 implemented: computed sources config page with preset forms and forks

Commit: `feat(ui): edit computed sources with preset parameter forms`.

- New `/config/sources` page (Automation group): lists sources as
  expandable cards with enabled/kind badges, `computed/<id>` key,
  timezone, cadence, aliases, and a live value preview read from the
  websocket device snapshot (Kelvin + brightness, HS fallback, off).
  Create/edit runs through one editor with tabs Basics, Compute,
  Parameters, Script, and Advanced JSON; raw JSON is an escape hatch
  with explicit Apply/Reload actions, and server 400s surface in an
  alert.
- Compute tab: built-in `circadian_compat` vs JavaScript script; script
  kind picks a pinned shipped preset (`id@version` from the presets
  endpoint, default parameters loaded on selection) or a custom inline
  body. "Fork into editable script" copies the shipped body into
  `source_body`, drops the pin, and keeps the parameters, matching the
  server's exactly-one-of rule.
- Parameters tab reuses a shared circadian form (time, duration,
  brightness presence toggle, Kelvin/HS color field) for both
  `circadian_compat` and the pinned circadian script preset; custom
  bodies edit raw JSON params instead. The script tab embeds the Monaco
  editor (same pattern as the scene script editor) with an `api.time`/
  `api.color`/`ctx` declaration and completion provider, read-only for
  pinned presets, plus a starter body.
- `useConfig.ts` gains `useSources`/`useSourcePresets` and a
  hand-written `SourceConfig` type with numeric `revision`/
  `refresh_interval_ms` (the generated binding maps i64 to `bigint`,
  which `JSON.stringify` rejects).
- Tests: no UI test framework; verified with `pnpm tsc/lint/build` plus
  a live server round trip of the exact payloads the page builds
  (built-in create publishes `2163 K / 0.2975`, fork publishes
  `2161 K / 0.2964` within the preset's +/-1 K parity tolerance, pinned
  script preset publishes `2160 K / 0.2957`, delete removes the
  synthetic device). Clippy/server suites untouched by this slice.
- Follow-ups: source output freshness/staleness is still not surfaced
  in the UI (the live preview shows last published state only), and the
  editor does not warn before forking over local script edits.

### Offline one-time converter implemented: v1 routines convert through the strict compiler

Commit: `feat(automation): add the offline v1 to v2 routine converter`.

- New `homectl-server convert` subcommand (dry-run by default). Inputs:
  `--source-db` (SQLite path/URL or PostgreSQL URL, read-only) or
  `--source-export` (JSON export); defaults to `DATABASE_URL`/`./homectl.db`.
  Outputs: text report or `--json`. `--apply` writes converted rows in one
  transaction after archiving the pre-conversion rows to JSON
  (`--archive`, default timestamped); `--force` applies with unconvertible
  rows present (they stay v1 and keep running); `--restore <archive>` is the
  rollback. `--apply`/`--restore` refuse while a server answers
  `/health/live` on the configured or default port (custom ports via
  `--port`, escape hatch `--skip-running-check`).
- Conversion module (`core/automation/convert.rs`) maps rules conservatively
  and validates the result with `compile_definition`, so the compiler stays
  the single authority. Mapped: pulse sensor -> `report` trigger + value
  `comparison` condition; edge sensor -> `predicate_transition`; pulse/edge
  device power -> `state_change` level/transition; level rules -> conditions
  (device `/power`, group `all`, raw/script never); `any` of level rules ->
  `any` condition; `activate_scene` (plain, explicit targets, or
  `mirror_from_group` -> `group_active` selection); `dim` with targets and
  the v1 default step of 0.1. Reported instead of guessed: raw rules, script
  rules, numeric/color sensor rules (v1 never matched them), `any` with event
  leaves, group event leaves, level-only routines (v1 every-update firing),
  multiple event leaves, unmappable actions (cycle/custom/set-state/
  randomize/toggle/ui/force), and descriptors relying on dispatch-time
  expansion (`include_source_groups`, rollout, scene transitions).
- Runner (`core/convert.rs`): loads the export, inventories cron/timer
  integrations for the later stage, and reports per-row
  converted/needs-manual/unsupported/already-v2 with notes. Persistence uses
  a new additive `db_apply_routine_rows` transaction helper (never deletes
  rows). Converted rows keep their legacy JSON columns, set
  `semantics_version = 2`, bump `revision`, and store the compiler's
  normalized definition. The report notes that device references are not
  verified offline (missing devices load as quarantined).
- Tests: 24 conversion unit tests (each mapping plus the reported cases,
  determinism, fingerprint, v2 rows untouched) and an integration test that
  seeds a real SQLite DB, applies the report, keeps the manual row on v1,
  and restores the archive. Full suite: 569 lib + 43 config-api + 3
  source-preset + convert + 7 hurl integration (trigger-modes flake passed
  on retry); clippy baseline unchanged. Manual CLI verification: report,
  `--apply`, idempotent second run (`already v2`), refusal while a server
  answers the health check, `--restore`, `--source-export`, and clean
  `--json` output.
- Follow-ups: cron/timer conversion (each schedule -> schedule trigger plus
  its action program, timer usage -> named timers) is the next stage; the
  converter report currently only inventories those integrations. The
  converter does not re-validate device references offline, so real-device
  availability is confirmed by the runtime quarantine/diagnostics after
  restart.

### Live dry run against the production database (read-only)

Commit: `fix(simulate): read pre-v2 PostgreSQL sources with the legacy fallback`.

- The production PostgreSQL database predates the additive v2 routine
  columns, and the source reader had no legacy fallback for Postgres (only
  SQLite did). The Postgres reader now falls back to the same column-tolerant
  query-builder export the SQLite path uses, so a pre-migration dry run is
  possible without deploying first.
- Live report (read-only, server untouched): 36 routines - 2 converted,
  7 needs manual, 27 unsupported, 0 already v2; one timer integration
  (`entryway_timer`, enabled), no cron integrations.
- Unsupported breakdown: 20 routines are `any` rules containing event leaves
  (disjunctive pulse triggers, the staircase/motion family) - these are the
  plan's "intentional redesign" bucket, not mechanical candidates, because
  v1 `any` lets one child's pulse satisfy the trigger while another child's
  state satisfies the guard, which a single v2 condition cannot express;
  3 device rules match an active scene (no v2 single-device scene condition);
  2 script rules; 1 raw rule; 1 empty rule list. Needs-manual breakdown:
  4 `activate_scene` rollouts, 1 `cycle_scenes`, 1 `custom` action, 1
  multiple-event-leaf routine.
- Converted: two office desk lamp routines (`report -> activate_scene`), as
  expected for the mechanical subset.

### Converter stage 2 implemented: cron schedules and timer actions convert

Commit: `feat(automation): convert cron schedules and timer actions`.

- Timer usage: `custom` actions on a timer integration (millisecond payload)
  become `replace_timer` on the named v2 timer (integration id = timer id).
  Timer integrations are never modified by the row conversion itself; they are
  disabled on apply only when no v1 routine still reads their synthetic
  `timer` device. Rules that read `(<timer integration>, timer)` are reported
  as unsupported with a precise reason (v2 named timers expose no running/idle
  condition; the cooldown guard needs a deliberate redesign).
- Cron: every schedule of a cron integration becomes a new v2 routine
  (`cron-<integration>-<schedule>`) with a `schedule` trigger. v1 expressions
  are five-field and resolved against server-local time, so conversion
  requires `--cron-timezone <IANA zone or offset>` (v2 schedules default to
  UTC); the five-field form gains an explicit zero second. `init_enabled`
  and integration `enabled` combine into the routine's enabled flag.
  Partial conversions are refused as a group: if any schedule of an
  integration cannot convert, none of its schedules are created, because the
  legacy scheduler stays enabled and would double-fire.
- Apply/restore: a fully converted cron integration is disabled in the same
  transaction (quiescing the old scheduler). The archive format is now
  version 2 (version 1 archives still restore) and records the created
  routine ids plus the pre-disable integration rows; restore deletes the
  created routines and re-upserts the archived integrations. New
  `db_apply_conversion` transaction helper does routine upserts, routine
  deletes, and integration upserts atomically. A dry run after an apply no
  longer re-reports cron integrations whose routines exist and are disabled
  (previously an unconditional routine-id conflict forced `--force`).
- Dry-run input now honors `DATABASE_URL` like the apply/restore path
  (`--source-db` still wins, then `DATABASE_URL`, then `./homectl.db`).
- Tests: 11 new unit tests (timer mapping, non-timer custom stays manual,
  non-numeric payload, timer-device unsupported reason, cron timezone
  requirement, seconds normalization, six-field passthrough, disabled flag,
  routine-id conflict, config parsing defaults and malformed config) plus an
  extended integration test covering cron routine creation, integration
  quiescing, idempotent second report, and restore. Full suite: 580 lib + 43
  config-api + 3 source-preset + convert + 7 hurl integration, all green on
  the first run; clippy baseline unchanged. Manual CLI verification of the
  full loop (dry run with/without `--cron-timezone`, `--json`, `--apply`
  creating cron routines and disabling the integration, idempotent re-run,
  `--restore` removing created routines and re-enabling the integration).
- Live re-run (read-only, server untouched): 36 routines - 2 converted,
  6 needs manual, 28 unsupported; no cron integrations; the timer
  integration stays untouched because `entryway`/`entryway_dark` still
  depend on it. The only live delta from stage 1 is `entryway_dark` moving
  from needs-manual to unsupported with the precise timer-device reason.

### Staircase/`any` redesign: live analysis and v2-native replacement proposal

Status: user signed off; steps 1-4 implemented (converter mappings, the
CycleScenes action, the rollout decision as v2 `RolloutSpec`, and the
`randomize_color` action). Step 5 is designed with concrete recipes (ephemeral
`entryway_cooldown` helper, `predicate_for` cleanup routine, normalized motion
condition) and needs only hand authoring during migration. Sources: live
routines export
(`/api/v1/config/routines`), live device state (`/api/v1/devices`), v1
evaluator (`core/routines.rs`), v2 evaluator
(`core/automation/evaluate.rs`), v1 cycle-scene resolver (`core/scenes.rs`).

**Correction to the earlier "not expressible" claim.** The stage-1 note said
v1 `any` with event leaves cannot be expressed because "one child's pulse
satisfies the trigger while another child's state satisfies the guard". That
was true only under the single-trigger assumption. v2 triggers are OR'd
(`will_trigger = !matched_trigger_ids.is_empty() && condition`) and support up
to 16 triggers, so the v1 evaluator's exact structure maps over:
v1 `any` = `condition_match: OR(children)`, `trigger_match: OR(children)`, and
top-level rules AND their `trigger_match`/`condition_match`. Therefore:

- `any` with only event children (pulse/edge sensor or device power rules) ->
  one v2 trigger per child (`report` / `predicate_transition` /
  `state_change`) plus an `any` condition over the children's value
  predicates. Exact, including mixed pulse/edge and multiple devices.
- `any` with at least one level child -> the `any` rule's trigger is always
  true in v1 (level `trigger_match` is constant true), so it is neutral in the
  top-level AND: contribute only the `any` condition and no trigger (the
  existing level-only handling). Exact as long as some other top-level rule
  provides the trigger.
- Single-child `any` unwraps to the child.
- v1 device `scene` rule (`device.scene == X`) -> condition
  `comparison(Device{path:"/scene_id"}, eq, X)`; `/scene_id` is already a
  v2-readable controllable path (`evaluate.rs`). Exact.
- v1 raw rule on a zigbee2mqtt motion sensor (`/occupancy eq true pulse`) is
  not mechanically safe in general, but this family has a clean redesign: the
  integration normalizes occupancy into `Sensor{value: bool}`, so
  `report` + `/value == true` (or `predicate_transition`) is equivalent for
  these devices.

**What actually blocks the live rows.** Trigger/scene mappings alone convert
nothing in the affected families, because their actions are not representable:

- `CycleScenes` (20+ rows: the whole nightlight/button family) has no v2
  native action. v1 semantics (`core/scenes.rs::get_next_cycled_scene`):
  detect the active scene among the cycle list from the devices' `scene_id`
  (only devices common to all cycled scenes, offline devices ignored),
  advance with wrap unless `nowrap`, then activate the entry's scene with the
  entry's own targets. Plan A9 requires retaining scene cycles, so this is a
  missing v2 capability, not a redesign of the routines.
- `ActivateScene` with `rollout` (spatial, duration, source device) - 5+
  rows; plan A9 mentions retaining capabilities, but rollout is cosmetic
  stagger. Needs a decision: implement rollout in v2, or convert without it
  and document the behavior change.
- `RandomizeColor` (2 rows: kids_room_randomize_*) - no v2 color action
  exists (`SetPower`/`Dim` only); v2 scripts can emit native actions and have
  a deterministic clock (`Date` is seeded) and deterministic `Math.random`,
  so a script program could cover it once a color action exists.
- `entryway_dark` timer-device guard - deliberately unsupported; needs a
  redesign (e.g. a helper/source that tracks "timer armed" or restructuring
  the cooldown into the v2 timer semantics).
- `kids_room_bed_toggle` has an empty rule list (inert in v1 too): delete or
  author, not a conversion.

**Proposed order.**
1. Converter mappings (exact, testable, no behavior change): `any` with event
   leaves, single-child unwrap, device `scene` -> `/scene_id`.
2. `CycleScenes` native v2 action with v1 detection/advance semantics and
   per-entry targets (rollout decision separate), which unblocks the largest
   family's actions.
3. Rollout decision for `ActivateScene`/`CycleScenes`.
4. Color action for `RandomizeColor` (or a documented drop), then the
   `kids_room_randomize_*` script redesign.
5. `entryway` raw-rule redesign to a normalized motion condition;
   `entryway_dark` cooldown redesign; `kids_room_bed_toggle` cleanup.

### Converter step 1 implemented: exact `any`/scene mappings

Commit: `feat(automation): map v1 any-of-events and device scene rules`.

- `any` of event leaves now converts to one v2 trigger per child plus an
  `any` condition over the children's value predicates; a level child makes
  the v1 rule constant-true, so such an `any` contributes only its condition
  (v1 level triggers never gate, and the rule is neutral in the top-level
  AND). Single-child `any` rules unwrap to the child.
- The top-level event-rule check now counts triggering *rules* rather than
  triggers, so a multi-trigger `any` is no longer mistaken for the v1
  top-level AND case (two event rules still need manual, with a clearer
  message).
- v1 device scene rules (`device.scene == X`) convert for every trigger mode:
  level -> `/scene_id` comparison; pulse -> `report` + condition; edge ->
  `predicate_transition` + condition. A combined `power` constraint is ANDed
  in (including power-off, which the state_change path cannot express).
- Tests: 7 new/updated unit tests (any of pulse leaves, any of edge leaves,
  any with a level child, single-child unwrap, any-of-events plus another
  event rule, scene level/pulse/edge, scene+power). 42 conversion unit tests
  total.
- Live re-run (read-only): unsupported 28 -> 5, needs manual 6 -> 29. The
  remaining 5 unsupported are the deliberate redesigns (`entryway` raw,
  `entryway_dark` timer guard, `kids_room_bed_toggle` empty, 2
  `kids_room_randomize_*` script rules). All 29 needs-manual rows are now
  action-only blockers: 21 `cycle_scenes`, 8 `activate_scene` with rollout.

### Converter step 2a implemented: v2 rollout and ActivateScene options

Commit: `feat(automation): carry rollout and activation options on v2 scenes`.

- `NativeAction::ActivateScene` gains `use_scene_transition` (serde default
  true to keep existing v2 definitions and UI-created steps behaving as
  before), `transition_ms`, and `rollout` (`RolloutSpec { style, source,
  duration_ms }` with `RolloutSource::Device` or `TriggeringDevice`).
- The planner resolves `TriggeringDevice` from the matched trigger that fired
  the run (report/state_change/predicate_transition/predicate_for; schedules,
  timers, startups, manual runs and script result plans resolve to no source,
  so the actor applies immediately, matching v1's missing-origin behavior).
  The resolved options ride the v1 `ActivateSceneActionDescriptor`, so the
  existing spatial rollout machinery (positions, min/max normalization,
  delayed batches with preserved causation) is reused unchanged.
- Compiler validation: rollout duration bound (`MAX_ROLLOUT_DURATION_MS`,
  10 min), fixed source devices must resolve, and `transition_ms` must be
  positive.
- Converter: `activate_scene` now maps `use_scene_transition`, `transition`
  (seconds -> ms, rounded, zero dropped) and `rollout` /
  `rollout_source_device_key` (`__homectl_runtime__/triggering_device` ->
  `triggering_device`, otherwise a fixed device). `include_source_groups`
  stays needs-manual.
- UI: the native program editor edits transition mode, transition override,
  and rollout (source kind/device, spread) for ActivateScene steps.
- Tests: rollout compile bounds and source resolution, planner triggering-
  device resolution and no-source fallback, converter rollout/transition
  mappings. Bindings: `RolloutSpec`/`RolloutSource` exported. Full suite: 595
  lib + 43 config-api + convert + 7 hurl integration, green on first run; UI
  tsc/lint/build green; clippy at baseline.
- Live dry run (read-only): converted 2 -> 10 - the eight rollout rows
  (`arrive_home`, `leave_home`, `office_presence_on/off`,
  `staircase_downstairs`, `_bright`, `_dark`, `staircase_upstairs`) now
  convert with faithful transitions (`use_scene_transition: false` from the
  v1 default, explicit overrides preserved). Remaining 21 needs-manual rows
  are all `cycle_scenes`, 5 unsupported remain the deliberate redesigns.

### Staircase redesign step 2 implemented: the v2 `cycle_scenes` action

Commit: `feat(automation): add the v2 cycle-scenes action`.

- `NativeAction::CycleScenes { id, scenes: Vec<CycleSceneSpec>, nowrap,
  detection, rollout }` mirrors v1's per-entry shape: `CycleSceneSpec {
  scene_id, targets, use_scene_transition (default true), transition_ms }`.
  `nowrap` defaults false, `detection` defaults empty, `rollout` is the same
  `RolloutSpec` as scene activation (step 2a).
- Planner: resolves each entry's scene and builds v1 `ActivateSceneDescriptor`
  entries (per-entry targets and transition override), maps `detection` to the
  v1 descriptor's `device_keys`/`group_keys` with `include_source_groups:
  false`, resolves the rollout (including `TriggeringDevice`), and dispatches
  `Action::CycleScenes`. Detection targets are read-only: they narrow which
  common devices decide the current scene and are never written.
- Compiler: every entry scene must resolve, targets resolve at compile time,
  empty scene lists (`empty_cycle_scenes`) and zero transitions
  (`invalid_duration`) are rejected, rollout duration bound and source
  resolution are shared with `ActivateScene`.
- Converter: v1 `CycleScenes` maps `nowrap`, top-level device/group keys ->
  `detection`, per-entry targets/transitions, and rollout
  (`__homectl_runtime__/triggering_device` -> `TriggeringDevice`). Entry
  `mirror_from_group` and descriptor/entry `include_source_groups` stay
  needs-manual with precise reasons (both are v1 dispatch-time expansions).
- UI: a "Cycle scenes" step kind with an ordered entry list (add/remove/move
  up, scene, target override, transition mode/override), a stop-at-last
  checkbox, a detection target override, and the shared rollout controls
  (extracted into `RolloutEditor`/`RolloutToggle`). The create-routine modal
  validation requires at least one entry and a scene per entry.
- Tests: compile validation (valid, empty, unknown entry scene, unknown
  detection device), a planner descriptor test (entries, detection, nowrap,
  triggering-device rollout), and three converter tests (mapping, mirror entry
  needs-manual, source groups needs-manual). Full suite green on first run:
  600 lib + 43 config-api + convert + 7 hurl integration; UI tsc/lint/build
  green; clippy at baseline.
- Live dry run (read-only): converted 10 -> 31, needs-manual 21 -> 0. The 21
  former needs-manual rows were all `CycleScenes`; verified the
  `deactivate_nightlight` output carries `nowrap: true`, detection group
  `bedroom`, entries targeting group `upstairs`, `use_scene_transition:
  false`, and the 1500 ms triggering-device spatial rollout. The remaining 5
  unsupported rows are the deliberate step 4/5 redesigns (`entryway` raw
  rule, `entryway_dark` timer guard, `kids_room_bed_toggle` empty,
  `kids_room_randomize_innolux_on_down`, `kids_room_randomize_lamp_on_up`).

### Staircase redesign step 4 implemented: the v2 `randomize_color` action

Commit: `feat(automation): add the v2 randomize-color action`.

- `NativeAction::RandomizeColor { id, targets, min_saturation, max_saturation,
  transition_ms }` maps the v1 descriptor: hue is uniformly random in 0..360,
  saturation uniformly in the (clamped, order-normalized) bounds with defaults
  0.2..=1.0, and each target's tracked `scene_id` is cleared so a later cycle
  does not read the one-off color as a scene activation. Randomness stays in
  the executor (the v1 `Action::RandomizeColor` path), matching v1 exactly.
- Planner: expands device and group targets to concrete device keys at plan
  time (groups are filtered to live members; frozen groups keep their captured
  members) and dispatches with the usual intent guard. Compiler: saturation
  bounds must be finite (`invalid_saturation`), `transition_ms` positive, and
  at least one target required (`missing_targets`).
- Converter: v1 `RandomizeColor` maps targets, bounds, and the transition
  (seconds -> ms); an action without devices is rejected.
- Scripts: `api.actions.randomizeColor({ targets, minSaturation?, maxSaturation?,
  transitionMs? })` emits the native action, so a script program can cover the
  `kids_room_randomize_*` redesign. Example replacement for their script rule:

  ```js
  var hour = new Date().getHours();
  if (hour < 7 || hour >= 20) {
    return { actions: [] };
  }
  return {
    actions: [
      api.actions.randomizeColor({
        targets: { devices: [{ integration_id: "zigbee2mqtt", device_id: "0x..." }] },
        minSaturation: 0.2,
        maxSaturation: 1.0,
        transitionMs: 250,
      }),
    ],
  };
  ```

  There is no native v2 clock condition, so the converter still reports those
  two rows as needs-manual; the redesign is deliberate authoring, not a
  mechanical mapping.
- UI: a "Randomize colors" step kind with target selection, optional
  saturation bounds (defaults documented in place), and a transition override.
- Tests: compile validation, planner group expansion plus transition carry,
  converter mapping, and a script-handler contract test for the emitted
  action. Full suite green on first run: 604 lib + 43 config-api + convert +
  7 hurl integration; UI tsc/lint/build green; clippy at baseline.
- Live dry run (read-only): unchanged at 31 converted / 0 needs-manual / 5
  unsupported. The two `kids_room_randomize_*` rows stay unsupported on their
  script rule (the reason is now the only blocker; their action is
  representable). `entryway`, `entryway_dark`, and `kids_room_bed_toggle`
  remain as step 5.

### Staircase redesign step 5 designed: entryway cooldown and the remaining manual rows

No code change is needed for the last three live rows: the existing v2
primitives cover the redesigns. This section records the exact recipes so the
migration is authoring, not design.

**Why the timer guard cannot be mechanical.** v2 named timers are owned by the
routine that scheduled them, and `timer_fired` only matches fires whose
`routine_id` equals the evaluating routine (`evaluate.rs`). The v1
`entryway_timer` synthetic device is a third timer shape: a global "armed"
flag read by other routines. A second routine cannot observe `leave_home`'s
deadline, so the v1 guard maps to two cooperating v2 pieces instead:

1. An **ephemeral boolean helper** `entryway_cooldown` (default false;
   ephemeral so a restart clears it, matching the v1 in-memory timer).
2. A **cleanup routine** `entryway_cooldown_clear`:
   - trigger: `predicate_for` on `helper entryway_cooldown == true` with
     `duration_ms: 300000` (J06 arms on false/unknown -> true, fires once on
     maturity, cancels when the predicate leaves true),
   - program: one `set_helper entryway_cooldown = false` step.
3. `leave_home` keeps `replace_timer(entryway_timer, 300000)` (parity and
   visible countdown) and adds
   `set_helper(entryway_cooldown, true)` before the `leave` activation.
4. `entryway` and `entryway_dark` add
   `comparison(helper entryway_cooldown, eq, false)` to their conditions.

**entryway** (raw motion row). The raw `/occupancy` pulse becomes a `report`
trigger on `zigbee2mqtt/0x0017880109159dc5` plus
`comparison(device /value, eq, true)`: the integration normalizes occupancy
into the boolean sensor value, so the normalized condition is equivalent for
this device. The rest is the converted structure: group conditions
(`downstairs` all off; `any` of `upstairs` all off or `upstairs` scene
`normal`) and the unchanged `normal` activation on `downstairs` with the
fixed-source spatial rollout (`zigbee2mqtt/0x001788010bd7ec37`, 1500 ms).

**entryway_dark**. Its motion sensor rule already converts (sensor pulse ->
`report` + `/value == true`); adding the cooldown condition above makes the
row convertible by hand. The action stays the `dark` activation on
`downstairs` with the triggering-device rollout.

**kids_room_bed_toggle**. Disabled, empty rule list, inert in v1. Delete it
during migration; authoring would need a deliberate purpose.

**kids_room_randomize_* rows**. Author as script programs using the step 4 recipe
(seeded `Date` plus `api.actions.randomizeColor`); the converter's only
blocker is the script rule, and its reason already points at deliberate
authoring.

With these recipes the migration story is complete: 31 rows convert
mechanically, `entryway` / `entryway_dark` are hand-authored from the
converted base plus the cooldown pattern, the two randomize rows are
hand-authored script programs, and `kids_room_bed_toggle` is deleted.

### P12 leftovers slice 1: legacy badges and motion/occupancy presets

Commit: `feat(ui): label legacy routines and add motion/occupancy presets`.

- Routine cards show a `Legacy v1` badge (amber outline) when the row is not
  v2, alongside the existing `v2` badge, so the editor choice is visible
  during migration.
- The create modal's v2 "Start from" presets gain:
  - `Motion report activates a scene`: a `report` trigger on an empty device
    plus a `/value == true` comparison condition and an activate-scene step.
  - `Occupancy holds a scene (level)`: the same shape with a `state_change`
    `level` trigger.
  The existing device-change and schedule presets are unchanged, and v1
  presets stay as they were.

### P12 leftovers slice 2: helper values over the websocket and the mode widget

Commit: `feat(ui,api): stream helper values and add a mode widget`.

- Server: `StateUpdate`/`StatePatch` now carry `helper_statuses`
  (`HelperRuntimeStatus`), the patch builder includes the snapshot's helper
  list when `SnapshotChanges.helper_statuses` is set, and
  `has_websocket_changes` includes the flag, so helper writes reach browsers
  without polling. Two unit tests mirror the timer tests: helpers appear in
  the full state and in helper-only patches, and unrelated patches omit them.
- UI websocket: a `helperStatusesAtom` stores the live list and
  `useHelperStatuses()` exposes it; State and Patch messages both update it.
- Dashboard: a new `helper_mode` widget ("Mode / helper") shows the selected
  helper's value, persistence, and revision, and writes new values through
  `PUT /api/v1/config/helpers/:id/value` (`useSetHelperValue`, which
  invalidates the config queries). Enum helpers render one button per option,
  boolean helpers render On/Off, and number/string helpers render a value
  input with a Set button. The widget settings overlay picks the helper from
  the config API list.
- Verified against a local server: a durable enum helper round-trips through
  `PUT /helpers/:id`, `PUT /helpers/:id/value` returns the new revision, a
  fresh websocket connection receives the helper in `State.helper_statuses`,
  and a value write produces a `Patch.helper_statuses` with the updated value
  and revision. Full suite: 606 lib + 43 config-api + convert + 7 hurl
  integration green; UI tsc/lint/build green; clippy at baseline.

### P12 leftovers slice 3: Monaco routine script editor with SDK and fixtures

Commit: `feat(ui): type and autocomplete routine script programs`.

- New `RoutineScriptEditor` replaces the plain textarea for native v2 script
  programs. It uses the same Monaco setup as the source and scene editors: an
  extra-lib `.d.ts` for the routine handler ABI, JS compiler options
  (checkJs, ES2020), syntax and semantic diagnostics, and a completion
  provider for `api.actions.`, `api.values.`, `api.` and `ctx.`.
- SDK declarations cover `ctx` (`now_ms`, `seed`, `event`, `before`/`after`
  device maps, `values.helpers`, `state.memory`/`revision`) and `api`
  (`now`, `random`, `unknown`, `not`, `values.get`/`requireEnum`, all action
  builders, and the timer aliases), matching `script_prelude.js` exactly.
- Because the server stores a function body, the editor wraps the model in
  `function __homectl_body() { ... }` so a top-level `return` is valid, and
  unwraps edits back to the body; only the body is saved. A visible note
  explains the wrapper.
- Fixtures: a selectable example list (memory counter starter, timer +
  cooldown helper, seeded randomize color, mode helper read) inserts at the
  cursor via Monaco edits.
- Verified against a local server: fixture bodies round-trip byte-identically
  through `POST /api/v1/config/routines` (no wrapper leakage) and compile;
  the server does not syntax-check bodies at compile time, so Monaco
  diagnostics are the first line of defense. UI tsc/lint/build green.

### P12 leftover implemented: computed-source profile preview

Commit: `feat(ui,api): preview computed light profiles`.

- Server: `POST /api/v1/config/source-preview` takes a draft
  `{ timezone, compute, samples? }` and returns one local day of sampled
  `LightProfile` values. The request is stateless, validated with the same
  rules as saving (timezone, preset version, params, script body bounds), and
  the samples come from the same pure `evaluate_compute` path the runtime
  publishes from, so the preview cannot drift from the curve.
- `evaluate_source` now delegates to a new `evaluate_compute(timezone,
  compute, now)`; `ScheduleZone::local_midnight` resolves the sampled day
  start with the pinned DST policy. Sample counts are bounded to 12..=96
  (default 48, 30-minute steps).
- Script sources have no synchronous evaluation; the shipped circadian preset
  is previewed with the built-in curve plus a note (golden tests pin the two
  together), and custom bodies report `unsupported_reason` instead of
  guessing. Types: `SourcePreview`, `SourcePreviewRequest`,
  `SourcePreviewSample` (+ bindings).
- UI: a Preview tab in the source editor renders a brightness polyline, a
  per-sample color strip, and local hour ticks, with a sample-count selector
  and an explicit refresh. `deviceColorPreview` is shared with the parameter
  form's color swatches. Custom scripts show the unsupported explanation.
- Tests: three preview unit tests (day window + runtime-curve equality,
  script-preset note vs custom unsupported, bounds/timezone/params errors)
  and one config-API integration test (stateless sampling, validation
  mirroring saving, no persistence). Full suite 612 lib + 44 config-api + all
  else green; clippy baseline unchanged (four pre-existing warnings, shifted
  lines). Live check: preview at 13:45 matched the published
  `computed/circadian` device value (brightness 0.8, ct 3000).

### P12 leftovers closed: secret exposure decision, schedule enablement dropped

No code change; decisions recorded here and in the referenced sections.

- Secrets: plaintext browser exposure accepted under the trust model (no
  authentication; any client that can reach the API can already control the
  house). Storage stays plaintext DB columns. The existing protections stay:
  widget-secret redaction in default exports, `?include_secrets=true` for
  documented backups, and preserve-omitted-on-import. No server-side query
  proxy for the direct-query widgets is built.
- Schedule enablement: dropped. The v1 cron integration's "power gates
  dispatch" semantics are a compatibility detail, not a control the v2 UI
  needs to reproduce; v2 schedule routines are enabled/disabled through the
  routine `enabled` flag.
- API-version selection (§9.4): N/A while `SUPPORTED_SCRIPT_API_VERSION` is
  the only version. The script editors show the pinned version and the server
  rejects unknown versions; a selector gets added with the second version.

P12 UI leftovers are complete: legacy badges, motion/occupancy presets, mode
widget, helper-value streaming, Monaco routine script editor with SDK and
fixtures, and computed-source profile preview.

### Migration runbook (draft, not executed)

Preconditions: v2 branch merged and deployed; a verified backup pair exists;
cluster access available for stopping/starting the deployment; the 5
unsupported routines are either authored first or accepted as staying on v1
(`--force`); someone is home to watch the first hours.

**Stage 0 — backups (repeat before every write stage).**
Follow `~/backups/homectl/README.md`: `pg_dump --format=custom` plus
`GET /api/v1/config/export?include_secrets=true`, `chmod 600`, verify with
`pg_restore --list`. Record the file names in this log.

- Backups taken 2026-09-21 (pre-Stage-1 pair):
  `~/backups/homectl/homectl-20260921T100952.dump` (custom/gzip, 102 TOC
  entries, 25 TABLE DATA) and
  `~/backups/homectl/homectl-config-20260921T100952.json` (valid JSON, 36
  routines, includes secrets). Both chmod 600; the older 2026-09-19 dump was
  also tightened to 600.

**Rollback strategy (decided pre-migration).**

Pinned pre-migration state (2026-09-21): prod runs
`ghcr.io/fruitiex/homectl:main@sha256:4923f59e065546b84f8d16d80ab338c1d56e8c3a19916bc37f4a841f32ea5b45`
(homelab `cb2593c`, deployed 2026-09-18), which corresponds to homectl
`origin/main` `5aef129c`. Prod DB migrations end at
`m20260918000000_scene_group_state_order` — no v2 columns or tables exist in
prod yet. Repo state: local `main` (`72c19ef7`) is 11 unpushed commits ahead of
`origin/main`, and `v2-refactor` is 57 ahead of local `main`, so "merge to
main" is a fast-forward plus push.

Rollback ladder, fastest first:

1. **Image-only revert (works at every stage).** Revert the homelab digest
   commit (`git -C ~/homelab revert cb2593c` or edit the digest back to
   `sha256:4923f59e...`), push, then `flux reconcile kustomization homectl`
   (30m interval otherwise). Emergency instant switch:
   `kubectl -n default set image deploy/homectl homectl=ghcr.io/fruitiex/homectl:main@sha256:4923f59e...`
   — do the Git revert too, or Flux re-applies v2 at the next reconcile.
   This is sufficient even after Stage 4: `converted_rows` clones the stored
   row and only changes `semantics_version`/`revision`/`definition_v2`, so
   `rules`/`actions` are preserved verbatim; the deployed binary has zero
   `semantics_version` references (verified at `5aef129c`) and ignores the new
   additive columns/tables; there are no cron integrations to disable; and
   `entryway_timer` stays enabled because `entryway` stays v1 under `--force`.
   Caveats: v2-only authoring (Stage 5+) is invisible to the old binary; new
   tables/columns remain (harmless).
2. **Targeted DB rollback (Stage 4 only).** Stop the deployment, run
   `homectl-server convert --source-db "$DATABASE_URL" --restore
   ~/backups/homectl/convert-archive-<ts>.json`, start. Restores routine rows
   and integrations and deletes converter-created routines.
3. **Full DB restore.** `pg_restore --clean --if-exists --no-owner
   --single-transaction -d "$DATABASE_URL" <dump>` plus restart. Last resort;
   discards config edits made after the dump.

Stage 3 rollback is additive: delete the computed source and re-enable the
circadian integrations (no deploy needed). Pre-Stage-4 checklist: fresh backup
pair, archive written, stop/start commands at hand, and a decision budget —
roll back rather than debug if behavior is unexplained after ~20 minutes.
Do not start Stage 5 (v2-only authoring) before the Stage 4 soak passes.

**Stage 1 — merge and deploy v2 with v1 config (no conversion).**
Merge `v2-refactor` to `main`; CI builds the image and dispatches
`FruitieX/homelab`, which commits the new digest; Flux applies it (30m
interval) and the Recreate deployment restarts. Before this, raise the pod
memory limit (256Mi -> 512Mi) because script workers now run as child
processes (measured worst case ~128MiB each, pool of two). Post-deploy checks
(read-only): `/health/ready`; 36 routines still v1; devices/scenes resolve;
logs free of worker spawn/timeout errors. Soak with v1 rows before Stage 3;
the only v1 execution changes are the script paths (1 live scene script, 0
routine script rules) and the circadian integration now delegating to the
shared curve (golden-tested).

**Stage 1 done (2026-09-21).** Homelab memory limit raised to 512Mi
(`cc43b19`), `main` fast-forwarded `5aef129c..6c502a84` and pushed, Server CI
green. Two follow-ups were needed on the first push: clippy `-D warnings`
failures in `compile.rs`/`timers.rs` (fixed in `06cdd4b0`; the "baseline
warnings" were only baseline for `--all-targets`, not CI's lib-only lint) and
two `script_worker` abuse probes timing out at 500ms on the CI runner (fixed
in `6c502a84` with 10s probe timeouts). Final image
`ghcr.io/fruitiex/homectl:main@sha256:51e5a9bc4ac1...` (homelab `948113b`,
after intermediate digests `1dae111b`/`a9e83386`). Read-only verification:
`/health/ready` 200; new v2 endpoints live (`/config/sources` returns
`{success:true,data:[]}`, `/config/helpers` 200); 36 routines all v1 (0 with
`semantics_version=2`, 33 enabled); diagnostics only pre-existing warnings
(2 `empty_group`, 5 `unresolved_active_scene`); 80 devices, 18 scenes, 14
integrations resolve. Worker spawn/timeout log check still pending (needs
cluster access). **Stage 1 soak before Stage 3.**

**Stage 2 done (2026-09-21, read-only).** Dry run from the workstation with
the rebuilt debug binary against `$DATABASE_URL`: total 36, converted 31,
needs_manual 0, unsupported 5 (`entryway`, `entryway_dark`,
`kids_room_bed_toggle` disabled, `kids_room_randomize_innolux_on_down`,
`kids_room_randomize_lamp_on_up`), already_v2 0, cron_total 0,
`disable_integrations` empty, `entryway_timer` inventory note "partially
converted or still referenced; this run does not modify it". Report saved to
`/tmp/opencode/convert-dry-run.json`. Because nothing gets disabled and no
cron rows exist, an image-only revert to `4923f59e` remains a complete
behavioral rollback after Stage 4. Post-Stage-1 rollback image options are now:
(a) revert digest to `4923f59e` (pre-v2 code runs converted rows as v1 via
preserved `rules`/`actions`), or (b) keep the v2 image and use
`convert --restore` on the archive.

**Stage 2 — dry run.**
`homectl-server convert --source-db "$DATABASE_URL" --json` from this
workstation (read-only; safe while the server runs). Expect 31 converted /
0 needs-manual / 5 unsupported, and `entryway_timer` listed as still
referenced. Re-check after any new routine authoring.

**Stage 3 done (2026-09-21).** Computed source `circadian` created via the API
(`PUT /config/sources/circadian`) with the legacy `circadian` integration's
params (04:00/4h h35 s0.2 b1.0, 18:00/3h h27 s0.9 b0.5, Europe/Helsinki,
60s, aliases `["circadian/color"]`). Preview at 12:00 matched the live
`circadian/color` device exactly (h35 s0.2 b1.0, transition 60s), and the
computed device `computed/circadian` published the same state. All three
circadian integrations were then disabled (devices disappear on disable).
Runtime alias resolution was verified over the websocket snapshot: scene
`normal`'s linked target resolves to the computed color through the
`circadian/color` alias. Disabling surfaced 7 `missing_device_link`
warnings because the diagnostics check used the raw device map; fixed in
`acc195bf` with an alias-aware `resolve_snapshot_device_key` (also applied to
group membership and scene targets, plus a regression test). Deployed as
`418ba169` (homelab `e275c74`); prod diagnostics are back to the pre-existing
2 `empty_group` + 5 `unresolved_active_scene` warnings only. Also fixed a
parallel-test flake in `routine_history` (`4c1453db`) exposed by the new
event-level tests.

**Stage 3 — circadian to computed source (independent of routine conversion).**
Create computed source `circadian` with the integration's params
(04:00/4h h35 s0.2 b1.0, 18:00/3h h27 s0.9 b0.5, Europe/Helsinki, 60s
refresh) and aliases `["circadian/color"]`; verify the Preview tab against
the live `circadian/color` device value and that scenes `normal`,
`kids_room_normal`, `patio_normal` still resolve. Then disable (or delete)
the three circadian integrations; `circadian_lifx_hsv` and
`circadian_tuya_hsv` are unreferenced and can go immediately. Rollback:
re-enable the integrations and delete the source.

**Stage 4 — routine conversion (the only stop-the-world step).**
Stop the deployment (scale to 0; Flux must not fight the change), then run
`homectl-server convert --source-db "$DATABASE_URL" --apply --force
--archive ~/backups/homectl/convert-archive-<ts>.json`, then start the
deployment. Converted rows keep their enabled flag, so the 29 enabled
routines go live with v2 semantics at restart; the 5 unsupported stay v1 and
keep running. Verify: all 36 rows load, config diagnostics clean, runtime
panel shows armed triggers, and spot-check `deactivate_nightlight`,
staircase/motion, and one schedule routine by observing real behavior.
Rollback: stop, `convert --restore <archive>`, start (routine rows only);
or full `pg_restore` of the Stage 0 dump plus restart.

**Stage 4 done (2026-09-21).** Pre-flight: fresh backup pair
`homectl-20260921T172119.dump` / `homectl-config-20260921T172119.json`
(chmod 600, verified), dry run re-check 31/0/5. Flux Kustomization `homectl`
suspended, deployment scaled to 0 (pods=0, `/health/ready` 503), then
`homectl-server convert --source-db "$DATABASE_URL" --apply --force
--archive ~/backups/homectl/convert-archive-20260921T172308.json`: 31 applied,
0 integrations disabled. Scaled back to 1, health 200, Flux unsuspended.
Verification: 36 routines (31 v2 + 5 v1, 33 enabled), config diagnostics clean,
logs only the pre-existing scene-state warnings. `armed=0` is expected: all
converted triggers are `report`/`predicate_*`; only timer/schedule wakeups arm
ahead of time. Live v2 runs observed within the hour (report triggers,
accepted, steps dispatched): `office_presence_on/off`, `office_on/off`,
`office_desk_lamp_toggle`, plus the Stage 5 cleanup routine. No v2 run has
produced an error, stale result, or contract rejection. Rollback unchanged:
image-only revert to `4923f59e` (old binary runs converted rows as v1 through
preserved `rules`/`actions`), `convert --restore` of the archive, or full
`pg_restore`.

**Stage 5 done (2026-09-21).** Authoring only; no code changes.
- `entryway_cooldown` boolean helper created via `PUT /config/helpers/:id`
  with `persistence: "session"` (process-lifetime, matching the v1 in-memory
  timer) and initial value false.
- `entryway_cooldown_clear` created via `POST /config/routines` (the `PUT`
  route is update-only): `predicate_for` on helper == true with
  `duration_ms: 300000`, program = one `set_helper false`. Verified live:
  helper set true at 17:29:24, the v2 run fired at +300.0s (trigger `t1`,
  accepted, one step dispatched), helper back to false. This is the first v2
  run recorded in production history and it exercises trigger arming,
  `predicate_for` maturity, dispatch, and the helper write.
- `leave_home` updated (revision 3): `replace_timer(entryway_timer, 300000)`
  -> `set_helper(entryway_cooldown, true)` -> `activate_scene leave`.
- `entryway` / `entryway_dark` replaced with v2: converted base plus
  `comparison(helper entryway_cooldown, eq, false)` inserted after the motion
  comparison; v1 `rules`/`actions` preserved on the row for rollback.
- `kids_room_bed_toggle` deleted (disabled, empty rules, inert).
- `kids_room_randomize_*` replaced with v2 script programs: `report` trigger
  on `zigbee2mqtt/0x001788010bd7e43a` plus `/value == down_press`/`up_press`,
  script gates on local hour 7-20 and emits `api.actions.randomizeColor`
  (`targets`, min 0.2, max 1.0, transition 250ms). The exact persisted bodies
  were executed through the real `script-worker`: daytime produced
  `randomize_color` for the right target device, nighttime an empty action
  list. Note the script ABI action shape is `targets.devices` /
  `transition_ms`; the runtime maps it to native `RandomizeColor` /
  `device_keys`.
- Verification note: there is no manual v2 trigger API (no routines trigger
  route; `POST /actions/trigger` replays v1 `actions`, which are empty on v2
  rows), so the scripts were verified offline through the real worker and the
  report-trigger + `/value` condition wiring through the already-live office
  routines. Final inventory: 36 routines, all v2, 34 enabled, diagnostics
  unchanged (2 `empty_group`, 5 `unresolved_active_scene`).

**Stage 6 done (2026-09-21).** `entryway_timer` integration disabled (row kept
for one-PUT reversibility) after confirming no scene, group, dashboard widget,
layout, display override, or sensor config references it, and that v2
`replace_timer` is a runtime-owned P10 named timer job, not an integration
call. The synthetic "Entryway timer" device disappeared from the device list;
logs show no new warnings. Rollback caveat: after this disable, an image-only
revert runs the v1 entryway rules without their timer guard, so re-enable the
integration first for a faithful v1 rollback (or use the archive/pg_restore
paths, which restore the row anyway).

**Stage 5 — author the 5 unsupported routines (step-5 recipes).**
Create the `entryway_cooldown` boolean helper (API today; helpers CRUD page
is a known gap), add the `entryway_cooldown_clear` predicate_for cleanup
routine, edit `leave_home` to set the helper, replace `entryway` and
`entryway_dark` with v2 versions, delete the disabled
`kids_room_bed_toggle`, and author the two `kids_room_randomize_*` script
programs (seeded Date + `api.actions.randomizeColor`). Verify each by manual
trigger before disabling its v1 original.

**Stage 6 — retire leftovers.**
Once no v1 routine reads it, disable/delete the `entryway_timer` integration.
Keep computed-source aliases until script/selector references are reviewed
(P17). Schedule P16/P17 work after a soak period.

**Open operational questions:** cluster access for the stop/start steps; who
watches the first hours; whether to raise CPU alongside memory for the 200ms
script budget.

### P12 UI polish slice 1: helpers management page

Commit: `feat(ui): add a helpers management page`.

- New `/config/helpers` page (Automation group) is the first-class surface
  for typed helper values: list with live value, kind, persistence, and
  hidden badges; search; create modal; per-helper editor with id/name, kind
  (boolean/enum/number/string) including enum option editing and number
  bounds, initial value, current value with an explicit Set (revision shown),
  persistence (durable/session), and delete.
- Values render live from the websocket `helper_statuses` payload with the
  REST list as the fallback, and writes go through the existing
  `PUT /helpers/:id/value`; the page mirrors the server's validation
  (non-empty id/name, enum options non-empty and unique, number bounds) and
  surfaces server errors.
- `hidden` now means something: the dashboard mode-widget helper picker
  filters hidden helpers out, matching the editor copy.
- Verified against a local server: create/update/value-write/delete
  round-trips, duplicate enum options rejected with the server message, and
  hidden/persistence/values reflected in the list. UI tsc/lint/build green.

### P12 UI polish slice 2: dashboard widget settings completeness

Commit: `feat(ui): finish dashboard widget settings`.

- The controls widget's group is now a select of configured groups instead of
  a free-text id, with "all controllable devices" as the empty option.
- The custom widget is no longer a dead end: it renders its `content` option
  in a sandboxed (`sandbox=""`) iframe with scripts disabled, and the settings
  overlay gained an HTML editor for it. The registry entry is renamed
  "Custom HTML" and documents the no-scripts behavior.
- Registry defaults were aligned with what the cards actually read: dropped
  never-read keys (`weather.location`/`units`, `sensors.indoorSensorIds`/
  `prioritySensorIds`, `spot_price.region`, `train_schedule.stationCode`) and
  added read-but-missing ones (`weather.showWidgetForecast`,
  `train_schedule.destination`/`directionId`/`maxMinutesAhead`/
  `displayLimit`/`scrollMore`). Existing rows are untouched; the Advanced
  JSON tab remains the escape hatch.
- UI tsc/lint/build green.

### P12 UI polish slice 3: routine editor v2 polish

Commit: `feat(ui): author dynamic scene selections and computed-source refs`.

- `activate_scene` dynamic selections are editable in the program builder:
  helper-enum mapping (enum-helper picker, one scene per option, fallback) and
  group-active mirroring (group picker, fallback), plus switching between a
  fixed scene and a dynamic selection in both directions. The step summary now
  names the helper/group instead of saying "dynamic scene selection".
- Computed-source conditions use a select of configured sources (disabled
  sources marked, stale ids preserved as an "unknown" option) instead of a
  free-text source id.
- ExecutionPolicy remains JSON-only: it is parsed and bounds-validated but not
  enforced by the runtime, so the editor deliberately exposes no controls for
  it. Enforcement (single/queued/restart, min_interval, queue bounds) is a
  separate server-side slice to plan with the user.
- Verified against a local server: a routine using the editor's helper-enum
  selection plus a computed-source condition round-trips through the config API
  and compiles while enabled. UI tsc/lint/build green.

### P12 UI polish slice 5: naming and discoverability

Commit: `feat(ui): clarify configuration naming and floorplan entry point`.

- The three "Settings" are disambiguated: the config hub and its navigation
  entry are "Configuration"/"Config", while `/config/settings` is "System"
  (appearance + core server settings) in both its header and its section card.
- The routines section description now uses v2 vocabulary (triggers,
  conditions, programs) and the keyword list includes "programs".
- The floorplan view options popover links to `/config/floorplan` ("Edit
  floorplan"), so the editor is reachable from the map.
- Calibration was left as-is: the device control sheet already links to the
  device's config tab where the wizard sits.
- UI tsc/lint/build green.

### P12 UI polish slice 4: v2 routine run history

Commit: `feat(server,ui): record and show v2 routine run history`.

- `RoutineHistoryEntry` gained a `v2_run` trigger kind and an optional
  `RoutineV2RuntimeStatus` snapshot (matched trigger ids, condition trace,
  trigger states, last run steps). v1 entries are unchanged.
- `Routines` keeps display names for compiled v2 rows and pushes a history
  entry after every run outcome (`record_v2_run` / `record_v2_script_failure`),
  so accepted native runs, script results, worker errors, stale results, and
  contract errors all appear. Only dispatched runs create entries, matching v1
  history semantics (a condition miss is not a run).
- The routine-history page renders v2 entries: trigger/condition/acceptance/
  drop badges, dispatched-step count, matched trigger ids, a recursive
  condition trace (truth, unknown reason, error), the planned step list with
  dispositions and reasons, and trigger states. The filter and stat cards
  include v2 runs.
- New bindings (`RoutineHistoryEntry`, `RoutineHistoryTriggerKind`) exported
  and added to `export_bindings.rs`.
- Verified live: a `state_change` v2 routine on a dummy sensor recorded
  `{triggers: ["sensor_change"], truth: "true", accepted, step dispatched}`
  and the target lamp turned on. 613 lib + 44 config_api tests green; clippy
  baseline unchanged (4 known warnings).
- E2E note for future manual testing: the config API device PUT produces
  Derived-origin frames, so `report` triggers do not fire from it; use
  `state_change` triggers or an integration report (e.g. dummy startup
  discovery) instead.

### P05 follow-up: ExecutionPolicy enforcement (plan §4.2)

Commit: `feat(server): enforce v2 execution policies`.

- The documented policy semantics are now enforced:
  - `single`: the script coordinator refuses a new invocation while one is
    pending or in flight (`CoalescePolicy::RejectIfBusy`), with a visible
    `execution_policy_single` admission reason.
  - `queued` (now the default): arrival-order queue up to the per-owner bound
    (8); overflow keeps rejecting visibly (`pending queue full`).
  - `restart`: `CoalescePolicy::LatestWins` supersedes pending handler
    invocations; superseded results surface as `StaleReason::Superseded`.
  - `min_interval_ms`: rejects re-invocations before planning or worker
    submission (`execution_policy_min_interval: Nms since the last
    invocation`); the acceptance time is noted only for admitted runs.
  - `max_actions`: a plan that would dispatch more steps than the bound is
    rejected as a whole (`accepted: false`, every step suppressed with
    `execution_policy_max_actions`), so an over-budget run never publishes a
    partial effect set.
- `ExecutionMode::default()` changed from `single` to `queued` per plan §4.2.
  The converter raises `max_actions` to the converted program's step count
  (capped at the compile-time limit of 64) so the bound never truncates
  existing behavior.
- Native programs dispatch synchronously inside the actor frame, so their mode
  has no pending invocation to serialize: mode applies to script programs,
  while `min_interval_ms`/`max_actions` apply to both. Rejections appear in
  `last_run` and the v2 run history.
- Tests: coordinator busy rejection, mode mapping, min-interval gate, and
  actor-level `max_actions`/`min_interval` rejection. 618 lib + 44 config_api
  green; clippy baseline unchanged.
- Live check: `max_actions: 1` rejected a two-step plan with the target lamp
  unchanged; `min_interval_ms: 60000` rejected a rapid re-invocation with the
  reason visible in routine history.
- UI: the routine editor's Program tab now has an "Execution" section
  (`RoutineExecutionPolicyEditor`) for mode, max actions (clamped 1-64), and an
  optional minimum spacing, with a create-time validation for JSON drafts.
