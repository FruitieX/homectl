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
| Scenes | Scene journey/API logs and draft/target tests cover explicit states, links, omission versus zero, precedence, unknown fields and cycles. Capture tests cover capability filtering and color conversion. | Scene creation/return now has 17 native checks per size, including retained drafts, focused selection, missing actions and deleted-scene repair. Complete variant/collection mapping and malformed target repair behavior remain. |
| Routines | Current routine checkpoints cover three-lane/phone presentation, nested conditions, stable IDs, script/native branches, conversion and retained edits. | All eight trigger kinds now have edited Save/reload evidence at both sizes, including schedule modes and optional report fields. Nested conditions, all comparison operators and group quantifiers now have 32 checks per size plus ten server condition/compiler tests; unsupported sources stay visible and are removed explicitly. Action/policy/declaration checkpoints now add edited field coverage (38/25/20 checks per size), with conversion and compiler contracts. Empty-cycle repair, focus/no-write validation and Discard now pass in the 19-check selection journey at both sizes, backed by the compiler test. Remaining: unavailable-reference and broader recovery. Raw definitions now have database reopen/JSON restore evidence. |
| Devices and calibration | Device journeys, reporting-policy API tests, brightness/color/bulk checkpoints and disabled re-enable regression. | Consolidate calibration evidence into the older settings ledger; verify remaining capability/missing-catalog cases and related-reference coverage. |
| Integrations, helpers, computed sources | Integration/helper/source journeys and preservation tests cover nested editing, omission, arrays, secrets and current-value separation. | Dummy multi-device editing now has 19 browser checks at each size plus Rust sensor/capability schema checks. MQTT lists/profile/credentials have 21 checks and reporting/rejected-save recovery has 9 at each size, backed by API and runtime rollback tests. Helpers now have 21 edited-type and 6 command checks at each size, plus phone conflict review and server persistence evidence. Computed sources have 16 edited-variant and 13 repair/preview checks per size, plus existing phone conflict/color checks. Source timing/error focus and chart readability now have 19 checks per size plus four curve/validation Rust tests. Remaining: module variants, visibility, complete references and database reconciliation. |
| Remaining settings | Catalog, widget-source, settings-tab, assistant, appearance, migration, backup and dashboard checkpoints exist. | Backup recovery now has 26 native checks per size covering large lists, file-read races, invalid replacements, pending locks, failed review/apply/export and cancellation. Integration epoch rollback has targeted runtime regression evidence. Remaining: full restore/database restart lifecycle, malformed/legacy definitions, creation/deletion races and obsolete editor cleanup. |
| Backend contracts | Actor preconditions and persistence outcome tests; database backup/restore, widget secret/redaction, preference/reporting and migration regressions. | [PERSISTENCE-COVERAGE.md](PERSISTENCE-COVERAGE.md) now names 17 passing consistency tests, including file-backed source/everyday collection restart and JSON restore. Raw scene/routine definitions now have file-backed reopen/JSON restore evidence. All widget defaults and storage representations are mapped in WIDGET-OPTIONS.md; the expanded everyday persistence test covers every type with edited and empty options. Remaining: API recovery reconciliation. |
| Health | Shared evaluator/report evidence and transition tests; disabled suppression/re-enable coverage; room/map use shared results. | Reconcile startup/retained/unchanged report and recovery cases with current tests and UI surfaces. |
| Troubleshooting | Compact rows, filters, structured links and routine-history evidence. | Desktop density, full-message focus and large-buffer pagination are now covered by the log checkpoint below. Remaining activity trace cases still need reconciliation. |
| Everyday views | Room/map/timer gates have current browser evidence; widget creation/preview and chart input checks already exist. | Chart recovery/empty cases pass in the checkpoint below. Widget selections now have SQLite reopen/restore evidence. Assistant review now has 17 native checks per size for pending selection/discard locks, persistent request errors, partial results, contained previews and related-page retention. Conversation/search failures now have 13 native checks per size, including Retry, preserved thread state and new-conversation request isolation. Streaming now has 12 native checks per size, four stream unit tests and a Rust response-drop/provider-cancellation test. Reconnect now has 16 native checks per size for fresh-state readiness, revision gaps, timed probes, retained drafts, acknowledged commands and no replay after a lost acknowledgement. Navigation/search now has 15 native checks per size for complete catalogs, retry, canonical source links, recent deduplication, keyboard focus and draft retention through Back. Widget defaults/options now have the complete source inventory, all-type database round trip and 22 native repair/numeric checks per size in WIDGET-OPTIONS.md. Remaining: overlay consistency and the broader recovery/accessibility gates. |
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
   tests. MQTT collection/profile/secret checks (21) and recovery/reporting checks (9)
   also pass at each size. Helpers now have 21 edited-type and 6 command checks
   per size, plus 11 phone conflict/creation checks. Sources have 16 edited-variant
   and 13 repair/preview checks per size. Continue with remaining module/field cases and
   routine variants; these checks do not close the full schema gate.
3. Use those gaps to select additional browser/backend checks. Do not rerun
   whole passing suites merely to increase test counts.
4. Complete remaining everyday widget/assistant/navigation evidence, then the
   named screen-size/accessibility cases and final cleanup. A screenshot at
   390 px is not evidence for every named phone width or a software keyboard.

No household configuration has been edited in this audit. All browser writes
use the marked local fixture; physical kiosk/GPU behavior remains distinct from
simulated browser event checks.

## Routine policy and timing follow-up

The routine timing journey adds 25 native browser checks at each 1440/390 px.
Execution policy, activation/cycle transitions and spatial rollout now preserve
unfinished drafts and optional/zero distinctions, with validation focused inside
expanded optional sections. The screenshot gallery shows the reviewed controls.
Two targeted server compiler tests and all 234 UI tests pass; type/lint/build
also pass. FIELD-COVERAGE.md records the exact scope and remaining action/script,
reference and persistence contracts. This closes those edited-field cases only;
all broader final acceptance gates above remain open.

## Native action field follow-up

The action journey passes 38 checks at each 1440/390 px for power, dim, random
color, start/replace/cancel timer, four helper value types and routine invocation.
It includes numeric draft recovery, invalid-input focus, explicit Save/reload,
optional/false/zero/empty values, device/group targets and related helper links.
Block-width-based random-color layout fixes the clipped desktop transition field
found during screenshot review. All 234 UI tests, three targeted Rust compiler
tests and type/lint/build pass. Script declarations and the broader reference,
persistence, recovery and accessibility gates remain open; see FIELD-COVERAGE.md.

## Script declaration follow-up

Twenty declaration editing checks and six whole-program conversion checks pass
per 1440/390 px viewport. Script declarations now use shared selectors, compact
rows and direct future device/group IDs. Unknown formats remain visible for
explicit removal; default limits and absent declaration lists are not needlessly
written into stored definitions. Conversion preserves extension fields. Three
targeted compiler tests, all 234 UI tests and type/lint/build pass. Current gaps
are the cross-family reference/recovery and persistence contracts, remaining
named accessibility cases and final ledger cleanup, not the declaration UI.

## Database reconciliation follow-up

Sixteen SQLite consistency tests pass; the exact fields and guarantees are mapped
in [PERSISTENCE-COVERAGE.md](PERSISTENCE-COVERAGE.md). Two new tests close and reopen
a file database before JSON export/import into a second database. They cover
computed sources and the everyday collections missing from prior browser-only
evidence. Helper persistence also now covers all types and visibility values.
The top-level gates remain open for the explicitly listed remaining contracts.


### Navigation and search recovery — 2026-09-30

15 native browser checks pass at 1440/390 px. Search now considers the full
catalog while keeping the idle list compact; previously each category was
truncated to 40 entries before filtering. Computed sources have searchable
identity and canonical detail links. Recent destinations appear once. Failed
catalogs identify incomplete results and offer Retry without clearing the query;
successful retry returns keyboard focus to the search field. Live-state recovery
also labels potentially stale entity results. Close fits within the search row.

Ctrl+K, Enter, Escape and browser Back preserve an unsaved room draft. Escape
returns focus to the edited field; navigating to another page does not restore
focus to an obsolete trigger. The driver intercepts a 65-routine catalog and
503 failures on the marked local fixture, performs no writes and explicitly
discards its draft. Evidence: `ui/dev/navigation-search-review.mjs` and
`implementation-evidence/everyday/navigation-search-*`. Captures were visually
reviewed on desktop and phone. Type/lint/build pass (the existing bundle-size
warning remains). These checks do not close the wider viewport/accessibility
matrix, all widget defaults, remaining field coverage or final reconciliation.


### Widget options and persistence — 2026-09-30

[WIDGET-OPTIONS.md](WIDGET-OPTIONS.md) maps all 17 widget types, field defaults,
legacy representations and renderer behavior. Nine remaining native dropdowns
now use shared selectors or searchable entity pickers. Numeric options require a
complete value before Save; price thresholds accept signed decimals. Missing
references remain visible and repairable, and mode switches retain inactive IDs.

22 native checks pass at each 1440/390 px viewport, with no live commands. The
expanded existing SQLite test now closes/reopens and exports/restores edited and
empty option objects for every type, including synthetic private overrides.
Type/lint/build pass. Captures, driver and exact evidence are linked from the
option ledger. The remaining gates include backup/recovery races, reference and
module reconciliation, shared overlays and the wider accessibility matrix.

### Backup recovery and integration rollback — 2026-09-30

26 native browser checks pass at 1440/390 px in
`ui/dev/backup-recovery-review.mjs`. A 205-addition review renders 80 entries
at a time and filtering finds entries beyond the current page. Review completion
and confirmation cancellation restore useful keyboard focus. Invalid/oversized
replacement files clear the previous candidate and cannot restore it. Pending
file reads show progress; superseded failures, Discard and navigation cannot
publish an old read. Returning from an interrupted read explains how to resume.
Aborted reviews cannot repopulate discarded drafts.

Failed reviews retain the file for explicit retry. Pending apply locks file
replacement, Discard and resubmission; an apply failure retains the file and
requires a fresh review. Export failures appear beside Download and can be
retried independently. Export credentials are locked while preparing a download.
The marked local fixture receives only read-only preview POSTs; apply/export
responses are intercepted, and its configuration is compared unchanged afterward.
Injected review/apply/export 503 responses are expected in the probe logs.

The lifecycle audit found that failed integration replacement could preserve the
old handle while invalidating its event epoch. Reload now reserves replacement
epochs during construction, cuts over after all constructors succeed, and
restores the previous shared epoch map before restarting old instances on failure.
The existing invalid-configuration and stop-failure tests now verify old event
acceptance through staged and original integration handles, and rejection of the
failed replacement epoch. Six reload-filtered Rust tests pass; the successful
cutover/stale-event regression and two backup review/API tests also pass.

Type/lint/build pass. Reviewed captures and logs are in
`implementation-evidence/everyday/backup-recovery-*`. This covers browser
recovery and the named runtime lifecycle contracts; it does not claim an HTTP
restore plus real-database restart test across every external integration. Nested
legacy/unknown-field reconciliation, creation/deletion races and the wider
accessibility matrix remain open.

### Viewport, keyboard and contrast checkpoint — 2026-09-30

Routine, scene and widget creation pages now keep Save/Create above a software
keyboard, follow viewport panning, and restore full height after dismissal.
Pinch zoom is excluded from keyboard detection. Phone buttons have at least
44-pixel targets; text entry uses 16-pixel type, and long detail titles wrap.
Search keeps its input and footer visible while the result list scrolls.
Routine lane headings and destructive colors have separate light/dark values.

The browser driver `ui/dev/settings-viewport-review.mjs` verifies native Tab,
typing and Discard, visible actions, reduced motion, both system themes,
page overflow and no configuration writes. Passing width matrix:

| CSS viewport | Checks | Additional coverage |
| --- | ---: | --- |
| 360 × 800 | 37 | Phone keyboard/pan/dismiss/pinch model and search |
| 390 × 844 | 37 | Same; final heading and error contrast |
| 430 × 932 | 37 | Phone keyboard/pan/dismiss/pinch model and search |
| 1280 × 900 | 18 | Desktop layout and headings |
| 1440 × 1080 | 18 | Desktop; final heading and error contrast |
| 640 × 450, DPR 2 | 21 | 200% equivalent reflow of 1280 × 900 |
| 720 × 540, DPR 2 | 21 | 200% equivalent reflow of 1440 × 1080 |

The final color pass was rerun at 390/1440 and both reflow sizes. Heading contrast
is at least 4.94:1 in light mode and 7.87:1 in dark mode; the routine error is
4.89:1 and 5.78:1. These are measured text/background pairs, not a whole-app
accessibility certification. Computed oklab backgrounds are converted through
Canvas before compositing. Other width logs precede the final error color change.

Keyboard geometry uses injected VisualViewport values; zoom uses CSS dimensions
and DPR emulation, not the browser toolbar. Physical mobile keyboards and the
Linux kiosk remain untested. Entity-picker/navigation overlays and remaining
page families still need their own keyboard/reflow acceptance. The local fixture
now explicitly rejects schedule preview with 501, instead of accidentally
handling it as a routine creation; those expected errors appear in the logs.

Type checking, lint, production build and all 242 UI tests pass. The build retains
the existing large-chunk warning. Evidence: `implementation-evidence/everyday/settings-viewport-*`;
representative captures appear in the comparison gallery. Wider schema,
restore/restart, recovery and accessibility gates remain open.

### Shared selection and category dialogs — 2026-09-30

Entity pickers and phone settings navigation now respect the available visual
viewport instead of overriding it with 85dvh. Their real dialog triggers restore
keyboard focus after closing. Picker headings, search and Cancel/Done stay fixed
while the member list scrolls; category headings and Close likewise stay visible
when the last link receives focus. Phone dialog text inputs now have 44-pixel
minimum height, consistent with the other settings fields.

`ui/dev/settings-picker-review.mjs` uses a read-only intercepted catalog with 65
additional groups, a cyclic candidate and an unavailable selected reference.
It checks staged multi-selection, Cancel/Escape retention, Done versus Save,
Discard, search beyond the first 40 entries, Show more, disabled cyclic choices,
removable missing references, focus return, keyboard geometry and category-list
scrolling. No configuration writes occur. Keyboard height/panning is simulated;
this is not physical keyboard evidence. The 720 × 540 run checks a short viewport,
not browser zoom. Logs and screenshots are in
`implementation-evidence/everyday/settings-picker-*` and the comparison gallery.

Type checking, lint and production build pass, with the existing large-chunk
warning. The wider editor collection/persistence and recovery gates remain open.

Passing runs: 1440 px: 17 checks; 390 px: 23 checks; 360 px: 23 checks; 720 px: 21 checks.
