# Settings UX redesign: understand, diagnose, then change

This is an implementation checklist for an agent working in the homectl repository. It replaces the earlier, shorter Settings UX plan. The goal is a configuration experience that stays calm with 50–300 devices, lets a beginner diagnose why something did or did not happen, and still exposes the full system to an advanced user.

## Product decisions

- Existing configuration items use dedicated detail pages with stable URLs and browser Back. This includes rooms, scenes, routines, devices, connections, helpers, and computed sources. Lists remain separate pages. Creation uses short guided flows; confirmations and tiny actions may use dialogs.
- The primary detail-page question is: **What is happening, why, and what can I change?** Put evidence and a next action ahead of raw settings. Never use color alone to convey status.
- An expanded section shows readable current configuration and an Edit control. Edit replaces that section's explanation with controls in place. Persistent changes need explicit Save and Cancel. Only one section of an existing item edits at a time.
- A new routine starts with an intent choice; there is no preselected trigger template. The guided flow should produce a useful routine, not an empty shell. A new scene also needs at least one target before being presented as complete.
- Do not turn every choice into a searchable combobox. Use search for large or dynamic entity sets; use visible radios or segmented controls for a few meaningful choices; use a simple select for a small secondary enum.

## Phase 0 — map the current behavior before replacing it

- [x] Read the current list and editor components in ui/app/config and the route table in ui/src/routes.tsx. Record the API mutation each Save, Delete, command, and preview currently invokes. Preserve these semantics while moving the UI.
- [x] Make a short inventory of each screen's current summary, edit controls, advanced controls, empty/error/loading states, deep links, and direct actions. Use it to remove duplicate surfaces after migration. Do not leave the old modal and the new page both authoring the same item.
- [x] Prepare representative fixture data: no items; a normal home; 300 devices across multiple integrations and rooms; a routine with many nested conditions and actions; a scene with many targets; a broken reference; an offline device; and a missing database or stale API response. Use these fixtures in visual and behavior checks, not as runtime defaults.

Artifacts: [`settings-ux-inventory.md`](settings-ux-inventory.md) records the mutation contract and per-screen inventory; `ui/dev/fixture-server.mjs` (with `ui/dev/fixtures.mjs`) serves the fixture sets for visual and behavior checks.

Start here in the code:

| Work | Existing code to inspect |
| --- | --- |
| Routes, breadcrumbs, and old deep links | ui/src/routes.tsx; ui/app/config/page-header.tsx; ui/hooks/useDeepLink.ts |
| List-card overlays and dirty-change guard | ui/ui/ExpandableConfigCard.tsx; ui/ui/primitives/responsive-overlay.tsx; ui/hooks/unsavedChanges.ts |
| Routine view, authoring, preview, and traces | ui/app/config/routines/page.tsx; ui/ui/v2-routine-summary.tsx; ui/ui/TriggerBuilder.tsx; ui/ui/ConditionBuilder.tsx; ui/ui/ProgramBuilder.tsx; ui/ui/RoutineWhatIfPreview.tsx |
| Scene targets and resolved previews | ui/app/config/scenes/page.tsx; ui/ui/SceneDeviceStateEditor.tsx; ui/ui/SceneResolvedColorPreview.tsx |
| Other editable views | ui/app/config/groups/page.tsx; ui/app/config/devices/page.tsx; ui/app/config/integrations/page.tsx; ui/app/config/helpers/page.tsx; ui/app/config/sources/page.tsx; ui/app/config/floorplan/page.tsx |
| Current and historical evidence | ui/app/config/routine-history/page.tsx; ui/ui/DeviceReportStatus.tsx; server/src/core/routine_history.rs; server/src/types/routine_history.rs |

## Phase 1 — shared navigation and interaction system

### Routes and page shell

- [ ] Add list-to-detail routes under the existing ConfigLayout: /config/routines/:id, /config/scenes/:id, /config/groups/:id, /config/integrations/:id, /config/helpers/:id, and /config/sources/:id. Device keys contain a slash, so use /config/devices/detail?key=<encoded device key> instead of a single path parameter. Add /new routes for routine and scene creation.
- [ ] Give every detail page the same compact shell: breadcrumb/back link, item name, one-sentence live status with timestamp or freshness when known, and at most one primary action. Put secondary actions in a labeled menu; put Delete in a final danger section.
- [ ] Use ?section=<section-name> to expand and focus a section and ?target=<encoded-key> for a specific nested target or step. Convert existing scene= and device= list links, plus routine/scene new=1 links, to the equivalent new route with replace navigation. Keep other create links and q= list filters working. Do not break existing external links.
- [ ] On direct load, resolve the item by ID from existing data hooks, then show a useful loading skeleton, a retryable load error, or an “item no longer exists” state with a link to its list. Browser Back should return to the prior list query, filters, and scroll position; a visible Back to list link must work even after a direct link or refresh.
- [ ] Update Settings search, command palette, room/device links, diagnostic links, and routine history links to use the new item URLs. Do not open a full list and make the user search again for an exact item.

### One-section editing

- [x] Build a reusable accessible section primitive with a heading, a one-line state summary that remains visible when collapsed, an expandable body, and an Edit action in the expanded body. The Edit action must not be nested inside the disclosure trigger.
- [x] The editor receives a deep copy of only its relevant saved fields. Cancel discards it. Save validates it, merges only that section into the latest loaded configuration, invokes the existing update mutation, then returns to the updated read view without leaving the page.
- [x] Disable duplicate submission and show progress on the Save button. If validation fails, open the affected subsection, show a short error summary linking to every invalid field, put the correction beside each field, and focus the first invalid field. If the network save fails, retain the draft and show Retry.
- [x] If the saved configuration changed elsewhere while a section is dirty, do not silently overwrite it. Compare the editable configuration snapshot captured on Edit with the latest loaded config before Save; show “This changed elsewhere—review the latest version” with Reload and Keep my draft options. Do not treat changing live device values as configuration conflicts.
- [x] Reuse ResponsiveOverlay's existing dirty guard for remaining dialogs, useUnsavedChanges for tab close, and add route-navigation blocking for dirty detail pages. Ask once before discarding. Do not show a discard warning when nothing actually changed.
- [x] Return keyboard focus to the section's Edit button after Save or Cancel. After opening a section via a URL, focus its heading. Announce save success, errors, and updated result counts through a polite status region. Respect reduced-motion preference.
- [ ] Show a concise “Customized” or “Needs attention” summary on a closed advanced section when its hidden settings are non-default or invalid. Automatically expand the relevant section on a save error. If the server cannot supply a field path, show the exact server error at the section top rather than guessing which input caused it.

### Density, controls, and language

- [x] On a detail page, show at most the header status plus three to five compact section headings above the fold. Do not add an always-visible dashboard of badges. Expanded read view should show all important facts without requiring Edit.
- [ ] A collapsed list section says the count and the most relevant examples; it does not silently hide a fixed “first three” as if they were the complete list. Expanded read view has search and filtering when the list is long. Render 30 rows initially with a “Show 30 more” control; search always covers the complete collection. Keep selected items visible even if the add-picker filter changes.
- [ ] For large entity sets, search by display name, ID, integration, and room; show name first and ID second. Distinguish missing, unavailable, and disabled options. An unmatched saved reference stays visible with a repair action.
- [ ] For two to four consequential choices, display labeled radio/segmented options; for large dynamic lists use the existing SearchablePicker or SearchableMultiPicker. Keep custom JSON pointers and raw IDs in clearly labeled advanced escape hatches.
- [ ] Use a restrained hierarchy: page title, one status sentence, section headings, then row labels. Reserve warning/destructive colors for actionable problems; ordinary false conditions and disabled items are not errors. Avoid repeated explanatory paragraphs, uppercase labels, and multiple competing primary buttons.
- [ ] Standardize status words across pages: Running/Enabled, Off, Waiting for data, Needs attention, and Unknown. Pair each with a plain reason where known. Say “requested,” “reported,” “recorded,” “predicted,” or “confirmed” precisely; never call a cached bridge report physical confirmation.

Use these examples as a copy and information-hierarchy check, adapting the actual facts:

| Surface | Lead with | Detail on request |
| --- | --- | --- |
| Routine | “Last blocked at 08:14: motion matched, but brightness was above 30%.” | Trigger IDs, exact condition trace, revision, raw event |
| Device | “Requested on; last fresh report said off 2 minutes ago.” | Requested/reported fields, cached flag, timestamps, raw payload |
| Scene | “Would set 6 devices; 1 target cannot currently be resolved.” | Per-target source, resolved state, missing key |
| Connection | “Enabled; no runtime connection status is available.” | Plugin name, endpoint, validation fields, JSON |

If the evidence cannot support a sentence, use “Not enough information yet” and identify which report or event is missing. A green badge must not substitute for this explanation.

## Phase 2 — short creation journeys

### New routine

- [x] Start with cards answering “What should start this?”: movement or sensor, time, device state, manual, copy an existing routine, or describe it to the assistant. Nothing is preselected. The user chooses an intent before seeing low-level trigger types.
- [x] Show only the fields for that intent. For a sensor/device trigger, select the device, then a supported field; show current value, freshness, recent changes, and a plain-language expected-value control. For a schedule, ask for local time and days before exposing cron. Never require a beginner to enter a JSON pointer or cron expression.
- [x] Ask “What should happen?” with a searchable scene choice and common device actions. If there is no suitable scene, offer a link to the scene creator and preserve the routine draft when returning. Keep the draft in versioned sessionStorage during creation; restore it after returning, clear it after successful Create or explicit Discard, and never store provider keys or other secrets there. Generate a suggested name and ID; keep the ID editable under Details.
- [x] Review one readable When / Only if / Then sentence before Create. Offer the existing what-if preview as a single optional action. The final review says “This routine will start running when you create it,” with an enabled toggle on by default and an option to save it off. Do not enable it before the user presses Create on that review. Advanced conditions, multiple triggers, execution policy, script, and raw JSON remain available after the basic flow.
- [x] A routine cannot be created with a placeholder device, missing scene/action, invalid schedule, or incomplete condition. Server validation remains authoritative; map returned errors to the relevant guided step.

### New scene

- [x] Ask which devices or rooms the scene should affect, using search and selected-target rows. For each selected controllable device, default to copying its current **requested app state** (power, supported brightness/color) into a scene target. Do not use last_report as the source and do not include transition time by default. Label the result “Captured from requested state”; it is not a claim about the physical device. Every target row also has “Set manually,” so one scene can mix captured and manually chosen desired states. A room target uses a manually chosen shared state; do not pretend it has one capturable physical state. Sensors cannot be captured as scene state. Show the proposed result and its source per target before Create.
- [x] Generate a suggested name and ID; keep the ID editable under Details. Do not create an empty shell as the normal happy path. A separate “Save empty draft” escape hatch may exist under Advanced, clearly labeled as not yet useful.
- [x] After Create, navigate to the scene detail page with target summary visible. Keep Activate separate: creating or editing a scene must not command devices. If launched from routine creation, return to that preserved draft with the new scene preselected as the outcome.
- [x] Implement capture as a pure mapping from `ControllableDevice.state` to `SceneDeviceState`, limited by that device's supported capabilities. Preserve power and supported brightness/color; set transition to `None`. Never read `last_report` for capture, including when it is fresher or disagrees with the requested state. If requested data lacks a supported value, omit that field and explain it in the target preview; never fill the gap from a report. Test power-only, brightness/color, offline, and disagreeing requested/reported cases.

## Phase 3 — existing item pages

### Routines: replace duplicated view/edit blocks

- [x] Convert ui/ui/v2-routine-summary.tsx into reusable read-only rows/formatters or remove it. In the routine page, render exactly one When, one Only if, and one Then section. Remove the second set of editor disclosures and the separate legacy read-only rule/action lists. Do not keep a “Build & preview” tab and a second Details tab for the same item.
- [x] The header states enabled/disabled, latest recorded run or blocked attempt, and whether the displayed live status is fresh. Provide “See activity” beside it. Do not say a routine “would run” based solely on a true condition when no trigger has fired.
- [x] **When:** show each trigger as a sentence with its current armed/waiting/error state and next scheduled time when known. A trigger row opens to explain why it is idle or unavailable. Edit in place via compact TriggerBuilder rows; expose one trigger editor at a time.
- [x] **Only if:** show “Always” for a literal true condition, otherwise a readable condition tree and current evaluation. Put the relevant unknown/error reason beside the clause and a “Why this result?” trace below. Edit in place; open one nested clause at a time. The current condition is not presented as proof of a past event.
- [x] **Then:** show the ordered action plan as short sentences and distinguish dispatched, suppressed, script, and unknown delivery. Edit in place; each action row has Edit, Move earlier/later, Duplicate, and Remove, with only one action's fields open. Add step through a searchable action chooser. Keep execution policy and script under Advanced within Then.
- [x] Keep the what-if preview close to When/Only if/Then, initially closed. On run, lead with “Would run” or “Would not run,” the assumed trigger, and the first decisive reason; then show planned steps and the full trace on demand. The preview must say that it does not fire devices, evaluate whether the selected trigger will actually occur, execute scripts, or confirm physical delivery.
- [x] A single section may preview an unsaved draft while editing; label its result “Draft preview” and live values “Saved routine.” A section Save uses the existing full-routine mutation after merging only that section. Keep the page open and refresh status after save.
- [x] Apply the same section layout to v1 routines, using When and condition rules together where the legacy model requires it. Show a small “Legacy routine” label and a link to its technical definition; do not force migration as part of editing.

### Scenes and rooms

- [x] Scene list cards show name, hidden state if relevant, target count, and a small resolved-state hint. The detail page opens with “What this scene would set,” then Device targets, Room targets, Details, and Advanced script. Avoid the current four-tab editor and two-column grid of permanently open target forms.
- [x] Each scene target read row names the device/room, shows whether it sets explicit state or links to another target, and shows resolved output or a precise unresolved reason. Editing that row replaces its read content with the right controls and keeps the resolved preview in view. Search to add targets in the same section; preserve group target order and explain later-overrides-earlier behavior only where reordering occurs.
- [x] Scene Activate is an immediate command with a distinct button and progress/result text. Do not imply device delivery from API acceptance. Put Delete at the bottom, behind the existing confirmation.
- [x] Room detail starts with its name, direct device count, nested-room count, and where it appears. Devices and Linked rooms are distinct sections with searchable additions and compact selected rows; do not show hundreds of checkbox choices. Keep missing members visible and offer Replace or Remove, with nested-cycle validation beside the linked-room choice.
- [x] Room creation asks for a name first, suggests an ID, then offers optional device and linked-room additions before review. A room with no devices may be created, but label it “Empty room” and suggest the next action.

### Devices

- [x] Replace State/Runtime/Config/Actions/Technical tabs with a status header, Live controls, What the device reports, Display and sensor behavior, and Technical details. Only show sections relevant to the device type.
- [x] Header and report section distinguish requested versus reported state, cached versus live report, reachability, and last-heard time. If they disagree, show the difference and a short next action such as checking connection settings; if unknown, say what evidence is missing. Link to relevant routine history only when the association is supported by recorded data.
- [x] Keep power/brightness/color controls as immediate commands, not settings edits. Edit custom label, sensor interaction mapping, and calibration in their own sections. Calibration starts with a short description and an explicit Start calibration action; do not render the wizard by default.
- [x] Put fake sensor actions in a labeled Testing section, not next to everyday controls. Put replace-references and delete in a closed danger section with existing confirmations. Preserve raw JSON in Technical details.
- [x] List supports quick search plus a compact “Filters” disclosure. Show active filter chips and Clear all. With up to 300 devices, search covers all records and the list renders an initial batch of 30 with more-on-demand.

### Connections, helpers, and computed sources

- [ ] Connection detail leads with enabled state and plugin type. Do not claim “Connected” unless the runtime actually reports it. Give a single next step if required fields are missing or the plugin schema fails to load.
- [ ] Put required connection fields in a Primary settings section, then group optional schema fields by their schema section. A changed conditional field should reveal only the inputs it activates. Keep advanced fields and raw JSON closed, with a non-default count in the collapsed summary.
- [ ] When toggling between visual connection fields and JSON, parse and validate the JSON first; do not discard unknown keys. Keep masked secrets intact when the response omits their value. Show a deliberate “Clear stored key” action rather than treating an empty password input as deletion.
- [x] Helper detail leads with current value, type, and persistence. Put “Set current value” beside that value as an immediate action with its own progress, success, and validation feedback. Do not make users save the definition merely to change the value.
- [x] Put helper name, hidden state, initial value, persistence, and type constraints in separate readable sections. Explain once that initial value is used at initialization/restart while current value is what routines read. Render enum options as ordered compact rows with Add, Rename, and Remove; validate that changing options does not silently invalidate the current or initial value.
- [x] Computed source detail leads with current output, last update or unavailable state, and enabled status. Put computation kind, preset, and main parameters together; place Preview directly below and state whether it evaluates the saved version or an unsaved draft.
- [x] Scripts, legacy aliases, refresh interval/timezone, and raw JSON live in named advanced sections. Show customized or error states in their collapsed summaries. If a preset change replaces custom script content, warn before replacing a dirty draft.

### Floorplan and system settings

- [ ] Floorplan keeps the canvas central and explicit Save. Header shows selected floorplan and unsaved state; Rename/Delete and import/export move to a secondary menu. Only show the toolbar for the active Walls / Devices / Rooms mode. Keep Undo visible. Move grid size, label mode, scale, and background image to Display/Layout settings.
- [ ] Replace the long wall-drawing instructions with one contextual sentence and optional help. Group selection uses search. Bulk Fill/Clear and layout reset require explicit, well-labeled actions separate from ordinary painting; preserve existing undo semantics.
- [ ] App & system may keep Appearance, Behavior, Assistant, and About as top-level categories because they are genuinely different. Within Behavior and Assistant, show current state and common setting first; provider limits, transition defaults, and build/server facts stay behind disclosures. Keep their existing URLs and independent saves.

## Phase 4 — finding and explaining problems

- [ ] Settings home keeps search, current setup health, and one next step. Show four category rows without opening multiple large lists at once. Recents and task links must not duplicate the same item in the first screenful.
- [ ] Diagnostics rows show affected item, observed problem, and a concrete next action in that order. Technical IDs and longer evidence are expandable. “Open item” navigates directly to the relevant detail section, not to a filtered list.
- [ ] Automation history entries lead with time, routine, event, and outcome in one line. Expand for trigger, condition trace, dispatched/suppressed steps, revision, and technical fields. Use names in primary text and IDs only in details. Search/filter remains available over the whole history.
- [ ] Add bounded v2 “trigger matched but routine did not run” history so a user can inspect a past blocked attempt. Record only when one or more configured triggers matched and the condition was false, unknown, or errored. Do not record every idle evaluation. Add a `V2Blocked` history kind; include matched trigger IDs, the condition evaluation/trace, definition revision, and a short reason. Action count is zero and the snapshot's previous `last_run` must be cleared in this entry. Record at the evaluation decision point before the next frame can replace the evidence; do not infer a block later from live status.
- [ ] Coalesce repeated blocked attempts with the same routine ID, definition revision, matched trigger IDs, and reason during a 60-second window measured from the first attempt. Keep the entry ID, increment an optional occurrence count, retain the first timestamp, update the main timestamp and trace to the latest attempt, and move the entry to newest in the 500-entry ring. The existing database upsert by ID can persist the updated entry; queue writes in order. Display “Blocked 7 times; latest at 08:14” rather than hiding repetitions. A changed condition result/reason or an elapsed window starts a new entry. Default missing count to one for older entries. Test coalescing, changed reasons, restart restore, persistence ordering, and the 500-entry bound.
- [ ] In the UI, distinguish “No matching event in retained history,” “An event matched but the condition blocked it,” “A run was rejected,” “Actions were dispatched,” and “Device delivery is unconfirmed.” For v1, whose skipped evaluations are not recorded, state that historical non-runs cannot be reconstructed rather than guessing from current status.
- [ ] Logs lead with time, level, source, and a short message; raw payload and metadata expand. Backups and migration retain explicit review/confirmation, with the detailed overwrite list shown at review time rather than dominating the landing page.

## Verification and release checklist

- [ ] Check all critical journeys at a narrow phone width, a desktop width, 200% zoom, keyboard-only, and reduced motion. Test the software keyboard with a searchable picker and a long editor. There must be no nested scroll trap or off-screen Save button.
- [ ] Test direct-load, refresh, browser Back, not-found item, deleted item, old deep links, and links from Settings search, diagnostics, command palette, room pages, and history.
- [ ] For each editable view, test empty, normal, and large items; Save, Cancel, invalid input, network failure, conflicting server update, and unsaved navigation. Verify a section save does not erase other sections or live state. Check that a memory-only write warning remains visible and points to backup.
- [ ] Test routine preview truth labels, draft/saved separation, blocked history coalescing and persistence, scene capture with offline devices, missing references, integration secrets, and floorplan undo/save.
- [ ] Run pnpm tsc, pnpm lint, pnpm test, pnpm build, the repository's additional UI interaction tests, cargo fmt --check, and relevant Rust unit/integration tests. Regenerate TypeScript bindings for the history type change. Check git diff --check, make conventional commits, and push.
- [ ] Before calling the work done, perform a brief usability review with at least these tasks: find why a motion routine did not turn on lights; change its condition threshold using current/recent values; repair a scene's missing target; rename a device; find an offline connection; and create a routine and scene from scratch. A reviewer unfamiliar with the implementation should complete each without needing a raw ID, JSON pointer, or external MQTT tool.

## Suggested implementation sequence for the next agent

1. Inventory the existing mutations and links, then build the shared detail route, shell, section primitive, conflict guard, and searchable row patterns. Migrate one small item first to establish the interaction contract.
2. Add the blocked-attempt history model and tests before polishing routine status copy; the latter must be based on actual persisted evidence. Keep older history entries readable.
3. Migrate the routine list/detail and guided creator. Remove duplicate read/edit blocks only after the single-section editor can save each routine model without losing other fields. Test preview statements against a matched-but-blocked event.
4. Implement scene capture and guided scene creation, then scene, room, and device detail pages. Exercise the routine-to-scene-to-routine draft return path.
5. Migrate connections, helpers, computed sources, floorplan, and system settings. Keep secrets, immediate commands, and persisted settings on their existing respective API paths.
6. Update Settings home, diagnostics, history, logs, and cross-links; run the verification tasks above and fix issues found in the usability review.

## Design references

Use the [WAI accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) and [combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) when building custom controls. Follow the [GOV.UK validation pattern](https://design-system.service.gov.uk/patterns/validation/) and [error summary guidance](https://design-system.service.gov.uk/components/error-summary/) for recoverable form errors. Use [WAI status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages) for save and result announcements. These are implementation references; the product copy and structure above should be validated against actual homectl use.
