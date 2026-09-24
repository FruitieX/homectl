# Settings detail-page mockups

Open [index.html](index.html) in a browser. The prototype is self-contained and works at desktop and phone widths. Use the left navigation (or the phone navigation), expand sections, choose **Change**, and try the scene target, room repair, condition, and device controls. All data and actions are illustrative; this file does not call the server or save configuration.

Quick previews: [scene](previews/scene-mobile.png) · [device](previews/device-mobile.png) · [room](previews/room-mobile.png) · [routine](previews/routine-mobile.png) · [connection](previews/connection-mobile.png). The [desktop scene](previews/scene-desktop.png), [scene target editor](previews/scene-target-editor.png), [room member editor](previews/room-member-editor.png), and [routine condition editor](previews/routine-condition-editor.png) show the wider layout and the in-place editing pattern.

The five views cover a scripted scene, a device with a requested/reported mismatch, a room with a missing saved member, a currently blocked routine, and a connection with no device-independent connectivity signal. The synthetic names and values are based on `ui/dev/fixtures.mjs`; the layout is a design proposal, not a screenshot of current implementation.

## Contract for implementing the design

- Each detail page has a stable URL and one compact heading. On phones, show Back + title; desktop can include breadcrumbs. The top area answers the relevant question before exposing form controls.
- A collapsed section has a useful summary. Expansion reveals **saved values and evidence**. **Change** replaces that section's read content with an editor in place, and only one section edits at once. Save and Cancel live with that editor. Commands such as Activate and power control are immediate actions and do not enter persistent edit mode.
- Entity pickers search the whole catalog by display name, room, integration and ID; selected entities remain visible. IDs and JSON paths are secondary information. Large collections are bounded, with search rather than unfiltered checkboxes.
- Scenes show a single resolved effect per device, a visual color swatch plus exact accessible text, source/precedence on demand, and unresolved references beside the action they affect. A scripted scene labels the effects as **saved targets before script**. `SceneConfig.devices`, `SceneConfig.groups`, `SceneDeviceConfig` variants, and `FlattenedSceneConfig` inform this view.
- Devices compare `ControllableDevice.state` with `last_report.state`, and include report freshness, `retained`, `matches_requested`, and availability. Do not turn API acceptance into a physical confirmation. Only capability-supported controls appear. A sensor would show its value/field history instead of light controls.
- Rooms keep direct saved members (`GroupConfig.devices`) distinct from linked rooms (`GroupConfig.groups`) and resolved membership (`FlattenedGroupConfig.device_keys`). A missing saved key remains visible with its full identifier and an in-place Replace/Remove path.
- Routines use one readable **When / Only if / Then** chain from `RoutineDefinitionV2`. Current evaluation and timestamped recorded attempts are separate from saved requirements. Condition editing uses `ValueSource`, `ValueFieldInfo`, and `ValueHistoryEntry`: choose device, then field, then comparison/value with current/recent values. Raw paths remain under Advanced.
- The connection mockup deliberately says **Enabled** and **No connection signal available**: the integration configuration has no universal bridge-health field. Device report issues are linked as evidence, without asserting that the bridge itself is offline.

## Intended behavior beyond this prototype

The HTML illustrates hierarchy and interactions. Production should keep current API mutations, section-level dirty guards/conflict handling, keyboard focus restoration, accessible combobox semantics, screen-reader announcements, pagination/windowing for 50–300 devices, and light/dark/200%-zoom checks from [`v2.md`](../../v2.md). Replace illustrative timestamps and values with real API data; show Unknown when a field or history entry is absent.
