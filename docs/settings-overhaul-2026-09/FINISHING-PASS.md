# Finishing pass — 2026-10-02

Approved scope: readable automation previews, a small browser regression suite
in CI, and one current completion record. The user is actively testing the
configured assistant and physical devices and considers those areas in good
shape; this pass does not repeat those evaluations.

## Delivery

- [x] Present reusable action plans, condition results/traces and computed values
      with shared components; link related entities and retain JSON under advanced
      details. Keep zero/false/empty values distinct and guard stale preview requests.
- [x] Share that result presentation with the routine what-if preview without
      changing its execution contract: routine preview does not execute scripts;
      reusable previews execute supervised workers but dispatch no actions.
- [x] Run a short desktop/phone Chromium smoke suite against isolated fixtures
      in CI: retained edits, preview rendering, chart/dialog gestures and floorplan.
      Preserve failure screenshots/logs and use no household configuration.
- [x] Reconcile historical work queues into a current completion record, retaining
      evidence and explicit limitations without claiming unperformed checks.

## Verification — 2026-10-02

- TypeScript and lint pass; **303 UI tests pass**. Existing import/export
  hook-lint and production bundle-size warnings remain.
- The production-bundle browser suite passes **54 checks per viewport**, at
  **1440 × 1000** and **390 × 844**, with no browser errors. Native pointer/key
  input covers retained edits/Discard, zero/false/empty/literal structured
  outputs, unknown/error conditions, linked action plans, suppressions, stale
  results and retry, advanced JSON, routine what-if results, chart tap/drag/
  release in dialogs, Pixi pinch-to-one-finger pan continuity and editor Fit.
- The real-server test
  `previews_check_typed_contracts_select_branches_and_dispatch_nothing`
  passes against actual supervised workers, including function/condition/action/
  computed-helper results, typed inputs, selected branches and no commands or
  configuration writes. Backend implementation is unchanged in this pass.
- The CI workflow invokes the same suite after its build and uploads screenshots
  and logs on success/failure. Local reproduction and runtime requirements are
  in [UI verification](../../ui/README.md#verification).
- Reviewed action/value/condition captures fit both screen sizes. The
  [capture gallery and recorded logs](implementation-evidence/finishing-pass/index.html)
  contain current implementation screenshots with synthetic fixture responses;
  they are not model-generated mockups or physical-device evidence.
- No live household configuration or device commands were changed, so the live
  configuration scenario gate is not applicable to this batch.

The historical trackers now point to [COMPLETION.md](COMPLETION.md). Old open
audit rows retain their original coverage limits; no unperformed checks are
marked as passed. Continuous-gesture A/B/C prototypes are explicitly separate
from the delivered radial controls. No approved finishing-pass items remain.
