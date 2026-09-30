# Shared application navigation

Implemented 2026-09-30.

## Requirement

Merge the settings sidebar, everyday navigation rail and floorplan editor's mini
rail into a consistent application layout. The previous shell explicitly chose
three different components and widths based on the route, so changing pages
replaced the navigation and moved its controls.

## Delivered

- One `AppSidebar` and `NavigationContent` composition on every desktop page:
  the same logo, Search button, primary destinations, icons, spacing, active
  styles, border and width. Width follows the selected display density, rather
  than the current page.
- Home, Floorplan, Rooms and Settings remain in the same positions. Settings
  categories appear within the shared sidebar, with a common expandable section
  and a separately scrolling list. Opening settings reveals its categories;
  their expansion is shared for the current session and can be changed with
  the chevron. Primary navigation stays visible while the categories scroll.
- The same navigation content opens from a menu button in every phone/tablet
  header. Choosing a destination dismisses the menu. Search closes the menu
  and focuses the command palette without the closing menu taking focus back.
- Bottom navigation reads the same primary destination definitions. The editor
  now has the same phone shortcuts as other pages. Its fixed canvas and editing
  tools continue to fit within the shared shell.
- Breadcrumbs only render location information; their separate settings-only
  menu was removed. Legacy settings aliases and nested routes retain their
  active category indication.
- Fullscreen hides application navigation and restores it when leaving
  fullscreen. Developer Refresh uses the shared composition.
- Remove the old settings sidebar, the editor-specific branch, the duplicate
  route lists and unused settings navigation CSS. The shared component owns
  its styling, so it works before a settings stylesheet is loaded.

## Verification

UI type checking, lint, all **278 tests** and the production build pass. Lint's
existing import/export cleanup warning and existing build chunk-size warnings
remain.

Native Chromium review at **1440 × 1000**, **1024 × 768** and **430 × 932** covers:

- Home → Floorplan → Rooms → Settings → App settings → Floorplan editor → Home.
- The same sidebar DOM element, width and primary link dimensions across
  desktop routes; no horizontal page overflow.
- The phone menu and bottom shortcuts on every page, including the editor.
- All 18 settings categories plus Overview and their icons; active parent and
  category links; expanding/collapsing categories.
- A usable editor canvas at the desktop breakpoint and on a phone.
- Search focus, Escape dismissal and fullscreen enter/exit.

All batches pass with no browser console/page errors. These checks use the
guarded local fixture and do not write configuration or command physical
devices. Results and screenshots are in
[shared navigation evidence](implementation-evidence/navigation/).
