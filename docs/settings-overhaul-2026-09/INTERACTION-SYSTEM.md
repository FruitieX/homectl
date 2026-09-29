# Shared interaction rules — studies 02–03

These rules are part of the redesign contract. Implement them as shared components and tokens, then use those components across the page families. Page-specific CSS and action bars should be exceptions requiring a concrete need.

## Actions and location

| Purpose | Placement | Label and behavior |
| --- | --- | --- |
| Parent navigation | One breadcrumb in the application header | Native link; no duplicate Back row; browser Back retains list context |
| Add entity | Trailing side of the list page heading | `+ Add routine`, `+ Add room or group`; one action per collection |
| Add member/target | Trailing side of its section heading | `+ Add devices`, `+ Add groups`; same button style and alignment at every width |
| Insert flow node | At the legal insertion point | `+ Add starting event`, `+ Add action or branch`; a graph-specific exception, consistently reused |
| Open reference | Beside the reference name or picker | Real link with an outward arrow; distinct from changing the selected entity |
| Item menu | Trailing edge of the item header/row | Ellipsis; same location on mobile and desktop; includes reorder, change mode and remove when needed |
| Simple list removal | Trailing edge of the member/field row | Trash icon with a specific accessible label; use one menu instead when the item has several actions |
| Remove selection chip | Trailing edge inside the chip | Small ×; removes only that selection; keyboard accessible |
| Close overlay | Top trailing corner | × with accessible `Close…` label; Escape closes; return focus to opener |
| Overlay completion | Bottom trailing edge | Cancel first, primary action last, e.g. `Add selected`; one footer, no duplicate top Save |
| Persistent Save/Discard | One bottom bar for the dirty entity/endpoint scope | Discard before Save changes; contextual unsaved label; safe-area inset on phone |
| Command or preview | Trailing side of page heading; same row or its own trailing row on phone | `Activate saved scene`, `Preview draft`; never implicitly saves draft configuration |

Use icons from one icon family in production. Consistent icon sizes, button heights, border treatment, radii, focus rings, spacing and disabled states are shared tokens. The study uses small inline SVG icons for the refined controls.

Base desktop controls are 36 px; phone controls and icon hit targets are at least 44 px. Dense desktop logs retain 29 px rows with keyboard-accessible message expansion; do not make all log rows card-sized to match form controls. Mobile text-entry controls should avoid browser auto-zoom, and long labels must wrap rather than push the layout outside the viewport.

## Responsive scene targets

Use one target model and one set of controls. Desktop arranges those controls as aligned columns; narrow layouts arrange them in a card. The breakpoint follows available editor width, accounting for navigation and 200% zoom, rather than assuming every tablet can fit the desktop columns.

Phone order:

1. State preview, linked target name, target kind/member count and optional ID; trailing item menu.
2. Full-width brightness slider and exact numeric percentage; visible Use default option (100% when powered on).
3. Power and color controls side by side, with persistent labels.
4. Transition label and value, with blank explicitly meaning the default.

The entire card is directly editable. Remove and reorder are draft operations; Discard restores them. Color and brightness preview update with the draft. Changing power to Off must not silently delete the saved brightness/color settings. Preserve omitted/null values independently: `0` is not an omitted value. Omitted power defaults On; omitted brightness resolves to 100% when powered on; omitted color is Not specified. Do not promise physical color retention without integration evidence.

Group targets and device overrides remain separate sections because their precedence differs. Group reordering has a non-drag operation in the item menu. Long target lists will need search and bounded rendering with an honest result count. Study 03 demonstrates the color picker, explicit/device-link/scene-link modes, repair and precedence; see FINAL-PASS.md for the source semantics.

## State preview component

One reusable preview receives structured state, capabilities, provenance and certainty. Never infer a color by parsing a display sentence. Approximate color appears in the center; a ring shows brightness; adjacent text and the accessible label give exact values. Keep contrast sufficient for the indicator boundary in either theme.

| State | Preview | Required wording |
| --- | --- | --- |
| Known explicit/resolved state | Color center and brightness ring | Color/temperature and percentage |
| Off | Neutral center and diagonal mark | Off; preserve any stored next-on color/brightness |
| Unchanged | Neutral dashed outline | Unchanged; do not invent a resolved value |
| Mixed group/scene | Several representative swatches or a segmented marker | Mixed states; never average unlike colors into a fictitious scene color |
| Unresolved/missing | Dashed marker and question mark | Unresolved plus reason; never show an ordinary gray swatch as if gray were the chosen color |
| Partial state | Show known components and label the rest explicitly | Not specified, Unknown or an evidenced default; Unchanged only where the operation truly preserves it |

Use it in scene lists, target headers and resolved effects; routine scene actions and choices; device lists/details; relevant group members; helper/computed lighting sources; and picker options where a state is genuinely meaningful. Do not add a light preview to unrelated sensors or values.

Each context identifies whether it shows requested, reported, saved, draft or resolved state. A scene editor can update its draft preview without updating the saved-scene preview in another draft. Scene summaries respect group order, device overrides, scripts and device capabilities. The current `deviceColorPreview.ts` is an approximate CT/HS helper; assess XY and other color representations and use existing conversion utilities before claiming complete preview coverage.

## Advanced detail setting

`Settings → Preferences → Show advanced details` controls secondary IDs, field paths, raw type names and technical metadata across configuration pages. The user selected one shared setting for now. It uses explicit Save and database persistence in production; future accounts may override the same preference.

This setting changes presentation, not the configuration model or access rights. It never hides a required control, a configured non-default behavior, validation text, a warning, or an identifier needed to repair a missing reference. Advanced settings remain reachable; their customized state stays visible. Preserve dirty drafts, scroll and focus when the display preference changes.

## Device attention and logs

Overview: short issue rows containing entity, reason and relevant timestamp, linking to the filtered issue view. Issue detail: explanation, fresh evidence, effective reporting policy and direct repair link. Device and integration pages show the same reason and policy source.

The shared policy is integration default → optional device override. Device choices: inherit, custom expected interval, ignore missing-report warnings. Event-only integrations can default to no interval checks. Existing explicit availability evidence stays separate from fresh-report age. A cached retained message is historical evidence; a sensor value staying unchanged does not establish whether reports arrived.

Health warnings and recovery logs use one evaluation path and stable IDs. Emit once per transition, coalesce repeats, show timestamps with date/timezone when needed, and never flood logs every time someone opens Settings. Restart/warmup handling must avoid immediate false warnings. Disabled/ignored cases are visibly accounted for rather than counted as healthy observations.

## Consistency verification before production acceptance

Use the same small set of journeys on room, scene, connection and routine editors: open; edit; add several items; remove; follow reference and return; Save; Discard; fail validation; fail network; close with dirty state. Compare action locations and keyboard/focus behavior across all four. Automated interaction checks should target the shared components; screenshots should cover representative page families at phone, tablet and desktop widths.

Study 02 demonstrates these patterns but is not a complete production implementation. Some secondary actions still explain their intended behavior, and fixture counts/relationships are illustrative.

## Study 03 additions

Creation uses the same bottom action bar, labeled Create routine/scene; it is available for a new form before the first edit. Enable after creating is checked by default, as confirmed by the user. A created scene returns to its originating routine draft selected and does not activate. Retained drafts get a compact return-link strip.

Guided routine sequences expose consistent arrow reorder controls as an alternative to dragging. These are structural editing controls, distinct from ordinary list item menus. Color dialogs and searchable entity pickers use the same Close, Cancel and primary-action positions.

Save failures preserve values; concurrent changes need review; applied-but-not-persisted status stays visible across pages. See FINAL-PASS.md for the draft lifecycle and backend requirements.

## Study 04 presentation correction

Use the earlier routine’s dotted flow canvas, Flow/Activity/Definition navigation, and three desktop lanes as the visual reference. Ordered branches and timers extend the Then lane using open nested controls and lighter separators. Avoid replacing the full editor with large section panels. On narrow screens, lanes stack into the approved colored vertical flow.

Desktop scenes retain aligned editable table rows, including explicit, follow-device and follow-scene targets. Source controls and resolved previews belong within the row structure. Cards are the narrow-screen adaptation; they are not the desktop layout for complex targets. Existing ordinary scene rows remain the baseline.
