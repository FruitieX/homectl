# homectl UI/UX modernization plan

Status: draft, 2026-09-21. Untracked durable memory — never `git add`.
Scope: the whole front end, with depth on the settings/config experience.
Companion doc: `homectl-automation-v2-implementation-plan.md` (server work).

## 0. North star

Today the config UI is an **entity database with forms on top**: 14 equally
weighted sections, raw JSON as a primary surface, five search idioms, native
`confirm()` for deletes, and no protection against losing an edit.

The target is a **live control room for the home**, where configuration is a
byproduct of using the house:

1. **Configure by doing.** Change the lights until you like them, then
   "capture" that state into a scene (SaveSceneModal already hints at this).
   Arm a timer from the room page, then "turn this into a routine".
2. **Everything previews.** No config edit ever surprises you: scenes render
   resolved colors, routines dry-run against the live snapshot or history,
   integrations test their connection, sources preview at any time of day.
3. **Curated by default, deep on demand.** Simple mode shows the ~10 controls
   that cover ~90% of setups. Expert mode reveals the rest without leaving
   the page. Nothing is removed, everything is ranked.
4. **Explain, don't just display.** "Why didn't my routine run?" and "what
   would happen if…?" are one click from anywhere, powered by routine
   history, diagnostics, and the simulator.
5. **Adaptive.** The UI learns what you use (recents, favorites, common
   edits) and reorders itself. The settings home is a to-do list, not a
   directory.

## 1. Principles

- **Task-first, not entity-first.** Users want "lights off at midnight",
  not "a routine row". Entry points are verbs; entities are the result.
- **One pattern per job.** One search bar, one destructive-confirm, one
  save model, one form framework, one empty state.
- **Progressive disclosure is a system, not a tab.** A single, persisted
  Simple/Standard/Expert level plus inline "Advanced" expanders; never a
  hidden feature that requires leaving the page.
- **Keyboard- and thumb-first.** `⌘K` on desktop, bottom sheets on phones;
  every top-10 task completable without a mouse and within 3 taps.
- **Motion with restraint.** Keep the existing 180ms page fade and reduced-
  motion support; no decorative animation that slows configuration.
- **Offline-safe.** Config writes keep the existing write-warning banner;
  no optimistic lie that silently drops on restart.

## 2. Current state (audit summary)

Grounded findings from the 2026-09-21 survey:

- **IA**: 21 routes, 14 config sections in 4 groups (`app/config/sections.ts`),
  all equal weight; hub is a card grid with a plain search input
  (`app/config/page.tsx:41-87`). Navbar labels every `/config` route
  "Settings" with no shortcut (`ui/Navbar.tsx:46-48`).
- **Size/density**: `app/config/devices/page.tsx` 1881 lines, integrations
  1882, routines 1353, scenes 1077; ~11.5k lines across config pages.
  Editing is overlay-based via `ExpandableConfigCard` + `ResponsiveOverlay`;
  long flat single-column lists for integrations/routines/scenes.
- **Forms**: only System uses react-hook-form + zod
  (`app/config/settings/page.tsx:40-44`); everything else hand-rolls state
  and string validators. Save affordances differ per page (per-card Save,
  sticky bar, Preview-gated Create, disabled-until-dirty).
- **Feedback**: native `confirm()` in ~11 places, native `alert()` for JSON
  errors (`integrations:1695-1733`, `routines:629-688`); toasts (sonner,
  already mounted in `app/providers.tsx:53`) only used in System. Radix
  `AlertDialog` exists and is imported nowhere.
- **Safety**: no dirty tracking, `useBlocker`, or `beforeunload` anywhere;
  closing an overlay mid-edit discards silently. Floorplan is the only
  surface with undo.
- **Search**: five idioms (ConfigListSearchBar, Devices filter card, hub
  Input, Logs/History select+input, Diagnostics bare input).
- **Unused assets ready to leverage**: `ui/primitives/command.tsx` (cmdk,
  vendored, zero usage), `alert-dialog.tsx`, `sheet.tsx`,
  `primitives/form-actions.tsx`, `ResponsiveOverlay` sidepanel mode.
- **Mobile**: `ResponsiveOverlay` already swaps Dialog→vaul Drawer and
  supports fullscreen; 44px touch targets. `FloorplanGridEditor` has zero
  responsive classes and is effectively desktop-only.
- **Theming**: HSL tokens in `styles/globals.css:986-1047` mapped through
  `@theme inline`; light/dark/auto in `hooks/theme.ts` (localStorage only).
  No accent, density, or font-scale controls; no server sync.
- **Strengths to preserve**: live websocket state, Monaco editors with typed
  completions, source/routine/scene preview panels, preset galleries,
  diagnostics deep links (`?q=`, `?device=`), write-warning banner, batch
  color calibration, runtime status badges, reduced-motion handling.

## 3. The core system: progressive disclosure + smart defaults

### 3.1 Experience levels

A single persisted setting with three levels, switchable inline anywhere
(and from the command palette):

| Level | Shows | Hides |
|---|---|---|
| **Simple** (default) | names, enabled, triggers, main action, colors, room assignment, schedules | JSON tabs, raw device state, rollout internals, execution policies, aliases, sensor catalogs, legacy v1 fields |
| **Standard** | + secondary fields, sensor interaction, scene links, conditions | raw JSON, internals |
| **Expert** | everything, including JSON, diagnostics payloads, v1 fallback fields | nothing |

Rules:
- Hiding is always **inline**: an "Advanced" expander reveals the relevant
  fields in place; it never forces a mode switch or a page change.
- Mode is per-user, server-synced, overridable per page ("remember for this
  page"), and announced by a subtle chip so nobody wonders where a field went.
- First-run default is Simple; the app nudges to Expert only when a task
  needs it (e.g. editing a legacy v1 row).

### 3.2 Smart defaults

- **Ranking**: order actions, presets, and sections by usage (server-side
  counters or local recents first), with pinned favorites on top.
- **Recents & favorites**: "recently edited" strip on the settings home;
  pin routines/scenes/devices to the top of their lists.
- **Pre-filled intent**: create-routine starts from "when this device
  reports…" using the last device you touched; create-scene starts from the
  current live state of the target group.
- **Sensible initial values**: no empty required fields for the common path
  (e.g. new routine pre-selects `report` trigger + the room's motion sensor).

## 4. Flagship experiences

### 4.1 Command palette (`⌘K` / `Ctrl+K`)

`cmdk` is already a dependency and `ui/primitives/command.tsx` exists unused.
Ship a global palette as the primary desktop accelerator:

- **Navigate**: any config section, room, device, scene, routine, helper.
- **Act**: create routine/scene/group; add device; connect integration;
  toggle a device; activate a scene; export backup.
- **Run**: "run routine X" (where a manual trigger exists or is added),
  "turn off all lights", "set living room to warm".
- **Explain**: "why is the office lamp on?", "what fired in the last hour?",
  "show diagnostics for this device".
- **Search-as-you-type** across entity names with scope prefixes
  (`@device`, `#scene`, `/routine`).
- Recents and frecent actions first; fully keyboard navigable; works on
  mobile as a search sheet from the bottom nav.

### 4.2 Settings home 2.0 (task-first hub)

Replace the 14-card directory with an adaptive, prioritized page:

```
┌ Settings ─────────────────────────────── ⌘K ─┐
│ [ search everything…                        ] │
│                                               │
│ Needs attention (3)            Quick actions  │
│  • 2 groups are empty          [+ Routine]    │
│  • 5 scene targets unresolved  [+ Scene]      │
│  • entryway_timer disabled     [+ Room]       │
│                                               │
│ Recent: Office lights · Circadian · Kids room │
│                                               │
│ ▸ Home            Rooms, devices, floorplan   │
│ ▸ Automations     Routines, scenes, helpers   │
│ ▸ Integrations    MQTT, circadian, timers     │
│ ▸ Appearance      Theme, dashboard, widgets   │
│ ▸ System          Server, backups, logs, diag │
└───────────────────────────────────────────────┘
```

- **Needs attention** is fed by diagnostics + health signals (unconfigured
  devices, failing integrations, unresolved references, memory-only mode)
  and each item deep-links to a pre-filtered fix view.
- **Quick actions** are the five verbs that cover most sessions; on mobile
  they become a floating action button with the same menu.
- **Groups collapse by default** (only "Needs attention", recents, and
  quick actions expanded); the full directory stays one tap away.
- **Setup status** ("18 of 22 devices assigned to rooms") replaces vanity
  counts and links to the wizard in §4.5.

### 4.3 Automation Studio

Routines, scenes, helpers, and sources are one mental model; today they are
four pages with four editors. Unify the *experience*, not the storage:

- **One editor shell** (already partly shared): Basics → Trigger →
  Condition → Program → Preview, with a persistent right-hand **live
  preview** rail on desktop (resolved scene colors, evaluated condition
  truth, planned steps, last run) and a bottom sheet on mobile.
- **Visual composer** as the default view in Simple mode: sentence-style
  rows ("When [entryway motion] [detects motion] and [nobody is home],
  [turn on] [entryway lights]"). The existing `TriggerBuilder`,
  `ConditionBuilder`, `ActionBuilder`, and `ProgramBuilder` become the
  Standard/Expert views of the same draft.
- **Dry run**: "Test this routine" evaluates the draft against the live
  snapshot (existing compile/preview machinery) or a chosen historical
  moment, showing condition truth, planned steps, and suppressed steps with
  reasons — reusing the v2 run-history rendering already built.
- **Explainability panel**: "Why did/didn't it run?" combines the last runs,
  trigger states, and diagnostics into one readable timeline with
  plain-language reasons (unknown entity, cooldown, min interval, condition
  false).
- **Routine history** becomes a tab here (route stays for deep links), with
  a timeline scrubber instead of a flat list: drag through the last 24h and
  see fired routines, device reports, and scene activations in order.

### 4.4 Preview and dry-run everywhere

Generalize the preview pattern that already works for sources and scene
colors:

- **Integrations**: "Test connection" + "preview discovered devices" before
  saving; show what a plugin instance will produce.
- **Scenes**: inline resolved-color swatches per target as you edit (the
  summary card exists; promote it into the editor) and a "capture current
  state" button.
- **Routines**: live condition truth on the trigger/condition tabs as the
  snapshot changes, plus the dry run above.
- **Devices**: "send test command" with the resulting report shown inline.
- **Migration/Import**: dry-run report rendered as a diff-like table before
  applying (the converter already emits per-row outcomes).

### 4.5 Onboarding: "Set up your home"

A guided checklist that auto-detects completion, reachable from the
settings home and as a first-run experience:

1. Connect an integration (preset gallery already exists).
2. Assign devices to rooms (bulk drag-and-drop on the floorplan or a list).
3. Name devices and hide the ones you don't care about.
4. Create your first scene (capture from live state).
5. Create your first routine (template gallery + dry run).
6. Set up the dashboard (widget gallery).

Each step links to the exact filtered view; progress persists; the checklist
collapses to a "Setup: 4/6" chip once mostly done. A "load sample home"
option (dummy integration) lets users explore without hardware.

### 4.6 Templates and presets

- **Recipe gallery** for routines: "motion light with cooldown", "turn off
  when everyone leaves", "wake-up circadian ramp", "night light", each with
  a one-line description and a dry-run before creating.
- **Fork anything**: fork a scene, routine, source preset, or room from an
  existing one (sources already do this); show a diff of what changed.
- **Suggested automations**: derived from history ("you turned off the
  office lights at ~23:00 on 6 of 7 days — create a routine?"). Always
  suggestion-first, never auto-created.

### 4.7 Mobile excellence

- Settings home becomes a **search-first sheet** with quick actions and
  needs-attention; the 14-section directory is secondary.
- Editing keeps the Dialog→Drawer switch; add a consistent sticky
  Cancel/Save footer in drawers (some pages already have it).
- **Floorplan**: add a mobile mode — pinch/zoom view with tap-to-configure
  device sheets; the grid editor shows an explicit "best on a larger
  screen" notice with a read-only fallback instead of a broken canvas.
- **Swipe actions** on list rows: enable/disable, delete (with undo toast).
- **Pull-to-refresh** for history/logs/diagnostics.

### 4.8 Contextual help and explainability

- Inline `HelpPanel` (exists) used consistently for non-obvious fields,
  written in one sentence of *why*, not restating the label.
- A searchable **glossary** (trigger, condition, program, helper, source,
  rollout, cooldown) linked from field help.
- **Empty states are onboarding**: every empty list gets a primary CTA and
  a one-line explanation (helpers/sources/routines/logs/history currently
  have dead-end text or bare divs, e.g. `routines:152-155`).

## 5. Cross-cutting foundations

### 5.1 Design tokens, theming, density

- Extend `styles/globals.css` tokens with: accent palette (a small curated
  set, not a color wheel), density (comfortable/compact), font scale, and
  corner radius. All components already consume semantic tokens.
- **Server-synced preferences** (see §7) so theme/density/mode/favorites
  follow the user across devices; keep localStorage as a fast local cache.
- Add a "Preview" swatch strip in Appearance that renders a mini settings
  card under the chosen tokens.

### 5.2 One form system

- Adopt react-hook-form + zod for every config editor; define a
  `ConfigFormField` wrapper that renders label, help, error, and advanced
  disclosure consistently.
- Schema-first: derive zod schemas from the ts-rs bindings where practical
  and share them between create/edit; validation messages are inline and
  never native `alert()`.
- **Autosave drafts** (debounced) for long editors with an explicit
  "Saved/Saving/Unsaved" indicator and a discard guard.

### 5.3 Feedback and destructive actions

- Replace every native `confirm()` with `AlertDialog` (already vendored,
  unused) that names the object and the consequence; destructive buttons
  use the destructive variant.
- Replace native `alert()` with inline errors plus a toast for background
  failures. sonner is already mounted.
- **Undo toasts** for deletes and bulk edits (5s window) backed by the
  existing API (re-create or restore revision).

### 5.4 Unsaved-change protection

- Dirty tracking + `useBlocker` + `beforeunload` for every overlay and
  editor; closing prompts "Save / Discard / Cancel".
- Per-editor draft persistence so a crash or reload restores work.

### 5.5 Undo and version history

- Generalize the floorplan undo stack into a page-level undo for config
  editors (scenes, routines, groups).
- Routine revisions already exist server-side; surface them as a version
  list with a diff ("revision 3: added cooldown step") and one-click
  restore. Extend to scenes and groups if revisions are cheap to add.

### 5.6 Bulk operations

- Multi-select mode on devices, routines, scenes, helpers: bulk enable/
  disable, assign room, rename (pattern with counter), delete, export.
- Reuse the batch calibration selection UX (`devices:1232-1312`) as the
  interaction model.

### 5.7 Search, filters, saved views

- One `SearchBar` component (fuzzy match, entity scope, `?q=` deep links)
  replaces all five idioms; `ConfigListSearchBar` becomes a thin wrapper.
- Structured filters as chips (room, type, status, integration) with a
  filter count; persist per page.
- **Saved views** ("unassigned devices", "routines that failed today")
  pinnable to the settings home.
- Virtualize long lists (devices, history, logs) and keep one-card-open
  expansion.

### 5.8 Accessibility

- Focus trap and restore on every overlay (ResponsiveOverlay), visible
  focus rings, `aria-label`s for icon buttons, form errors tied to inputs.
- Keyboard-completable top tasks; skip-to-content; announce async results
  via toasts (sonner handles `aria-live`).
- Target: axe-clean on the top 10 pages; contrast checked for both themes.

### 5.9 Performance and polish

- Skeletons instead of spinners for lists/panels; prefetch on hover for
  detail overlays; debounced live state updates on heavy pages.
- Consistent empty, loading, error, and "no results" states from
  `EmptyState`.
- Keep the existing page transition; add `layout` motion only where it
  clarifies (e.g. filter chip reflow), respecting reduced motion.

## 6. Information architecture changes

- **Naming**: call the hub **Settings** everywhere (drop "Configuration",
  "System" for the app-level page → "General"). Navbar shows breadcrumbs
  (Settings / Automations / Routines) instead of a single back chevron.
- **Merges**:
  - Import/Export + TOML Migration → **Backups & Migration** (one page,
    two tabs, with dry-run previews).
  - Routine History → tab under Routines (route kept as a deep link).
  - Diagnostics + Logs → **Health** group on the settings home (keep both
    pages; cross-link with filters).
- **Groups** (settings home, collapsed by default):
  - **Home**: Rooms, Devices, Floorplan.
  - **Automations**: Routines, Scenes, Helpers, Sources.
  - **Integrations**: plugin instances, schedules, virtual devices.
  - **Appearance**: Theme, Dashboard, Widgets, Layout.
  - **System**: Server, Backups & Migration, Health, Access.
- **Desktop rail** gets a Settings shortcut and the palette hint; mobile
  bottom nav keeps 4 tabs with a search/settings entry.

## 7. API/DB implications

Each item is a full-stack slice; follow the repo's "DB is canonical for
user-managed config" policy and regenerate ts-rs bindings.

- **`ui_preferences`** (new table): per-user (single-user install today, but
  keyed) experience level, theme, density, accent, favorites, recents,
  saved views, per-page overrides. New CRUD endpoints under
  `/api/v1/config/ui-preferences`, included in export/import with
  default-empty backward compatibility.
- **Routine simulate/dry-run endpoint** if the existing preview machinery
  isn't reachable from the API: `POST /api/v1/config/routines/:id/simulate`
  running the compiled definition against a snapshot or a supplied context
  (read-only, no dispatch, reuses `core::automation` planning).
- **Manual routine trigger** (nice-to-have, also fixes the current testing
  gap): `POST /api/v1/config/routines/:id/trigger` that dispatches the v2
  program once, recorded in history as `force_trigger`.
- **Revision history**: surface existing routine revisions via
  `/config/routines/:id/revisions`; add revisions for scenes/groups only if
  cheap (otherwise client-side undo is enough).
- **Usage counters** for smart defaults: either server-side aggregate
  (privacy-light, single user) or client-only recents; decide in Phase 1.
- **Optional assistant** (Phase 5, experimental): `POST
  /api/v1/config/assistant/draft` maps a natural-language request to a v2
  definition draft, validated by the compiler, returned but never applied;
  provider configured server-side via `HOMECTL_ASSISTANT_*` env vars, opt-in
  (`GET /config/assistant/status`), no always-on external dependency. Prompts
  are not stored; drafts are not logged to routine history.

## 8. Roadmap

Each phase ships independently; all phases keep `pnpm tsc`, `pnpm lint`,
`pnpm build` green (no UI test runner exists today — Phase 0 adds vitest
for `lib/` logic and schema tests).

**Phase 0 — Foundations (1–2 slices).**
`ui_preferences` table + endpoints + bindings; token extensions (accent,
density, font scale); `ConfigFormField` + zod adoption for one page as a
pilot; AlertDialog + toasts replace native confirm/alert; dirty tracking +
`useBlocker`; skeletons/empty states. *Acceptance:* zero native
`confirm`/`alert` in `ui/`; closing any editor prompts; preference changes
persist across reloads and devices.

**Phase 1 — Settings home + palette.**
Settings home 2.0 (search, needs attention, quick actions, recents,
collapsed groups); global `⌘K` palette over navigation + entities + actions;
breadcrumbs; IA merges (Backups & Migration, History tab). *Acceptance:*
every top-10 task reachable in ≤3 actions; palette covers navigate/create/
explain; hub loads in one screen on mobile.

**Phase 2 — Consistency and simplification.**
One SearchBar everywhere; Simple/Standard/Expert levels with inline
Advanced expanders on devices/integrations/routines/scenes; bulk operations;
saved views; destructive-action polish; per-page save model unified
(autosave + explicit indicator). *Acceptance:* Simple mode can complete the
documented top tasks without opening Expert; no page uses a bespoke search
input.

**Phase 3 — Automation Studio.**
Unified editor shell with live preview rail; sentence-style composer in
Simple mode; dry-run against live/historical state; explainability panel;
history timeline scrubber; manual trigger endpoint. *Acceptance:* a user can
author, dry-run, and explain a routine without seeing JSON or leaving one
page.

**Phase 4 — Mobile, onboarding, templates.**
Setup checklist + sample home; recipe gallery with dry-run; suggested
automations from history; floorplan mobile mode; swipe actions and
pull-to-refresh. *Acceptance:* setup checklist completes end-to-end on a
phone; floorplan is usable (or clearly read-only) on small screens.

**Phase 5 — Experimental assistant.**
Opt-in NL→draft endpoint with compiler validation and history audit;
surfaced in the composer as "describe it". *Acceptance:* drafts are always
validated, never auto-applied, and disable cleanly when unconfigured.

## 9. Success metrics

- **Taps/clicks to task**: theme ≤2, rename device ≤3, add routine ≤3,
  explain a run ≤1 from history.
- **Simple-mode coverage**: ≥80% of config sessions complete without
  switching to Expert.
- **Zero** native `confirm`/`alert`; zero silent edit loss.
- **Palette adoption**: used in ≥30% of desktop config sessions.
- **A11y**: axe-clean on the top 10 pages; all top tasks keyboard-only.
- **Mobile**: Lighthouse ≥95 on settings home; no page requires pinch-zoom.

## 10. Open questions

1. Server-synced preferences vs localStorage only (recommend server, per
   the DB-canonical policy; single user makes it cheap).
2. Keep `/config/routine-history` as a public route forever, or redirect to
   the Routines tab after a deprecation window?
3. Scope of undo: client-side per-editor only, or server-backed revision
   restore for scenes/groups too?
4. Density default: comfortable (recommend) vs compact for power users.
5. Assistant provider: none until Phase 5; if added, which endpoint and
   model, and does it need to be off by default?
6. Does the desktop rail become a full icon+label sidebar, or stay a rail
   with the palette as the primary accelerator?

## 11. As-built status (2026-09-21, branch `ui-ux`)

Implemented in order, one commit per phase. Verification for every phase:
`pnpm tsc`, `pnpm lint`, `pnpm build` green; `pnpm test` (node:test) green
for the new `lib/` unit tests.

- **Phase 0 — done** (`2b4b66bd`). Preferences (experience/density/accent/
  favorites/recents) with pre-hydration flash prevention; Appearance controls
  on the System page; `Advanced`/`ExperienceOnly` primitives; themed
  `confirmDialog`/`confirmDestructive` replacing every native confirm/alert;
  `ResponsiveOverlay` guard + beforeunload; sonner error toasts; node:test
  runner with preference unit tests.
  - *Deferred:* server-synced `ui_preferences` (open question 1). Preferences
    are localStorage-only for now behind a single `hooks/preferences.ts`
    surface, so a server backend can be swapped in without touching callers.
- **Phase 1 — done** (`6c6d8986`). Command palette on **Ctrl+K and Ctrl+P**
  (both intercepted; the footer documents the shortcut) over navigation,
  create actions, appearance toggles, and all entities; discovery via navbar
  search field (desktop), navbar icon (mobile), bottom-nav Search tab, and
  desktop rail Search entry; task-first settings home (search, quick actions,
  Needs attention, Recent, collapsible groups); breadcrumbs; IA merges as
  link tabs (Routines/History, Backups/Migration); `?new=1` and `?q=` deep
  links for create flows and prefilters.
- **Phase 2 — partial** (`c08c7b58`). Expert surfaces gated (device Raw,
  integration/routine JSON, scene scripts, execution policy behind Advanced);
  routine selection mode with bulk enable/disable/delete and a proper empty
  state.
  - *Deferred:* consolidating the remaining bespoke search inputs (Devices
    filter card, Logs/History/Diagnostics) into the shared search bar; saved
    views; device/scene bulk operations; undo stacks and revision history UI.
- **Phase 3 — partial** (`0ff9d865`). Plain-language "why it ran or didn't"
  summary on every routine history entry (triggers, condition truth/unknown
  reason, policy rejection, step dispositions, queue drops).
  - *Deferred (server work):* `POST /config/routines/:id/simulate` dry-run and
    a v2 manual trigger endpoint. The actor's dispatch path synthesizes a
    frame with predicate/timer intents and script admissions, so a forced run
    needs a dedicated event and careful history/rate-limit handling; the
    existing card status badges and run trace cover live preview meanwhile.
  - *Deferred (client):* sentence-style composer mode and the history
    timeline scrubber.
- **Phase 4 — partial** (`edb85148`). Setup checklist on the settings home
  (integration → rooms → scene → routine) with progress and deep links;
  narrow-screen floorplan notice linking to the read-only map. Routine
  creation already had template presets, so the recipe gallery shipped.
  - *Deferred:* history-derived "suggested automations" (needs usage
    heuristics and a suggestion UI decision) and swipe actions.
- **Phase 5 — done** (`00f91fa0`, `e084c6b9`, `95d5e822`). OpenAI-compatible
  assistant configured in Settings and stored in the database under the
  reserved `assistant` widget setting (`GET`/`PUT
  /config/assistant/settings`, API key masked and redacted from exports);
  `HOMECTL_ASSISTANT_BASE_URL`/`_MODEL`/`_API_KEY`/`_TIMEOUT_MS`/`_TIMEZONE`
  remain as fallback defaults until stored settings exist. This covers hosted
  providers and local runtimes (Ollama,
  LM Studio) with the same code path. `GET /config/assistant/status` reports
  whether the feature is configured (the UI hides it otherwise);
  `POST /config/assistant/draft` grounds the model in a catalog of live
  entities, validates the returned definition with the v2 compiler, repairs
  once on validation errors, falls back when a provider rejects
  `response_format` or `reasoning_effort`, and returns the draft plus warnings.
  `HOMECTL_ASSISTANT_MAX_TOKENS` and `HOMECTL_ASSISTANT_REASONING_EFFORT`
  tune thinking models. Drafts are never
  persisted or enabled; the composer loads them into the editor, suggests
  name/id while empty, and shows the assumption notes. Covered by unit tests
  (extraction, validation, catalog, timezone inference) and an integration
  test with a mock provider (gating, valid draft, repair, exhausted repairs,
  json-mode fallback, provider failure, empty prompt).
  - *Deferred:* history audit rows for assistant requests (prompts are not
    stored; logs carry hashes only via provider logs), assistant editing of an
    existing routine, and rate limiting beyond the provider's own.
- **Floorplan AI actions — done** (`e2d57e43`, follow-up commit). A floorplan
  toolbar &quot;Ask AI&quot; button opens a prompt dialog (scoped to the current
  selection when one exists) that posts to `POST /config/assistant/apply`; the
  server grounds the model in the controllable-device catalog with group
  membership, validates every requested change, and applies it through the
  normal device command path. One-off states are never stored as routines.
  Device websocket updates are now explicit upsert/removal patches with a
  monotonic revision (full state on connect or after a client-detected gap),
  fixing stale floorplan state after control changes.

### Follow-ups worth doing next

1. Server-synced preferences (`ui_preferences` table + endpoints + bindings).
2. Manual v2 trigger + simulate endpoints (also closes the production
   testing gap noted during the automation migration).
3. Devices bulk operations (assign room, enable/hide, delete) and undo toasts.
4. Suggested automations from routine history.
