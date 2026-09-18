# ADR 0003: Conditions, unknowns/errors, and group semantics

Status: accepted target design (P00). Not yet implemented.

## Condition model

Use a tagged `ConditionExpr` with `Literal`, `All`, `Any`, `Not`, native
predicates, and `ScriptCondition`. Supply stable node IDs for tracing. Reject
empty `All`/`Any` in stored v2 definitions; an omitted routine condition
normalizes to `Literal(true)`.

Truth tables use strong three-valued logic:

| Expression | Result |
|---|---|
| `not true`, `not false`, `not unknown` | false, true, unknown |
| `all(false, unknown)` | false |
| `all(true, unknown)` | unknown |
| `any(true, unknown)` | true |
| `any(false, unknown)` | unknown |

For the first implementation, evaluate all nodes of an eligible condition tree
to produce a complete trace. Any evaluated error makes the condition evaluation
an error and prevents execution, even when a sibling would decide the result. Do
not convert a script error into false and then let `not` turn it into true. If
short-circuit evaluation is later introduced, it requires an explicit semantics
review and `not_evaluated` trace nodes.

Provide explicit `entity_exists`, `has_report`, `field_exists`, `is_known`, and
availability/freshness predicates. Do not make `not(power == true)` the way to
test existence or availability.

Unknown reasons are structured: `missing_entity`, `missing_field`, `offline`,
`stale`, `empty_selection`, `not_initialized`, `unknown_source_value`. A
reference known invalid at save time is a validation error; an entity that
disappears after save becomes a runtime unknown.

Native observed-state predicates use actual report/evidence metadata. An
explicitly offline source makes observed current-state claims unknown. A fresh
report needs no separate online flag to be usable. Optional per-source
`max_age_ms` controls staleness; there is no single global timeout. When
freshness affects transitions, schedule an expiry dependency event.

## Group semantics

Build membership from configured references, recursively flattened and
deduplicated, **including unresolved configured members**. Detect cycles at
save/import time. Membership changes increment a group-definition revision.

`GroupEvaluation`:

`configured_count, true_count, false_count, unknown_count, members[], truth, reasons[]`

- `all`: false if any member is known false; true if all known true; else unknown.
- `any`: true if any member known true; false if all known false; else unknown.
- `partial`: true if at least one known match and one known non-match exist;
  false if all members are known and no such mixture exists, or fewer than two
  members selected; else unknown.
- Empty selection is unknown for automation group predicates, including `any`;
  it must not let a negated predicate succeed.
- The default selector means all configured members. "Available members only"
  must be explicitly selected and displayed; never filter implicitly.

Expose requested mode, common assigned scene, and observation quality
separately. A group common-scene summary is `uniform(scene_id)`, `unassigned`,
`mixed`, or `unknown`, with member details. Do not infer intent from a majority
or first device.
