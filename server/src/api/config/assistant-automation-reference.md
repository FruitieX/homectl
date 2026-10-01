Automation authoring reference (current server contracts)

Choose a native flow for ordinary logic. Reuse existing action/condition blocks and
functions whose documented behavior and inputs fit; do not substitute unrelated
entities. Put custom JavaScript in a run_script step or a named block while keeping
surrounding native steps. Use a whole script program only when that is clearer.
Use computed helpers for persistent derived sensor state or script-derived triggers.
Create a new reusable block when requested or when it removes meaningful repetition,
not for every trivial step. Name inputs, describe intent and handle missing data.
Catalog signatures include input defaults/output/dependencies. bodyOmitted means
implementation is too large for the summary; do not invent it when editing.
Ask the user to attach that block to include its full body.

RoutineDefinitionV2:
{"triggers":[TRIGGER],"condition":CONDITION,"program":PROGRAM,"execution":{"mode":"queued","max_actions":16}}
- 1..16 triggers; condition optional (defaults true); program required.
- execution modes single, queued (default), restart; optional min_interval_ms.
- Every trigger, step and Choose branch has a stable unique id within its routine.
- Defaults and execution policies should match event frequency and intended behavior.

Triggers (each has id):
- {"kind":"report","id":"t1","device":DEVICE_REF}: every report, even unchanged;
  optional field filters a report field (e.g. "action"). Use this for repeated
  button payloads; gate with a comparison of the normalized /value to "single"/"double" etc.
- {"kind":"state_change","id":"t1","device":DEVICE_REF,"mode":"transition"}: known false -> true
  active/power edge; mode level fires for matching active reports. It is not a
  generic change trigger for arbitrary numeric or string values; use report +
  condition or predicate_transition for those.
- {"kind":"predicate_transition","id":"t1","predicate":CONDITION}: known false -> known true.
- {"kind":"predicate_for","id":"t1","predicate":CONDITION,"duration_ms":300000}: continuously true.
- {"kind":"schedule","id":"t1","schedule":{"cron":"0 0 7 * * *","timezone":"Europe/Helsinki"}}.
  Use catalog timezone and six-field cron (seconds first). Alternatively every_ms
  for periodic intervals. backlog defaults skip; catch_up_once also needs
  catch_up_lateness_ms. Choose explicitly when missed runs matter.
- {"kind":"timer_fired","id":"t1","timer":"timer-id"}.
- {"kind":"startup","id":"t1"}: startup seeding marker, not an effectful boot
  automation. {"kind":"manual","id":"t1"}: explicit invocation only.
- Script conditions/JavaScript condition blocks cannot be predicate_transition or
  predicate_for triggers. Compute a helper then compare it using native predicates.

Conditions (three-valued; missing/stale input is unknown, not false):
- {"kind":"literal","value":true}.
- {"kind":"all","conditions":[CONDITION]}; {"kind":"any","conditions":[CONDITION]}.
- {"kind":"not","condition":CONDITION}.
- {"kind":"comparison","source":VALUE_SOURCE,"operator":"eq","value":true}.
  Operators eq, ne, gt, gte, lt, lte, contains, starts_with, exists, truthy, regex.
- {"kind":"group","group_id":"id","quantifier":"any","power":true}.
  Quantifiers all, any, none, partial; optional scene.
- {"kind":"block","block_id":"condition-block-id","inputs":{"namedInput":VALUE}}.
- {"kind":"script","spec":SCRIPT_SPEC}: in Only if or Choose; strict boolean/unknown.

VALUE_SOURCE:
- {"kind":"device","device":DEVICE_REF,"path":"/value"}: sensor value; use actual
  catalog paths; text/action buttons use normalized /value (e.g. "single").
  Raw MQTT property names are not automatically condition paths.
- {"kind":"device","device":DEVICE_REF,"path":"/power"}: controllable state.
- {"kind":"helper","helper":"helper-id"}.
- {"kind":"computed_source","source":"source-id","path":"/value"}.
DEVICE_REF: {"integration_id":"integration-id","device_id":"device-id"}, copied from catalog.
TARGETS: {"devices":[DEVICE_REF],"groups":["group-id"]} (either list optional).

PROGRAM: {"kind":"native","steps":[STEP]}.
Native steps (each has id):
- {"action":"activate_scene","id":"a1","scene_id":"scene-id","targets":TARGETS}.
  Empty targets use the scene's targets. Optional transition_ms, use_scene_transition
  (true by default), rollout. For explicit transition overrides set
  use_scene_transition:false. Exactly one of scene_id or select:
  select={"kind":"helper_enum","helper":"enum-helper","mapping":{"home":"scene-id"},"fallback_scene_id":"fallback-id"}
  or {"kind":"group_active","group_id":"group-id","fallback_scene_id":"fallback-id"}.
  rollout={"style":"spatial","duration_ms":2000,"source":{"kind":"triggering_device"}}
  or source={"kind":"device","device":DEVICE_REF}; duration_ms 0..600000.
- {"action":"cycle_scenes","id":"a1","scenes":[{"scene_id":"scene-id","targets":TARGETS}],"nowrap":false}.
  Optional detection TARGETS and rollout; each scene can override transitions.
- {"action":"set_power","id":"a1","device":DEVICE_REF,"power":true}.
- {"action":"dim","id":"a1","targets":TARGETS,"step":0.1}: relative step -1..1, optional transition_ms.
- {"action":"randomize_color","id":"a1","targets":TARGETS}: optional min_saturation,
  max_saturation (0..1), transition_ms.
- {"action":"choose","id":"a1","branches":[{"id":"b1","condition":CONDITION,"steps":[STEP]}]}.
  Ordered first match; unknown blocks selection. Add a final literal true branch for otherwise.
- {"action":"schedule_timer","id":"a1","timer":"timer-id","delay_ms":300000}.
- {"action":"replace_timer","id":"a1","timer":"timer-id","delay_ms":300000}.
  Timers belong to the caller; optional capture_target_intents TARGETS prevents
  delayed effects overwriting newer manual adjustments. pair with timer_fired.
- {"action":"cancel_timer","id":"a1","timer":"timer-id"}.
- {"action":"set_helper","id":"a1","helper":"manual-helper-id","value":true}.
  Never write a computed helper, even when its computation is disabled.
- {"action":"invoke_routine","id":"a1","routine_id":"routine-id","mode":"fire_and_forget"}.
  mode can be await_completion.
- {"action":"call_block","id":"a1","block_id":"action-block-id","inputs":{"namedInput":VALUE}}.
- {"action":"run_script","id":"a1","spec":SCRIPT_SPEC}.

Reusable block (assistant operation kind="block"; body.kind is distinct from block.kind):
{"id":"id","name":"name","description":"intent","kind":"action|condition|function","inputs":{"name":{"label":"Label","kind":{"kind":"number"},"default":0.1}},"body":BODY}
- revision is server-owned; omit it on create/update.
- Input kinds group, scene, helper, device, targets, rollout, boolean, number,
  duration (integer ms), string, json, enum (with options). Defaults optional;
  every required input must be supplied and match its kind. At most 16 inputs.
- Visual action BODY is [STEP]; visual condition BODY is CONDITION.
- A whole template value {"$input":"name"} binds an input, for example
  [{"action":"set_power","id":"power","device":{"$input":"light"},"power":{"$input":"power"}}].
  Never interpolate $input inside JavaScript strings; scripts read inputs.name.
- Keep timer actions and invoke_routine in the calling routine, not visual blocks.
- JavaScript BODY={"kind":"javascript","spec":SCRIPT_SPEC} for action/condition.
- Function BODY adds "output":{"kind":"number"} (same kinds as inputs).
  Functions always use JavaScript; function spec.declarations must be empty.
- Calls must use the right block kind. Shared edits revalidate existing enabled
  callers; preserve input compatibility or update callers before breaking changes.
  Blocks in use cannot be deleted; remove callers first.

SCRIPT_SPEC:
{"api_version":1,"source_body":"return { actions: [] };","declarations":[],"functions":[],"inputs":{},"limits_profile":"default"}
- source_body is a JavaScript function body, not a JSON/stringified result or module.
- declarations: {"kind":"device","device":DEVICE_REF}, {"kind":"group","group_id":"id"},
  {"kind":"timer","timer":"id"}; broad {"kind":"all_state"} only when genuinely needed.
- Explicit device/group/targets block arguments add their state dependencies.
- functions lists fixed IDs of JavaScript FUNCTION blocks, not action/condition
  blocks. api.functions.call("id", {namedInputs}) uses typed inputs/defaults and
  returns declared output. Functions can declare their own functions; no cycles,
  max 16 direct / 32 resolved dependencies / 8 levels. No undeclared dynamic calls.
- inputs and ctx are frozen data. Functions inherit the caller's context and
  cannot grant more access, install listeners or maintain global memory.
- Actions return {actions:[nativeAction,...],next_state?:JSON}, never a bare array.
  Builders return data; they don't command hardware. Never return run_script.
- Conditions return exactly true, false or api.unknown("reason"); not truthy values,
  action objects or next_state. api.not preserves unknown; JS ! does not.
- Functions/computed helpers return the typed value directly, not {value:...}.
- Bounded synchronous pure JavaScript only: no fetch, MQTT, filesystem, DB,
  process/env, imports, promises or browser timers. Use native timers/schedules.
- api.now is an injected timestamp in ms (not a function); api.random() is seeded.
- api.values.get("helper-id") returns {kind,value} or undefined for missing/stale.
  api.values.requireEnum(id) returns a known enum string or throws.
- Routine ctx.before.devices / ctx.after.devices map full integration/device keys
  to captured device JSON: data.Sensor has sensor fields; data.Controllable.state
  has power/brightness/color. ctx.event.mutations lists before/after device changes.
  Handle absent device/value; never read imaginary ctx.devices or mutable globals.
- ctx.state.memory is previous per-call-site memory; next_state replaces it.
- JS builders: api.actions.setPower({id,device,power});
  api.actions.dim({id,targets,step,transitionMs});
  api.actions.activateScene({id,scene,targets,select,rollout});
  api.actions.randomizeColor({id,targets,minSaturation,maxSaturation,transitionMs}).
  Note camelCase builder arguments vs snake_case native JSON. For options a
  builder does not expose, return the validated native action JSON directly.

Example FUNCTION block:
{"id":"scaled_step","name":"Scaled dim step","kind":"function","inputs":{"value":{"label":"Value","kind":{"kind":"number"}},"factor":{"label":"Factor","kind":{"kind":"number"},"default":2}},"body":{"kind":"javascript","output":{"kind":"number"},"spec":{"api_version":1,"source_body":"return inputs.value * inputs.factor;","functions":[],"declarations":[],"limits_profile":"default"}}}
Example ACTION block using that function (create function before caller):
{"id":"dim_room","name":"Dim room","kind":"action","inputs":{"room":{"label":"Room","kind":{"kind":"group"}},"step":{"label":"Step","kind":{"kind":"number"},"default":0.1}},"body":{"kind":"javascript","spec":{"api_version":1,"source_body":"const step = api.functions.call('scaled_step', {value: inputs.step}); return {actions: [api.actions.dim({targets:{groups:[inputs.room]}, step})]};","functions":["scaled_step"],"declarations":[],"limits_profile":"default"}}}
Example CONDITION script using a helper:
const occupancy = api.values.get("occupied");
if (!occupancy) return api.unknown("Occupancy unavailable");
return occupancy.value === true;

Computed helper extends the ordinary Helper entity with:
"compute":{"script":SCRIPT_SPEC,"helpers":["dependency-helper-id"],"refresh_ms":60000,"enabled":true}
- helper kind boolean/string/enum(options)/number(optional min/max); initial_value
  must match. persistence durable (default) or session; compute revision server-owned.
- compute.helpers explicitly lists every helper read through api.values;
  device/group reads use script.declarations. Dependencies must exist; no cycles.
- Return the helper's typed value directly. Missing dependencies should fail or
  return a deliberate valid fallback, never silently claim a healthy reading.
- Recomputes when inputs change and at cadence, with no browser open.
  refresh_ms 1000..86400000. Initial fallback is unknown until first success;
  fresh/updating usable, pending/stale/disabled unknown. Last-good value retained.
- Computed helpers are read-only even when disabled. Use native helper comparisons
  for their transition/held-for triggers; use manual helpers for writable memory.

Computed light-profile source:
{"id":"id","name":"name","enabled":true,"timezone":"Europe/Helsinki","refresh_interval_ms":60000,"compute":{"kind":"script","source_body":"return {value:{brightness:0.5,color:api.color.kelvin(3000)}};","functions":[],"params":{}}}
- Either script source_body or pinned preset {id,version}; never both.
- Script returns {value:{color?,brightness?,transition_ms?},next_state?:JSON}.
- Pure time/parameter context: ctx.params, ctx.local, api.time.minutes(),
  api.time.parseHHMM(), api.time.lerp(), api.color.kelvin/hs/mix. No live device or
  helper context; imported functions do not widen it. Use computed helpers for
  sensor-derived state. Color temperature in Kelvin, brightness/saturation 0..1.
- Native circadian_compat is also available with preset_version:1 and params
  day_fade_start/night_fade_start HH:MM, day_fade_duration_hours/
  night_fade_duration_hours, day_color/night_color, optional day_brightness/
  night_brightness. Durations positive; no overlapping/cross-midnight fades.
