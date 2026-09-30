# Shared sidebar concept study

Requested 2026-09-30. Status: **B selected and implemented**, with the simpler
open/closed behavior below. The original concepts remain as a design archive.

## Confirmed implementation direction

- Keep the compact labeled rail and expandable settings panel from B.
- Remove pinning and overlay states: the panel is either open beside the rail
  or closed, with no stored preference.
- Leaving settings closes the panel. Entering settings opens it, including
  direct links and browser Back.
- Clicking Settings from another area opens `/config` with its panel open.
- Within settings, Settings toggles the panel without changing the page.
  Overview is the panel's landing-page link. Close or Escape while focused in
  the panel collapses it and returns focus to Settings.
- Retain the shared phone drawer, search, category shortcuts and bottom
  navigation. Keep the floorplan selector in the phone AppBar.

See [implementation and verification](UNIFIED-NAVIGATION.md) and the
[mockup versus implementation screenshots](implementation-evidence/compact-rail/index.html).

## User direction

- Compare a refined full sidebar against a compact rail with an expandable
  settings panel.
- Focus on hierarchy, spacing and settings navigation.
- Retain the approved Compact colors and spacing, household-friendly labels,
  consistent navigation across pages, and equal phone/desktop consideration.

[Open screenshot comparison](navigation-review.html) ·
[Open interactive study](navigation-study.html).

## Investigation

`ui/ui/AppNavigation.tsx` already provides one shared composition for desktop
and phone. The four everyday destinations and 19 configuration sections come
from the current navigation/category catalogs. The new study preserves them,
including Blocks. No new server entities or navigation destinations are needed.

Current weaknesses in the fixture capture:

- The active Settings parent looks almost identical to its active child.
- Everyday and configuration links have little difference in hierarchy.
- Long labels wrap while shorter labels occupy much less height.
- Four primary rows consume vertical space needed by the settings catalog.
- The list has weak cues about which part scrolls or how to reach later groups.

The concepts reorder items within the existing groups: Rooms & groups and
Devices before connections; Scenes and Routines before Timers; routine activity
and computed sources follow the main automation editors. Changing destinations
or the four category names is outside this study.

## A — refined full sidebar

- 244 px full sidebar; optional 76 px collapsed rail.
- Brand/collapse, Search, then fixed Home/Floorplan/Rooms/Settings positions.
- Settings is a disclosure/parent, with Overview as the sole landing-page link.
- The actual category gets the filled active row and a short accent marker.
  The Settings parent uses text emphasis rather than a duplicate filled row.
- Secondary rows are 31 px at the preview's normal desktop text size. Icons,
  labels and group headings align; labels fit on one line in this example.
- Only the category list scrolls. Connection status stays at the bottom.
- Collapsing preserves navigation in the rail. Settings can open as a floating
  panel without consuming additional content width.

Tradeoff: the primary links and settings share one column, so the last category
requires scrolling at the captured 1440 × 1000 desktop size.

## B — compact rail with a settings panel

- A persistent 76 px rail with icons **and short text labels**; no hover-only
  identification of the primary destinations.
- A 248 px settings panel can be pinned (324 px total width), unpinned (overlay)
  or closed. Pinning is an explicit user action, never an automatic route change.
- Each navigation level has its own active state: the rail identifies the
  application area; the panel identifies the category.
- The settings panel starts near the top, so all 19 sections plus Overview fit
  at the captured desktop height. Shorter windows still scroll.
- Opening settings on a canvas can overlay it; closing restores the rail-only
  workspace. Primary buttons stay in the same position on every page.

Tradeoff: the pinned version uses 80 px more width than A. An unpinned panel
covers part of the content until closed. It is useful for temporary navigation,
while pinning suits repeated configuration work.

Initial recommendation: B with an unpinned panel for canvas/configuration use;
A remains the simpler option for fully labeled daily navigation. Review before
settling either default. Both could be states of one shared component rather
than independent page-specific sidebars.

## Common phone layout

- Both concepts become the same labeled drawer, up to 340 px wide, with a single
  close button in the brand/header row.
- Everyday destinations form a four-item strip. The bottom navigation remains
  available when the drawer is closed.
- Settings retain 44 px touch rows and scroll independently of the page.
- Group shortcuts jump directly to Home, Automations, Appearance or Maintenance.
  This is scrolling within one catalog, not a second set of destinations.
- The current category is brought into view when reopening navigation.
- Choosing a destination, close, scrim tap or Escape dismisses the drawer.
- Keep the floorplan tabs in the existing phone AppBar position, beside the
  assistant button. Do not introduce another selection row.

## Prototype scope

Standalone HTML/CSS/JS; works from a local file and makes no API requests. The
routine, home and floorplan surroundings use synthetic data. Counts, connection
state and timestamps illustrate presentation only. Search filters prototype
navigation destinations; it does not replace the real global command palette.
Page-editor fields and household actions are decorative in this study.

Interactive: concept/context/theme switching, category navigation, Settings
disclosure, collapsing/expanding, rail panel pin/unpin/close, phone drawer and
group shortcuts, command-palette search with Ctrl+K or Cmd+K, Escape dismissal.

The decisions above supersede the prototype's pinning and persistence options.
On kiosk/fullscreen
screens, preserve the existing policy of hiding application navigation. Actual
implementation must use the existing drawer/dialog focus handling, accessible
labels, keyboard navigation, reduced-motion support, text wrapping at zoom and
safe-area insets. The study does not introduce saved preferences or a new API.

## Files

- `navigation-review.html`: screenshot gallery, tradeoffs, current reference.
- `navigation-study.html` / `.css` / `.js`: interactive examples.
- `previews/navigation-study/`: desktop/phone screenshots and verification.

## Verification

Native Chromium at 1440 × 1000 and 430 × 932 passes 30 interaction checks
with no console/page errors. Checks cover the complete category catalog, active
hierarchy, collapse/expand, pin/unpin, stable canvas width with the floating
panel, outside/Escape dismissal, phone touch rows, group jumping, bringing the
active category into view, global search and light/dark previews.

Seven presentation states were also captured without browser errors. Study results:
[verification](previews/navigation-study/verification.log). No production files,
server configuration or live devices were changed during the concept study.
Production verification is recorded separately in the implementation document.
