# Shared application navigation

Implemented 2026-09-30. The user selected **B: compact rail with an expandable
settings panel** from [Study 08](NAVIGATION-STUDY.md), simplified to open/closed
states. This replaces the earlier full shared sidebar.

[Mockup versus implementation gallery](implementation-evidence/compact-rail/index.html).

## Desktop behavior

- One shared 76 px rail on Home, Floorplan, Rooms and all configuration pages.
  Logo, Search, primary links and connection status keep their positions across
  routes. Icons have short visible captions.
- Settings adds a 248 px panel beside the rail. The total width is 324 px when
  open, 76 px when closed. There is no pinning, overlay state or stored preference.
- Clicking Settings from another area opens `/config` and its panel. Leaving
  settings closes the panel; entering settings opens it, including browser Back
  and direct links.
- Within settings, clicking Settings toggles the panel without changing the
  page. Overview opens the landing page. Navigating between categories preserves
  a deliberate collapse.
- The Close button or Escape while focus is within the panel collapses it and
  returns focus to the Settings rail link. Escape elsewhere remains available
  to the page's editor, popovers and dialogs.
- All **19 sections plus Overview** use the existing shared catalog, grouped
  under Your home, Automations, Appearance and Maintenance. Only this list
  scrolls; the active category is brought into view when navigating or reopening.
- Nested routes and legacy aliases keep the correct category highlighted.
  Modifier clicks retain normal link behavior for opening another tab.

## Phone and tablet behavior

Below the desktop breakpoint, one labeled drawer replaces the rail and panel:

- Brand and a single Close button, global Search, then the four primary links
  in a compact strip.
- On settings pages, the same complete catalog with 44 px touch rows and group
  shortcuts. The active category is visible when the drawer reopens.
- Choosing a destination dismisses the drawer. Settings opens the landing page;
  reopening navigation there reveals the categories. Outside settings the
  drawer shows primary destinations and Search.
- Dialog focus trapping, Escape/scrim dismissal, safe-area insets and visual
  viewport sizing use the existing primitives. Search closes navigation and
  focuses the command palette without stealing focus back.
- Bottom navigation and the phone AppBar's floorplan tabs remain in place.

## Integration and styling

`ui/ui/AppNavigation.tsx` owns the common layout and transient panel state;
`ui/ui/app-navigation.css` owns its styling. Theme, accent and text sizing use
the existing application tokens. Long labels wrap at larger text sizes; focus
outlines and reduced-motion behavior are explicit. The screenshot fixtures use
the approved Compact density and emerald accent.

The floorplan editor narrows its docks when the expanded panel leaves less
than 800 px of workspace, preserving usable canvas space at the 1024 px desktop
breakpoint. Closing the settings panel returns that width to the editor.
Fullscreen continues to hide navigation. Developer Refresh is available in
the shared rail/drawer. Connection status reflects the actual WebSocket state;
prototype attention badges and pinning controls were not copied.

No server endpoints, persisted configuration, household automations or physical
devices were changed.

## Verification

UI type checking, lint, **289 tests** and the production build pass. The existing
import/export cleanup warning and build chunk-size warnings remain.

Native Chromium reviews at **1440 × 1000**, **1024 × 768** and **430 × 932** cover
stable rail positions; settings entry/exit, collapse/reopen and Back; the complete
catalog and active category; fixed editor sizing; phone touch rows and group
jumps; search focus; fullscreen; enlarged text; and light/dark presentation.
All runs pass with no browser console/page errors and **zero configuration or
device writes**, using guarded local fixtures. Screenshots and results are in
[compact rail evidence](implementation-evidence/compact-rail/).

The earlier full-sidebar iteration and its acceptance captures remain in
[the previous navigation evidence](implementation-evidence/navigation/).
