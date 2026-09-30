/* Standalone concept: synthetic data, no API calls or configuration writes. */
const glyphs = {
  house: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7",
  home: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16",
  rooms: "m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  search: "M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14ZM15 15l6 6",
  arrow: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  left: "m14 5-7 7 7 7",
  close: "m6 6 12 12M18 6 6 18",
  moon: "M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1",
  plug: "M8 2v5M16 2v5M5 7h14M7 7v5a5 5 0 0 0 10 0V7M12 17v5",
  bulb: "M9 18h6M10 21h4M8 15a7 7 0 1 1 8 0l-1 3H9Z",
  radio:
    "M12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4ZM8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14",
  database:
    "M3 6c0-4 18-4 18 0s-18 4-18 0Zm0 0v12c0 4 18 4 18 0V6M3 12c0 4 18 4 18 0",
  palette:
    "M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 2-5c-1-1 0-3 2-3h2c3 0 2-10-7-10ZM7 8h.01M12 6h.01M17 8h.01M6 13h.01",
  routine: "M3 3h6v6H3ZM15 15h6v6h-6ZM6 9v9h9M6 12h12V6h-5",
  blocks: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  variable: "M8 3H5v18h3M16 3h3v18h-3M9 8l6 8M15 8l-6 8",
  timer: "M9 2h6M12 6a8 8 0 1 0 0 16a8 8 0 0 0 0-16ZM12 9v5l3 2M17 5l2-2",
  history: "M3 4v5h5M3 9a9 9 0 1 1 1 9M12 7v5l3 2",
  calculator:
    "M5 3h14v18H5ZM8 6h8M8 10h1M15 10h1M8 14h1M15 14h1M8 18h1M15 18h1",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  shield: "M12 3 3 6v6c0 5 9 9 9 9s9-4 9-9V6ZM12 8v5M12 16h.01",
  logs: "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5",
  backup: "M3 5h18v5H3ZM5 10v11h14V10M9 14h6",
  sparkle: "m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2ZM20 2v4M18 4h4",
  maximize: "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6",
  pin: "M8 3h8l-1 6 3 4H6l3-4ZM12 13v8",
  unpin: "m3 3 18 18M8 3h8l-1 6 3 4M6 13h7M12 13v8",
  external: "M14 3h7v7M21 3l-10 10M10 3H3v18h18v-7",
  plus: "M12 5v14M5 12h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  up: "m6 15 6-6 6 6",
  play: "m8 5 12 7-12 7Z",
  thermometer: "M10 14V5a2 2 0 0 1 4 0v9a5 5 0 1 1-4 0ZM12 9v8",
  humidity: "M12 3C9 8 5 10 5 15a7 7 0 0 0 14 0c0-5-4-7-7-12Z",
  sliders:
    "M5 3v8m0 4v6M12 3v3m0 4v11M19 3v11m0 4v3M3 11h4v4H3ZM10 6h4v4h-4ZM17 14h4v4h-4Z",
  minus: "M5 12h14",
  crosshair:
    "M12 2v5M12 17v5M2 12h5M17 12h5M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10Z",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${glyphs[name] || glyphs.settings}"/></svg>`;
const groups = [
  [
    "Your home",
    [
      ["groups", "Rooms & groups", "rooms"],
      ["devices", "Devices", "bulb"],
      ["integrations", "Connections & services", "plug"],
      ["sensors", "Sensor catalog", "radio"],
      ["widget-sources", "Widget sources", "database"],
    ],
  ],
  [
    "Automations",
    [
      ["scenes", "Scenes", "palette"],
      ["routines", "Routines", "routine"],
      ["timers", "Timers", "timer"],
      ["blocks", "Blocks", "blocks"],
      ["helpers", "Helpers", "variable"],
      ["sources", "Computed sources", "calculator"],
      ["routine-history", "Routine activity", "history"],
    ],
  ],
  [
    "Appearance",
    [
      ["floorplan", "Floorplan", "map"],
      ["dashboard", "Dashboards", "home"],
      ["settings", "App & system", "settings"],
    ],
  ],
  [
    "Maintenance",
    [
      ["diagnostics", "Check for problems", "shield"],
      ["sensor-history", "Sensor activity", "activity"],
      ["logs", "Logs", "logs"],
      ["import-export", "Backups & restore", "backup"],
    ],
  ],
];
const primary = [
  ["home", "Home", "house"],
  ["map", "Floorplan", "map"],
  ["rooms", "Rooms", "rooms"],
];
const q = new URLSearchParams(location.search);
const state = {
  direction: q.get("direction") === "rail" ? "rail" : "full",
  context: q.get("context") || "routine",
  theme: q.get("theme") === "dark" ? "dark" : "light",
  category: "routines",
  expanded: q.get("settings") !== "closed",
  collapsed: q.get("collapsed") === "true",
  panelOpen: q.get("panel") !== "closed",
  pinned: q.get("pinned") !== "false",
  mobileOpen: q.get("menu") === "open",
};
if (q.get("layout") === "desktop") document.body.classList.add("force-desktop");
const mobile = () =>
  innerWidth <= 950 && !document.body.classList.contains("force-desktop");
const selectedPrimary = () =>
  state.context === "routine" ? "settings" : state.context;
function item(slug, label, glyph, setting = false) {
  const active = setting
    ? state.context === "routine" && state.category === slug
    : state.context === slug;
  return `<a href="#${setting ? "config/" : ""}${slug}" data-${setting ? "category" : "view"}="${slug}" class="nav-item${active ? " active" : ""}"${active ? ' aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span>${slug === "diagnostics" ? '<span class="count" aria-label="2 devices need attention">2</span>' : ""}</a>`;
}
function settingsList() {
  return `<div class="settings-scroll" aria-label="Settings categories">${item("overview", "Overview", "home", true)}${groups.map(([label, items], i) => `<section class="nav-group" id="nav-group-${i}"><h3>${label}</h3>${items.map((x) => item(...x, true)).join("")}</section>`).join("")}</div>`;
}
function fullSidebar(extra = "") {
  const settingsActive = state.context === "routine";
  return `<aside class="app-sidebar ${extra}" aria-label="Application navigation"><div class="brand"><a class="brand-mark" href="#home" data-view="home" aria-label="homectl home">${icon("house")}</a><a href="#home" data-view="home">homectl</a><button class="icon-button desktop-collapse" data-action="collapse" aria-label="Collapse sidebar" title="Collapse sidebar">${icon("left")}</button><button class="icon-button mobile-close" data-action="close-mobile" aria-label="Close navigation">${icon("close")}</button></div><button class="search-trigger" data-action="search">${icon("search")}<span>Search your home</span><kbd>Ctrl K</kbd></button><nav class="primary-nav" aria-label="Primary navigation">${primary.map((x) => item(...x)).join("")}<button class="nav-item${settingsActive ? " parent-current" : ""}" data-action="settings" aria-expanded="${state.expanded}">${icon("settings")}<span>Settings</span>${icon("down").replace("<svg", '<svg class="chevron"')}</button></nav>${state.expanded ? `<div class="mobile-jumps" role="group" aria-label="Jump to settings group">${groups.map(([label], i) => `<button data-jump="${i}" class="${i === 1 && settingsActive ? "current" : ""}">${i === 0 ? "Home" : label}</button>`).join("")}</div>${settingsList()}` : '<div class="settings-scroll"></div>'}<div class="nav-footer"><i class="status-dot"></i><span>Connected</span><span>Europe/Helsinki</span></div></aside>`;
}
function rail(extra = "") {
  return `<nav class="rail ${extra}" aria-label="Primary navigation"><a class="brand-mark" href="#home" data-view="home" aria-label="homectl home">${icon("house")}</a><button class="icon-button rail-search" data-action="search" title="Search your home" aria-label="Search your home">${icon("search")}</button><div class="rail-primary">${[...primary, ["settings", "Settings", "settings"]].map(([slug, label, glyph]) => `<${slug === "settings" ? "button" : "a"} ${slug === "settings" ? 'data-action="panel"' : `href="#${slug}" data-view="${slug}"`} class="rail-link${selectedPrimary() === slug ? " active" : ""}"${selectedPrimary() === slug ? ' aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span></${slug === "settings" ? "button" : "a"}>`).join("")}</div><div class="rail-bottom"><button class="icon-button" data-action="expand" title="Expand navigation" aria-label="Expand navigation">${icon("arrow")}</button><i class="status-dot" title="Connected"></i></div></nav>`;
}
function railPanel() {
  return `<aside class="rail-panel${!state.panelOpen ? " hidden" : ""}${!state.pinned || state.collapsed ? " floating" : ""}" aria-label="Settings panel"><div class="rail-panel-header"><h2>Settings</h2><button class="icon-button" data-action="pin" aria-label="${state.pinned ? "Unpin" : "Pin"} settings panel" aria-pressed="${state.pinned}" title="${state.pinned ? "Unpin: float over the page" : "Pin: reserve space for the panel"}">${icon(state.pinned ? "pin" : "unpin")}</button><button class="icon-button" data-action="panel" aria-label="Close settings panel" title="Close settings panel">${icon("close")}</button></div>${settingsList()}<div class="nav-footer"><span>Configuration</span><span>19 sections</span></div></aside>`;
}
const field = (label, value, glyph) =>
  `<div class="field"><label>${label}</label><div class="field-value">${glyph ? icon(glyph) : ""}${value}${icon("down").replace("<svg", '<svg class="end"')}</div></div>`;
function routine() {
  return `<main class="page"><header class="pagehead"><div><h1>Evening lighting</h1><p>Turn on a warm scene when the living room is occupied.</p><small>${icon("history")}Saved · Last ran today at 19:42</small></div><div class="head-actions"><span class="enabled"><i class="switch"></i>Enabled</span><button class="quiet-button">${icon("play")}Run now</button><button class="icon-button" aria-label="Routine options">${icon("more")}</button></div></header><div class="flow-canvas"><div class="flow-top"><section class="flow-column"><h2 class="flow-heading">${icon("radio")}WHEN · Start</h2><article class="flow-block"><header class="flow-block-header">${icon("activity")}Sensor changes</header><div class="flow-body"><div class="field-row">${field("Sensor", "Living room motion", "radio")}${field("Value", "Occupied")}</div><div class="technical">zigbee2mqtt / living_room_motion</div></div></article><button class="flow-add">${icon("plus")}Add another start</button></section><section class="flow-column condition"><h2 class="flow-heading">${icon("sliders")}IF · Conditions</h2><article class="flow-block"><header class="flow-block-header">${icon("moon")}After sunset</header><div class="flow-body"><div class="field-row">${field("Time window", "Sunset → 23:00")}${field("Timezone", "Europe/Helsinki")}</div><div class="technical">All conditions must match</div></div></article><button class="flow-add">${icon("plus")}Add a condition</button></section></div><div class="flow-join"><span>Continue when matched</span></div><h2 class="flow-heading actions-heading">${icon("play")}THEN · Actions</h2><article class="action-block"><span class="step-number">1</span><div class="action-body"><h3 class="action-title">${icon("palette")}Activate scene<a href="#config/scenes" data-category="scenes" class="quiet-link">Open scene ${icon("external")}</a></h3><div class="field-row">${field("Scene", "Evening", "palette")}${field("Apply to", "Living room", "rooms")}</div></div><div class="action-controls"><button class="icon-button" aria-label="Move action up">${icon("up")}</button><button class="icon-button" aria-label="Move action down">${icon("down")}</button><button class="icon-button" aria-label="Action options">${icon("more")}</button></div></article><article class="action-block"><span class="step-number">2</span><div class="action-body"><h3 class="action-title">${icon("timer")}Wait</h3><div class="field-row">${field("Duration", "2 minutes")}${field("Then", "Check occupancy again")}</div></div><div class="action-controls"><button class="icon-button" aria-label="Move action up">${icon("up")}</button><button class="icon-button" aria-label="Move action down">${icon("down")}</button><button class="icon-button" aria-label="Action options">${icon("more")}</button></div></article><button class="flow-add">${icon("plus")}Add an action</button></div><footer class="routine-meta"><span>No concurrent runs</span><span>6 runs today · No failures</span><a href="#config/routine-history" data-category="routine-history">View activity ${icon("arrow")}</a></footer></main>`;
}
function mapSvg(small = false) {
  return `<svg viewBox="0 0 760 540" xmlns="http://www.w3.org/2000/svg" aria-label="Example home floorplan"><g transform="translate(85 55)"><path d="M0 0H590V430H0ZM340 0V250H590M0 250H340M235 250V430" fill="none" stroke="${state.theme === "dark" ? "#697c6d" : "#5d7062"}" stroke-width="9"/><g fill="${state.theme === "dark" ? "#23362b" : "#eef3ec"}" stroke="${state.theme === "dark" ? "#687e6b" : "#a0b39f"}" stroke-dasharray="5 5" stroke-width="1.2"><rect x="16" y="16" width="309" height="216" rx="3"/><rect x="355" y="16" width="219" height="216" rx="3"/><rect x="16" y="265" width="201" height="149" rx="3"/><rect x="251" y="265" width="323" height="149" rx="3"/></g><g font-family="Inter,system-ui" font-size="${small ? 17 : 12}" fill="${state.theme === "dark" ? "#adbeaf" : "#718675"}" text-anchor="middle"><text x="169" y="45">Living room</text><text x="465" y="45">Kitchen</text><text x="117" y="292">Office</text><text x="412" y="292">Bedroom</text></g><g fill="#efd5a2" stroke="#d2b980" stroke-width="2"><circle cx="80" cy="100" r="${small ? 10 : 9}"/><circle cx="260" cy="180" r="9"/><circle cx="465" cy="120" r="9"/><circle cx="114" cy="342" r="9"/></g><g fill="none" stroke="#95aa83" stroke-width="3"><circle cx="80" cy="100" r="14"/><circle cx="260" cy="180" r="14"/><circle cx="465" cy="120" r="14"/><circle cx="114" cy="342" r="14"/></g><g fill="${state.theme === "dark" ? "#44584b" : "#d7dfd6"}" stroke="#adbbae" stroke-width="2"><rect x="70" y="172" width="146" height="37" rx="6"/><rect x="374" y="168" width="100" height="28" rx="3"/><rect x="365" y="322" width="104" height="75" rx="4"/></g></g></svg>`;
}
function home() {
  return `<main class="page"><header class="pagehead"><div><h1>Home</h1><p>Wednesday, 30 September · 19:45</p></div><button class="quiet-button">${icon("sliders")}Customize</button></header><div class="attention">${icon("shield")}2 devices need attention<a href="#config/diagnostics" data-category="diagnostics">Review</a></div><div class="room-grid">${[
    ["Living room", "3 of 4 lights on", "Evening"],
    ["Kitchen", "2 lights on", "Cooking"],
    ["Office", "Lights off", "Normal"],
  ]
    .map(
      ([name, status, scene]) =>
        `<a class="room-card" href="#rooms" data-view="rooms"><header>${name}${icon("arrow")}</header><small>${status}</small><div class="mini-map">${mapSvg(true)}</div><div class="room-scene"><i class="light-dot"></i>${scene} scene</div></a>`,
    )
    .join(
      "",
    )}</div><div class="dashboard-lower"><section class="widget"><h2>Scenes</h2>${["Evening", "Reading", "All lights off"].map((name, i) => `<div class="scene-row"><i class="light-dot" style="background:${["#ebcb96", "#f1e3c3", "#b5c1b7"][i]}"></i><span>${name}</span><button class="icon-button" aria-label="Activate ${name}">${icon("play")}</button></div>`).join("")}</section><section class="widget"><h2>Indoor climate</h2>${[
    ["Living room", "21.4°", "43%"],
    ["Kitchen", "22.1°", "46%"],
    ["Bedroom", "20.8°", "42%"],
  ]
    .map(
      ([name, temp, humidity]) =>
        `<div class="climate-row">${icon("thermometer")}${name}<strong>${temp}</strong><small>${humidity}</small></div>`,
    )
    .join("")}</section></div></main>`;
}
function categoryPage() {
  const section = groups
    .flatMap(([, items]) => items)
    .find(([slug]) => slug === state.category);
  const [slug, label, glyph] = section || ["overview", "Settings", "settings"];
  return `<main class="page"><header class="pagehead"><div><h1>${label}</h1><p>${slug === "overview" ? "Manage your home, automations and displays." : "Configuration · " + groups.find(([, items]) => items.some(([id]) => id === slug))?.[0]}</p></div></header><section class="category-page"><h2>${icon(glyph)} ${label}</h2><p>This destination is represented in the navigation study. The routine, home and floorplan screens provide the surrounding layout examples.</p><button class="quiet-button" data-category="routines">${icon("routine")}Back to routine example</button></section></main>`;
}
function render() {
  document.body.dataset.theme = state.theme;
  document
    .querySelectorAll("[data-direction]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.direction === state.direction),
    );
  document
    .querySelectorAll("[data-context]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.context === state.context),
    );
  document.querySelector("#theme").innerHTML = icon(
    state.theme === "dark" ? "sun" : "moon",
  );
  document.querySelector("#theme").title =
    state.theme === "dark" ? "Preview light theme" : "Preview dark theme";
  const inSettings = state.context === "routine";
  const categoryLabel =
    state.category === "routines"
      ? "Routines"
      : groups
          .flatMap(([, items]) => items)
          .find(([slug]) => slug === state.category)?.[1] || "Overview";
  const content =
    state.context === "home"
      ? home()
      : state.context === "map"
        ? `<div class="map-stage">${mapSvg()}<div class="map-tools"><button class="quiet-button">${icon("sliders")}View</button><button class="quiet-button">${icon("crosshair")}Select</button></div><div class="map-bottom"><button class="icon-button">${icon("minus")}</button><span>100%</span><button class="icon-button">${icon("plus")}</button><button class="icon-button">${icon("maximize")}</button></div></div>`
        : state.context === "rooms"
          ? home().replace("<h1>Home</h1>", "<h1>Rooms & groups</h1>")
          : state.category === "routines"
            ? routine()
            : categoryPage();
  document.querySelector("#app").innerHTML =
    `<div class="app ${state.mobileOpen ? "mobile-open" : ""} ${state.collapsed && state.direction === "full" ? "sidebar-collapsed" : ""}">${state.direction === "full" ? fullSidebar() + rail("collapsed-rail") + (state.collapsed ? railPanel() : "") : rail() + railPanel() + fullSidebar("rail-mobile-sidebar")}<button class="scrim" data-action="close-mobile" aria-label="Close navigation"></button><section class="workspace"><header class="appbar"><button class="icon-button mobile-menu" data-action="open-mobile" aria-label="Open navigation">${icon("menu")}</button><div class="breadcrumb ${state.context === "map" ? "map-title" : ""}">${inSettings ? `<a data-category="overview" href="#config/overview">Settings</a>${icon("arrow")}<a data-category="${state.category}" href="#config/${state.category}">${categoryLabel}</a>${state.category === "routines" ? icon("arrow") + "<span>Evening lighting</span>" : ""}` : `<span>${state.context === "map" ? "Floorplan" : state.context === "rooms" ? "Rooms & groups" : "Home"}</span>`}</div>${state.context === "map" ? '<div class="floorplan-tabs"><button class="active">Ground floor</button><button>Upstairs</button></div>' : ""}<div class="header-utilities"><button class="icon-button" aria-label="Ask AI">${icon("sparkle")}</button><button class="icon-button fullscreen-preview" aria-label="Fullscreen">${icon("maximize")}</button></div></header>${content}<nav class="bottom-nav" aria-label="Primary navigation">${[
      ["home", "Home", "house"],
      ["search", "Search", "search"],
      ["map", "Floorplan", "map"],
      ["rooms", "Rooms", "rooms"],
      ["settings", "Settings", "settings"],
    ]
      .map(
        ([slug, label, glyph]) =>
          `<button ${slug === "search" ? 'data-action="search"' : slug === "settings" ? 'data-category="overview"' : `data-view="${slug}"`} class="${selectedPrimary() === slug ? "active" : ""}">${icon(glyph)}${label}</button>`,
      )
      .join("")}</nav></section></div>`;
  document.querySelector("#search-icon").innerHTML = icon("search");
  for (const scroller of document.querySelectorAll(".settings-scroll")) {
    const active = scroller.querySelector('[aria-current="page"]');
    if (!active || !scroller.getBoundingClientRect().width) continue;
    const rect = active.getBoundingClientRect(),
      bounds = scroller.getBoundingClientRect();
    if (rect.top < bounds.top || rect.bottom > bounds.bottom)
      active.scrollIntoView({ block: "nearest" });
  }
}
function navigate(view, category) {
  state.context = view;
  if (category) {
    state.category = category;
    state.expanded = true;
  }
  state.mobileOpen = false;
  render();
}
function openSearch() {
  const dialog = document.querySelector("#search-dialog");
  dialog.showModal();
  document.querySelector("#search-field").value = "";
  searchResults("");
  document.querySelector("#search-field").focus();
}
function searchResults(text) {
  const matches = [
    ...primary.map(([slug, label, glyph]) => ({
      slug,
      label,
      glyph,
      kind: "View",
    })),
    ...groups.flatMap(([group, items]) =>
      items.map(([slug, label, glyph]) => ({
        slug,
        label,
        glyph,
        kind: group,
      })),
    ),
  ]
    .filter((x) =>
      (x.label + " " + x.kind).toLowerCase().includes(text.toLowerCase()),
    )
    .slice(0, 9);
  document.querySelector("#search-results").innerHTML = matches.length
    ? matches
        .map(
          (x) =>
            `<button class="search-result" data-result="${x.slug}" data-kind="${x.kind}">${icon(x.glyph)}${x.label}<small>${x.kind}</small></button>`,
        )
        .join("")
    : '<p class="search-note">No matching destinations.</p>';
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button,a");
  const floating = document.querySelector(".rail-panel.floating:not(.hidden)");
  if (
    floating?.getBoundingClientRect().width &&
    !e.target.closest(".rail-panel,.rail")
  ) {
    state.panelOpen = false;
    render();
  }
  if (!b) return;
  if (b.dataset.direction) {
    state.direction = b.dataset.direction;
    state.collapsed = false;
    state.panelOpen = true;
    render();
  } else if (b.dataset.context) {
    state.context = b.dataset.context;
    state.category = "routines";
    render();
  } else if (b.dataset.category) {
    e.preventDefault();
    navigate("routine", b.dataset.category);
  } else if (b.dataset.view) {
    e.preventDefault();
    navigate(b.dataset.view);
  } else if (b.dataset.result) {
    document.querySelector("#search-dialog").close();
    b.dataset.kind === "View"
      ? navigate(b.dataset.result)
      : navigate("routine", b.dataset.result);
  } else if (b.dataset.jump) {
    const root = b.closest(".app-sidebar");
    root
      .querySelector("#nav-group-" + b.dataset.jump)
      .scrollIntoView({ block: "start", behavior: "smooth" });
  } else
    switch (b.dataset.action) {
      case "search":
        openSearch();
        break;
      case "settings":
        state.expanded = !state.expanded;
        render();
        break;
      case "collapse":
        state.collapsed = true;
        state.panelOpen = false;
        render();
        break;
      case "expand":
        if (state.direction === "full") {
          state.collapsed = false;
        } else {
          state.panelOpen = true;
          state.pinned = true;
        }
        render();
        break;
      case "panel":
        state.panelOpen = !state.panelOpen;
        render();
        break;
      case "pin":
        state.pinned = !state.pinned;
        render();
        break;
      case "open-mobile":
        state.mobileOpen = true;
        state.expanded = true;
        render();
        break;
      case "close-mobile":
        state.mobileOpen = false;
        render();
        break;
    }
  if (b.id === "theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    render();
  }
});
document
  .querySelector("#search-field")
  .addEventListener("input", (e) => searchResults(e.target.value));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearch();
  }
  if (e.key === "Escape" && !document.querySelector("#search-dialog").open) {
    state.mobileOpen = false;
    if (!state.pinned || state.collapsed) state.panelOpen = false;
    render();
  }
});
render();
