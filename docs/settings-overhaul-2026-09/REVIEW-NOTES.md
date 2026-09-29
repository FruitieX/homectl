# Design review notes

## Study 04 — restore the earlier flow and desktop table

User feedback preferred the earlier `#routine` concept over the Study 03 complex layout, and explicitly preferred the desktop scene table over cards. This supersedes the Study 03 layout recommendation, while retaining its useful interactions and schema findings.

Changes: restored one dotted routine canvas with When → Only if → Then lanes, original-style nodes and tabs; placed open branches/timers inside Then with lighter grouping. Converted the complex desktop scene card grid into aligned rows, retaining phone cards, source modes, repair and previews. The earlier simple routine and ordinary scene routes remain available.

Checks: desktop/phone screenshots at 1440 and 390 px; no document overflow or browser console errors. At 360 px, routine action/branch reorder, added trigger styling and retained draft navigation passed. At 1440 px, scene mode switching, multiplier preview, color apply, newly added row layout and retained color draft passed. At 1024 px, original routine, revised routine and revised scene rendered without overflow. A 360 px scene mode change and color dialog also passed. Prototype JavaScript syntax checked. Production code was not changed by this work.

The revised layouts await user review.


## Study 03 — final focused interaction pass

The four targeted prototypes are complete and ready for user review. The user confirmed that **Enable after creating is checked by default**. Production implementation has not started. See [FINAL-PASS.md](FINAL-PASS.md) for the interaction handoff and source-backed semantics.

Added:

- Complex routine with two starts, All/Any/Not, first-match branches, ordered actions, timer references, and arrow reordering on phone/desktop.
- Scene target modes, CT/HS picker with numeric values, capability-specific controls, linked-state multipliers, missing-source repair and a provenance example.
- Creation and return flow: routine draft → create scene → routine with new scene selected. A compact strip links to other retained drafts.
- Searchable 240-entity fixture picker with long names, selection retention, no results, loading and retry.
- Shared validation, failed-save retry, conflict choices and applied-but-not-persisted warning across navigation.
- A typed static routine fixture checked against current generated TypeScript bindings.

Corrected earlier scene wording: omitted power defaults On, omitted brightness is normalized to 100% for an On device update, and omitted color is Not specified. Device-link brightness is a multiplier. Existing Study 01/02 screenshots are historical and may retain superseded “Keep current” labels.

Browser checks completed:

- Rendered complex routine, scene modes and creation at 1440 px and 390 px. Inspected desktop/phone scenes, routine, color dialog, catalog picker, creation and failure screenshots. Checked captures reported no console errors or document horizontal overflow.
- At 360 px, color Cancel left the value unchanged; Use color updated the accessible preview. Multiplier 25% of the sample 60% source displayed 15%. Mode values survived a related-page visit. Missing-source validation blocked Save; repair enabled successful Save.
- At 360 px, action and branch reordering preserved field values, and adding a branch produced a third branch.
- At 360 px, invalid numeric input received focus; network failure retained the draft; successful retry cleared the error; Keep my draft retained conflict edits; Use latest saved restored the saved snapshot instead of silently accepting other edited fields.
- Picker no-results, loading and retry states worked at 360 px; retry restored all 240 entries. Selection remained visible while filtering the long-name fixture out of results at 390 px.
- Routine → new scene → create → return retained the routine name and trigger and selected the newly created scene. The applied-but-not-persisted warning survived navigation to the overview.
- At 768 and 1024 px, the four main study pages had no document overflow or console errors. At 360 × 640, the color dialog footer stayed visible while its body could scroll. Gallery image/link checks found no missing local targets.
- `node --check` passes for the prototype scripts; the typed fixture passes standalone strict `tsc --noEmit` against generated bindings.

These checks validate selected prototype interactions, not a production serializer, a real conflict protocol, server execution, full accessibility or all supported schema variants. The engineering coverage ledger and save contracts are in FINAL-PASS.md. The older baseline approval below remains valid; only the focused Study 03 behaviors await review.

## Baseline approval after study 02

The user confirmed satisfaction with both desktop and phone prototypes and explicitly endorsed the color circle with the surrounding brightness indicator. The visual baseline is approved. Remaining work is the focused pre-implementation pass in `IMPLEMENTATION-READINESS.md`; it should not reopen the selected visual direction or the accepted phone routine structure.

## Study 02 — selected direction and refinements

User review selected A/Compact spacing and colors, useful inline technical details, and the existing open phone routine structure. A shared advanced-details setting is preferred until user accounts exist. Missing-report policies use integration defaults with per-device overrides and Ignore. Promotional slogans were rejected.

Changes in this iteration:

- Replaced the scene table adaptation with one target model/DOM rendered as aligned desktop columns or mobile cards. Cards use a target heading/preview, full-width brightness control, labeled power/color fields, and transition row.
- Added a consistent item menu, multi-select target picker, explicit exact brightness control, Keep current handling, and shared removal icon treatment.
- Added reusable color/brightness previews to scene targets/summaries, routine scene actions, relevant room members and device states. Preferences shows off, unchanged, mixed and unresolved examples.
- Added shared advanced-details preference with explicit Save; repair identifiers stay visible when it is disabled.
- Replaced the overview's generic attention banner with named issue rows and an evidence/detail concept. Added inherited/custom/ignore reporting controls and proposed health/recovery log examples.
- Recorded action placement and responsive/component rules in `INTERACTION-SYSTEM.md`.
- The original A/B comparison screenshots remain historical; review-02.html archives the Study 02 gallery.

Checks performed:

- Scene at 360, 390, 768, 1024 and 1440 px: no document horizontal overflow; checked captures reported no browser console errors.
- Changed a phone target brightness to 72%; numeric control and accessible preview updated to 72%. Scene → routine → scene retained the draft. Multi-select added two targets (3 → 5); Discard restored the three original targets and cleared dirty state.
- Advanced details remained shown until Save; after saving disabled they hid on the routine page while the missing-device repair key stayed visible in attention.
- Rendered current home/attention/preferences/routine/scene/connection/device/log concepts, including dark phone scene and open target picker. Inspected the phone scene, desktop scene, attention, preferences, picker and dark scene captures.
- Both prototype scripts pass `node --check`. No production UI/server files were changed by this design work.

The Study 02 baseline was subsequently approved. Backend telemetry, policy persistence and health-event generation remain proposed work. Study 03 now addresses representative color/link modes and collections; production accessibility and complete schema coverage remain implementation gates.

## Archived study 01 notes

## Confirmed preferences

- Household and power-user audiences; equal phone/desktop priority.
- Explicit save with unsaved indicator; immediately editable ordinary controls.
- Rooms & groups terminology.
- Guided routine flow with automatic layout and controls inside nodes; responsive vertical phone flow.
- Landing page combines navigation and concise overview; all primary configuration/troubleshooting journeys matter.
- Useful technical detail is preferred provisionally; visual comparisons requested.
- Referenced entities need direct links; original drafts must survive related-page visits.

## First-study observations

- Compact and soft treatments share content and behavior so density can be compared fairly.
- An early routine render truncated selected values in narrow two-column node forms. Node fields were changed to full-width controls.
- Repeated page title/name fields were removed. Entity headings are directly editable; identifier and visibility occupy a small metadata strip.
- Phone routine controls are legible and all primary sections remain open, but the full sequence requires substantial vertical scrolling. A compact overview/jump navigation or denser block layout should be explored with the user.
- The current connection sample is Generic MQTT, matching the sensor-path list shown. A real schema-driven implementation must enforce profile-specific field visibility.
- Relationship links in this study cover representative entities only. Additional fixture entities are intentionally plain text instead of misleading links to the wrong detail page.
- The standalone prototype is not the new production app. It does not persist drafts across reload, validate routine semantics, calculate live preview outcomes, implement full search pickers, or provide every settings category.

## Browser checks performed

- Rendered 14 initial screenshot variants across overview, routine, scene, room, connection, device and logs; added a dark routine and a dirty routine view.
- Desktop screenshots: 1440 px. Phone screenshots: 390 px. Additional connection/scene checks: 360 px.
- The checked rendered views reported no document horizontal overflow and no browser console errors.
- Routine → scene → routine at 390 px: changed threshold 30 → 40, dirty indicator appeared, scene link opened Evening glow, return retained 40 and dirty state, Discard restored 30 and cleared dirty state.
- Connection at 360 px: adding a sensor path increased rows from 3 to 4; removing one returned to 3; dirty state remained visible; no document overflow.
- Desktop logs: row height measured 29 px; WARN filter yielded one sample entry; filtering did not mark configuration dirty.
- `node --check prototype.js` passed.

These checks establish that the concepts render and the demonstrated interactions work. They do not constitute production API tests, a full accessibility audit, semantic graph validation, or user acceptance.

## Study 01 decisions that were subsequently resolved

- A compact, B soft, or a mix of compact density and soft colors/shapes?
- Technical paths and type names inline, on demand, or a mix?
- Phone flow: open controls plus overview/jump links, denser blocks, or retain current arrangement?

After these answers, build the second study around real complex routine shapes, scene links, missing references, creation, and save/error/conflict states. User review remains open; no production implementation is authorized by accepting this artifact alone.
