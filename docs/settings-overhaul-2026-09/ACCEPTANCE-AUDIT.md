# Completion audit

Started 2026-09-30. This audits the full approved scope; it does not replace
PLAN.md, FINAL-PASS.md, INTERACTION-SYSTEM.md or the everyday plan. Historical
“Remaining…” paragraphs in IMPLEMENTATION.md describe the state at their date.
A later implementation or passing test closes only the requirement it actually
covers. The top-level implementation gates stay open until reconciled here.

## Evidence reviewed in this pass

- PLAN.md's collection/variant gate and acceptance criteria, including the
  **32 px desktop log row limit**, all five named viewport widths, keyboard,
  200% zoom, reduced motion, light/dark and software-keyboard behavior.
- The implementation ledgers and current browser drivers under `ui/dev/`.
- The recorded full backend checkpoint: 787 passed, 0 failed, 1 ignored in
  `implementation-evidence/homectl-checkpoint-server-tests.log`. This is historical
  evidence, not a claim that later changes were included. Timer, mixed-script,
  disabled-device and calibration checkpoints add their own targeted evidence.
- Current draft, scene, routine, group and integration regression sources:
  `ui/lib/{entityDraft,sceneDraft,sceneTargets,routineDraft,groupGraph,integrationDraft}.test.ts`.
  These prove specific preservation/validation rules, not every schema variant.
- New room/map/timer evidence in `implementation-evidence/everyday/` and the
  paired comparison gallery. Their individual queue gates are complete.

## Cross-family reconciliation

| Gate | Current evidence | Still needed before closing the full gate |
| --- | --- | --- |
| Foundation | Retained draft/CAS tests cover background refresh, in-flight edits, failures, inactive variants and nested conflict choices. Current entity pages use shared save bars. | Reconcile each editor's save boundary and errors; verify remaining return/focus/scroll paths and the named accessibility/viewport matrix. |
| Rooms & groups settings | `settings-group-journey.js`, `group-journey.log`, graph cycle/missing-member/usage tests; live room journeys cover nested scope, missing/disabled/read-only members. | Explicit collection/nullable/unknown-field mapping and final narrow/zoom checks for the configuration editor. |
| Scenes | Scene journey/API logs and draft/target tests cover explicit states, links, omission versus zero, precedence, unknown fields and cycles. Capture tests cover capability filtering and color conversion. | Complete variant/collection mapping, malformed target repair behavior and scene creation-return acceptance against current routines. |
| Routines | Current routine checkpoints cover three-lane/phone presentation, nested conditions, stable IDs, script/native branches, conversion and retained edits. | Map every trigger, condition, action, program and policy variant to its renderer and round-trip fixture; verify unsupported future data cannot be overwritten. |
| Devices and calibration | Device journeys, reporting-policy API tests, brightness/color/bulk checkpoints and disabled re-enable regression. | Consolidate calibration evidence into the older settings ledger; verify remaining capability/missing-catalog cases and related-reference coverage. |
| Integrations, helpers, computed sources | Integration/helper/source journeys and preservation tests cover nested editing, omission, arrays, secrets and current-value separation. | Dummy multi-device editing now has 19 browser checks at each size plus Rust sensor/capability schema checks. Remaining: MQTT/module variants, unknown/malformed repair, reload failures and complete references. |
| Remaining settings | Catalog, widget-source, settings-tab, assistant, appearance, migration, backup and dashboard checkpoints exist. | Match each original acceptance item to current evidence, especially backup lifecycle failures, malformed definitions, creation/deletion races and obsolete editor cleanup. |
| Backend contracts | Actor preconditions and persistence outcome tests; database backup/restore, widget secret/redaction, preference/reporting and migration regressions. | Name the exact test for each new persisted field and default-compatible export/import path; do not infer database durability from fixture writes. |
| Health | Shared evaluator/report evidence and transition tests; disabled suppression/re-enable coverage; room/map use shared results. | Reconcile startup/retained/unchanged report and recovery cases with current tests and UI surfaces. |
| Troubleshooting | Compact rows, filters, structured links and routine-history evidence. | Close original desktop density discrepancy; retain full-message keyboard focus, large-buffer pagination and remaining activity trace cases. |
| Everyday views | Room/map/timer gates have current browser evidence; widget creation/preview and chart input checks already exist. | Chart recovery/empty review, widget backup/selection contracts, assistant review, navigation/reconnect and remaining overlay consistency. |
| Cleanup and final delivery | Comparison gallery and regular pushed checkpoints. | Full field matrix, remaining cross-family failure/accessibility cases, superseded surface audit and final requirement-by-requirement sign-off. |

## Discrepancies resolved in this pass

1. Successful empty history responses retained old samples without identifying
   them as retained. Shared status and retry controls now distinguish initial
   failure, empty data, cached failure and empty refreshes.
2. Time-scale tick counts are approximate and allowed overlapping minute labels
   on a phone. Enforce spacing using the rendered chart scale.
3. Programmatic scrolling could move a phone drawer's heading and close button
   above its clipping edge. The outer drawer should clip, with only its content
   body acting as a scroll container.
4. Logs still used 9 px vertical padding (36–37 px rows). The approved desktop
   limit is 32 px. Their filters also used native selects, and opening an event
   without a dialog trigger lost keyboard focus on close.

Confirmed by 11 chart checks at 1440/390 px and 8 log checks at
1440/360/430 px. The drivers are `ui/dev/chart-recovery-review.mjs` and
`ui/dev/log-density-review.mjs`; logs/captures are under
`implementation-evidence/everyday/`. Type checking, lint and build pass.

## Next audit work

1. Chart/log checks from this pass are recorded; no further repetition is needed
   unless a later change affects their contracts.
2. Continue [FIELD-COVERAGE.md](FIELD-COVERAGE.md), which now maps the minimum
   collection set and identifies variant/optional-field gaps. Close its open
   rows with edited fixtures, continuing with routine scopes and dynamic selection.
   The shared JSON editor repair passes 14 browser checks at each viewport;
   it does not close the domain-specific coverage gate.
   Scene collections now have 18 edited browser checks at both sizes: full link
   scopes, missing references, replacement, empty maps and reload. Stored scene
   activation scopes do not alter target-link resolution; the ledger distinguishes
   those contracts. Dynamic routine selection now retains its nested drafts;
   16 checks at each viewport cover selection modes, mappings/fallbacks, activation
   scopes, edited timer captures, cycle entries/detection, Save/Discard and reload.
   Typed dummy-device editing now has 19 checks at each size and two Rust schema
   tests. Continue with MQTT integration/helper/source cases and the remaining
   routine variants; these checks do not close the full schema gate.
3. Use those gaps to select additional browser/backend checks. Do not rerun
   whole passing suites merely to increase test counts.
4. Complete remaining everyday widget/assistant/navigation evidence, then the
   named screen-size/accessibility cases and final cleanup. A screenshot at
   390 px is not evidence for every named phone width or a software keyboard.

No household configuration has been edited in this audit. All browser writes
use the marked local fixture; physical kiosk/GPU behavior remains distinct from
simulated browser event checks.
