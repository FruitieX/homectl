# Rule model design review request

Status: request for a second opinion. **Analysis only — do not modify code.**
Written 2026-09-18 against `main` @ `5aef129c`. Local uncommitted files at the
time of writing: `docs/automation-plan.md`, `docs/rule-model-review.md`.

## What I want reviewed

The routine/rule model in homectl has become hard to reason about as automation
logic grew. I have a tentative direction (split triggers from conditions, fix
group semantics, make scripting first-class) but I want an independent read on:

1. whether the proposed direction is right, over/under-scoped, or unnecessary;
2. what the minimal, highest-leverage server changes are;
3. how to migrate the ~35 existing DB-stored routines without breaking semantics;
4. whether the scripting escape hatch is the right investment or a trap.

Please produce a design memo with a recommended sequence, tradeoffs, migration
notes, and concrete file/line references. Do not implement anything.

## Project context

homectl is a Rust home-automation server (warp, tokio, SeaORM, SQLite/Postgres)
with a Vite/React UI. It unifies Zigbee2MQTT, ESPHome, MQTT, circadian, cron,
timer, and dummy integrations. `AGENTS.md` at the repo root is authoritative for
architecture; key points relevant here:

- `AppState` is owned by a single **state actor** task. Non-actor code uses
  `StateHandle` (`send_event` / `mutate`). Readers use an `ArcSwap` snapshot.
- Per-integration actors own integrations; outbound device updates are paced
  (`outbound_device_updates.min_interval_ms`, live value 100 ms for Z2M) and
  coalesced per device.
- The database is the canonical store for runtime configuration. `Settings.toml`
  is bootstrap only.
- ts-rs generates UI bindings.
- Scripts (Boa JS) execute **synchronously inside the state actor** during rule
  and scene evaluation. `docs/backend-review.md` (sections 4, 6, 7) already
  flags missing execution explanations, unbounded queues, and script limits.

Scale: ~46 Zigbee devices, ~31 routines, ~18 scenes, many dimmer switches.

## Current rule model (as implemented)

Types in `server/src/types/rule.rs`:

- `Rule` is an untagged enum: `Sensor`, `Raw`, `Device`, `Group`, `Any`,
  `EvalExpr` (legacy, rejected at runtime), `Script`.
- Each rule type computes `condition_match` and `trigger_match`.
- `SensorRule` trigger mode defaults to `pulse`; `RawRule` to `pulse`;
  `DeviceRule` and `GroupRule` default to `level`; `ScriptRule` has **no**
  `trigger_mode` at all.
- `AnyRule { any: Vec<Rule> }` combines children with
  `RuleRuntimeStatus::from_children(any(condition), any(trigger), children)`.
- `ScriptRule { script: String }` is evaluated as a JS expression returning
  truthy; `RuleRuntimeStatus::from_match(result, result)` makes it both
  condition and trigger.

Evaluation in `server/src/core/routines.rs`:

- `handle_internal_state_update` evaluates **all routines on every internal
  state update** (`~250-279`), sending matched actions to the event queue.
- `evaluate_routine_status` requires all rules' `trigger_match`; a routine fires
  when every rule triggers. There is no built-in `not`.
- Sensor/raw/device evaluation: `431-641`; group evaluation: `643-701`.
- `check_device_state_matches` (`704-718`) is the shared predicate:
  - `scene` matches only if the device's `scene_id` equals exactly;
  - `power` compares against `is_powered_on()` (always known for controllable
    devices; stale last-known value if offline);
  - `GroupRule` applies this with `.all()` over group members (`657-659`), so a
    group `scene` requires **unanimity across every device in the group** and
    `power: false` means every device known-off.
- `Rule::Script` constructs a fresh `ScriptEngine` per evaluation (`419-423`).

Scripting context in `server/src/core/scripting.rs`:

- `devices` global: `device_key -> Device` JSON (includes
  `data.Controllable.scene_id`, `data.Controllable.state`).
- `groups` global: `group_id -> { name, power, scene_id }` where `power` means
  "all devices on" and `scene_id` is the common scene if unanimous (`79-120`).
  **No membership (`device_keys`) is exposed.**
- Helpers loaded globally: `defineSceneScript`, `deviceState`, `deviceLink`,
  `sceneLink` (`13-18`). No rule-specific helpers.
- Limits: loop iterations, recursion, stack, input/context/result sizes.
- Scene scripts get dependency extraction from literal bracket access
  (`server/src/core/scenes.rs:26`, used at `1090`). **Rule scripts get no
  dependency tracking.**

API/UI:

- `validate_routine_actions` (`server/src/api/config.rs:674`) validates actions;
  rule scripts are not syntax-checked or linted on save.
- Runtime script errors are logged and stored in routine status
  (`routines.rs:381-384`), but do not block saving and may be easy to miss.
- UI editor: `ui/ui/RuleBuilder.tsx` (rule type switcher, trigger mode selects,
  plain textarea script editor). Its new-script default text is
  `// Return true to trigger\nreturn true;`, which is not valid as evaluated
  (the engine evaluates expressions, e.g. IIFEs, not top-level `return`).

Actions (`server/src/types/action.rs`) are static per routine:
`ActivateScene`, `CycleScenes`, `Dim`, `Custom`, `ForceTriggerRoutine`,
`SetDeviceState`, `RandomizeColor`. There is no conditional action, no
"copy/mirror scene", no scripting at the action layer.

## Case study that motivated this

The staircase motion routines originally gated downstairs lighting on "all
bedroom devices have scene X". Group unanimity plus manual scene clearing plus
mixed scene cycles (different dimmer routines cycle the same devices through
different scene lists) meant the routine silently did nothing in common
situations. Live state at one point: all bedroom devices had scene `leave` from
`leave_home`, so neither the `normal` nor the `dark` downstairs routine matched.

The current (live, manually applied) fix uses one motion sensor rule + one group
off rule + a `ScriptRule` per outcome:

```json
// staircase_downstairs (normal)
rules: [
  { "device_id": "0x0017880106f7ce01", "integration_id": "zigbee2mqtt",
    "state": { "value": true } },
  { "group_id": "downstairs", "power": false },
  { "script": "(function() { var s = groups[\"staircase\"] && groups[\"staircase\"].scene_id; return s === \"normal\"; })()" }
]
```

Three routines exist for `normal`, `dark`/`night`, and `bright`. Two honest
observations from doing this:

- The scripts are **less** simple and less verifiable than native
  `DeviceRule { scene: "normal" }` plus `AnyRule [DeviceRule(dark),
  DeviceRule(night)]`, which the engine already supports (`routines.rs:583-641`,
  `396-407`). Scripts here add a JS runtime, no validation, no dependency
  tracking, and a per-evaluation engine construction.
- Even native rules cannot express "copy the source scene" without N routines
  because actions are static. A `MirrorScene`/`CopyScene` domain action would
  collapse this to one routine.

## Tentative direction (for critique)

1. **Split routines into `triggers` and `conditions`.** Triggers are event
   sources (sensor pulse/edge, raw value, timer, schedule) and answer "what
   starts this". Conditions are predicates (device, group, script, time) and
   answer "what must be true". This removes per-rule `trigger_mode`, removes the
   trigger half of `AnyRule`, and makes `all`/`not` natural.
2. **Fix group conditions.** Add explicit matching modes (`all`/`any`/`mixed`)
   and/or states (`off`/`on`/`partial`), and/or a representative-device
   selector, instead of unanimous scene matching being the only behavior.
3. **Make scripting first-class if it is the intended escape hatch.** Minimal
   support: expose group membership and richer state; provide helpers
   (`sceneOf`, `isOff`, `groupAllOff`, time/sun); validate/lint on save and
   surface errors in the UI; declare or infer dependencies; compile/cache
   scripts instead of constructing an engine per evaluation; optionally allow a
   script as trigger or condition.
4. **Add a scene-mirroring action** so "apply the same scene as device/group X"
   is one declarative action with rollout.
5. **Add dry-run/preview**: evaluate a routine against current (or recorded)
   state and show which triggers/conditions matched, for authoring and debugging.

## Questions for the reviewer

1. Is the trigger/condition split the right model? What are the alternatives
   (e.g. keep a single tree but add proper boolean operators; an expression
   language only; event-sourced triggers)? What would migration of 35 routines
   and the DB schema look like, and should old rules be normalized at load time
   or in a migration?
2. Group semantics: keep unanimity but add modes, or deprecate group scene
   conditions in favor of representative `DeviceRule`s? What does "group scene"
   mean conceptually for a group with mixed/manual devices, and should the
   system own that concept (e.g. an explicit group scene state) instead of
   deriving it?
3. Scripting: is Boa-in-the-actor the right escape hatch, or should native rule
   coverage be expanded until scripts are rare? What is the minimum viable
   server support if scripts stay (context shape, validation, dependencies,
   caching)? Note the actor is single-threaded and scripts run synchronously.
4. Actions: is `MirrorScene` worth adding, or should actions become conditional
   / scriptable? Where should "which scene should this trigger" live — rules,
   actions, or the scene engine?
5. Evaluation: with all routines evaluated on every update, what is the right
   approach (dependency metadata per rule, dirty sets, batching) and how should
   that interact with the actor and the `ArcSwap` snapshot? Any concrete
   measurements or failure modes to watch for?
6. What should be done now for the user's actual pain points (brittle
   conditions, night downstairs fetch, lights left on) versus deferred? Is
   anything in my list over-engineering?
7. Anything important I have missed in this framing?

## Deliverable

A design memo in markdown with:

- a recommended target model and why,
- explicit tradeoffs and rejected alternatives,
- a migration plan for existing routines/config (DB canonical) and UI,
- a ranked sequence of changes (impact vs effort),
- open questions and risks,
- exact file/line references supporting the analysis.

Do not modify code. If useful, small illustrative type sketches are fine.

## Relevant files

- `server/src/types/rule.rs` (rule/trigger model)
- `server/src/types/action.rs` (actions)
- `server/src/core/routines.rs` (evaluation)
- `server/src/core/scripting.rs` (Boa engine, context, limits)
- `server/src/core/scenes.rs` (scene resolution, script dependency extraction)
- `server/src/api/config.rs` (validation, `validate_routine_actions`)
- `server/src/core/simulate.rs` (CLI simulation mode)
- `ui/ui/RuleBuilder.tsx`, `ui/ui/routine-summary.tsx` (authoring/UI)
- `docs/backend-review.md` (sections 4, 6, 7)
- `docs/automation-plan.md` (section 6 summarizes this request)
