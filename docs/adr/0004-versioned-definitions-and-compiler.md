# ADR 0004: Versioned definitions, compiler, and persistence

Status: accepted target design (P00). Not yet implemented.

## Definitions

The external routine record is metadata plus a versioned definition:

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

`semantics_version` is authoritative. Unknown versions are rejected/quarantined,
never interpreted as v1. V2 IDs are stable identifiers; rename display labels
without rewriting IDs. Preserve existing v1 rename APIs during compatibility.

`NativeProgram` is a bounded sequence of typed actions including ordered
`choose`, schedule/replace/cancel timer, helper-value changes, and explicit
routine invocation. A preceding unknown/error blocks `choose` selection by
default.

`ScriptProgram` references `ScriptSpec { api_version, source_body, declarations,
limits_profile }`. Start with function-body source so `return` is unambiguous.
Existing top-level expression scripts remain a separately identified v1 format.

## Shared compiler

`compile(definition, ConfigCatalog) -> CompiledDefinition | ValidationReport`

Returns normalized tagged data, resolved typed references, trigger
subscriptions, resource dependencies, write capabilities, source locations/node
IDs, and a definition fingerprint. JavaScript syntax compilation happens in a
worker, not the state actor. Only a completed validated result may be enabled.

The compiler is used by save, enable, import, runtime load, simulation,
reference inventory, and migration analysis. Regex/JSON-pointer syntax is
validated once. Script dependency inference may suggest but must not be the sole
scheduling authority.

Validation errors contain `{path, node_id?, code, message, related_entity?}`.
Reject malformed JSON, ambiguous tags, unknown enum variants, duplicate IDs,
missing action arguments, invalid durations, nonfinite/out-of-range values,
incompatible capabilities, group/scene/source cycles, invalid timezone/cron
expressions, unauthorized script commands, and impossible output schemas. A
draft may be saved only as explicitly invalid and disabled; enabling requires
successful validation. Disabled definitions remain inspectable and included in
dependency inventories.

## Persistence

Use the active SeaORM migration registry, not only the retained legacy SQL
directory. Only create tables when the corresponding work package needs them; do
not build a generic EAV framework. User-editable definitions, helper values,
source parameters, scripts, and schedules belong in the DB, not `Settings.toml`.

Configuration exports include definitions, scripts, parameters, compatibility
mappings, and an explicit policy for durable helper values. They exclude live
jobs, VM state, and occurrence cursors by default. Restoring a backup must not
replay old timers or actions. DB-unavailable behavior must be explicit and
observable; durable-only operations fail without effects, and durable writes are
never reported as persisted when they were not.
