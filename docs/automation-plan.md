# Home automation planning notes

Running list of deferred or separate work items. Items marked **landed** are
documented for context only. No changes described here are implemented yet
unless explicitly marked otherwise.

## Landed (context)

- Scene-activation transition default: `core.scene_transition_ms` now applies to
  routine `ActivateScene`/`CycleScenes` actions (1000 ms live) with precedence
  explicit action transition > scene-stored transition > global default >
  integration default.
- Staircase motion downstairs now keys off the **staircase lamp scene** instead of
  the bedroom group scene: `normal` -> `normal`, `dark`/`night` -> `dark`,
  `bright` -> `bright` (new `staircase_downstairs_bright`); any other/unset scene
  does nothing. Downstairs group must still be all off.
- Color drift loop: Zigbee2MQTT color commands are emitted as CIE 1931 xy when the
  device supports xy, comparisons use CIE 1976 u'v' distance, and drift corrections
  are deferred while a requested transition is in flight.

## 1. Bright scene during daytime

The staircase switch cycle can select `bright`, but during the day the circadian
lights are already at maximum, so `bright` is effectively a no-op.

Open questions / options:

- Where should the suppression live: the `bright` scene (skip when the circadian
  device is at max brightness) or the switch cycles (staircase/office/kids)?
- `CycleScenes` cannot conditionally skip an entry, so cycle-level suppression
  requires either fixed `ActivateScene` actions with script conditions or a
  different cycle mechanism.
- A scene-level script would affect every room that uses `bright`.
- Consider an explicit "daytime" signal instead of inferring from circadian
  brightness, e.g. illuminance sensor or time of day.

## 2. Mirror the staircase-scene copy upstairs

`staircase_upstairs` still uses `upstairs` + `kids_room` all-off -> always
`normal` + `kids_room_normal`. It does not copy the staircase lamp scene.

Open questions:

- Should upstairs copy `normal`/`dark`/`bright` the same way as downstairs?
- Kids room mapping per scene is unresolved: `dark`/`night` -> `kids_room_dark`,
  and `bright` -> `kids_room_normal` or full `bright`?
- Keep or relax the current upstairs/kids-room all-off gating.

## 3. Turn downstairs off again after a night fetch

Downstairs lights are frequently left on after fetching something during the
night. Needs a separate auto-off or reminder mechanism.

Options to evaluate:

- Auto-off timer after the last staircase/downstairs motion.
- Turn downstairs off when the staircase lamp returns to `night`/`leave`.
- An explicit "good night" trigger to force the house to night state.
- Scope the night fetch scene to a path (entryway/kitchen) instead of the whole
  downstairs, which also reduces forgotten lights.

Related current behavior: staircase `night` -> `dark` downstairs (dim warm), which
is intended for fetching something; there is no automatic off afterwards.

## 4. Z2M migration to k8s + PoE coordinator

Retire the Pi Zero 2W and run Zigbee2MQTT in the homelab cluster with a
network/PoE coordinator.

Considerations:

- Moving the Z2M instance (copy `data/`) requires no re-pairing.
- Same adapter family (`zstack` -> `zstack`, or `ember` -> `ember`) requires no
  re-pairing; copy the IEEE address. Current coordinator is EmberZNet (EZSP).
- Ember -> Z-Stack (e.g. SLZB-06p7) is not officially supported: re-pairing might
  not be required but is not guaranteed; verify each device and re-pair failures.
- Keeping Ember on PoE (SLZB-06M / SLZB-06Mg24) is the low-risk migration.
- `adapter_concurrent` 4 and `transmit_power` were discussed; Z2M currently runs
  with `adapter_concurrent: 1` (user planned to try 4).

## 5. Ops: homectl config read consistency

`GET /api/v1/config/core` intermittently returned pre-write (stale) values after
successful PUTs while the integrations endpoint stayed consistent. Possible
stale replica or connection stickiness.

Open questions:

- Confirm the live deployment runs exactly one homectl pod/replica and no stale
  pod is still an endpoint.
- If multiple writers can exist, they may both consume MQTT and fight over state.

## 6. Rule model complexity and scripting support

Where the complexity comes from today:

- Triggers and conditions are conflated: every rule contributes both
  `condition_match` and `trigger_match`, and `trigger_mode` defaults differ per
  rule type (sensor/raw: pulse; device/group: level; script: none). It is hard to
  read a routine and know what event starts it versus what must be true.
- `GroupRule.scene` requires **every** device in the group to have the same
  scene, with no all/any/mixed option and no representative-device selector.
  This caused the bedroom fragility.
- Script rules are a half-integrated escape hatch: no trigger mode or event
  binding, `groups[id]` exposes only name/power/scene_id (no membership), no
  shared helpers, no save-time validation, no declared dependencies, and a new
  `ScriptEngine` is constructed per evaluation.
- Actions are static per routine, so "copy the source scene" needed three
  routines.

Proposed server support, roughly in priority order:

1. Split routines into `triggers` (event sources: sensor/raw/timer) and
   `conditions` (device/group/script predicates). Removes per-rule
   `trigger_mode` and AnyRule ambiguity for triggers; makes `not`/`all` natural.
2. Better group conditions: all/any/mixed matching, explicit off/on/mixed
   states, and/or a representative-device selector.
3. If scripting is the intended escape hatch, make it first-class:
   - expose group membership and per-device state (`groups[id].device_keys`,
     `devices` already present),
   - standard helpers (`sceneOf`, `isOff`, `groupAllOff`, time/sun if needed),
   - optional trigger/event binding for script rules,
   - validate/lint on save and surface evaluation errors in the UI,
   - declared/inferred dependencies and compiled-script caching.
4. Domain action for scene mirroring: `MirrorScene { source, target_group }`
   with rollout, so one routine can copy the staircase lamp's scene.
5. Dry-run/preview: evaluate a routine against current or recorded device states
   and show the condition/trigger breakdown.

Interim guidance:

- Prefer native `DeviceRule` + `AnyRule` over `ScriptRule` for simple predicates.
  The current staircase scripts are expressible natively and would be validated,
  cheaper, and dependency-tracked.
- Reserve scripts for time/math/multi-device/negation logic.
