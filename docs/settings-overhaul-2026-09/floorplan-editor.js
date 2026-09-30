/* Standalone design study. Synthetic data only; no API or device commands. */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const paths = {
  home: "M3 10l9-7 9 7M5 9v12h5v-7h4v7h5V9",
  map: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zM9 3v16M15 5v16",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM9 3l1-1h4l1 3 3 2 3 1-1 4 1 3-3 2-2 3h-4l-2-3-3-2 1-4-1-3 3-2 2-2z",
  sparkles:
    "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3zM20 2v4M18 4h4",
  layers: "M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  undo: "M8 4L3 9l5 5M3 9h10a7 7 0 0 1 0 14",
  redo: "M16 4l5 5-5 5M21 9H11a7 7 0 0 0 0 14",
  list: "M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01",
  sliders: "M4 7h6M14 7h6M4 17h10M18 17h2M10 4v6M14 14v6",
  cursor: "M5 3l14 9-7 1-3 7-4-17z",
  bulb: "M9 18h6M10 21h4M8 14a7 7 0 1 1 8 0l-1 2H9l-1-2z",
  room: "M4 4h16v16H4V4zM4 13h8v7M12 4v5M17 13h3",
  wall: "M3 4h18v16H3V4zM3 9h18M3 15h18M9 4v5M15 9v6M9 15v5",
  erase: "M4 14l9-11 8 7-9 11H9l-5-4v-3zM8 9l8 7M12 21h9",
  hand: "M8 12V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10l-4 6h-6l-7-8a2 2 0 0 1 3-3l2 2",
  image: "M3 4h18v16H3V4zM3 17l6-6 5 4 3-3 4 4M15 8h.01",
  close: "M6 6l12 12M6 18L18 6",
  fit: "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M8 8h8v8H8V8z",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM15 15l6 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12l4 4L19 6",
  thermometer: "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0zM12 10v8",
  motion: "M12 8h.01M6 9a7 7 0 0 1 12 0M3 6a11 11 0 0 1 18 0M8 17l4-6 4 6",
  position:
    "M12 3v4M12 17v4M3 12h4M17 12h4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  trash: "M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  download: "M12 3v12M7 10l5 5 5-5M4 15v6h16v-6",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v5h16v-5",
  square: "M4 4h16v16H4V4z",
  brush: "M14 3l7 7-9 9-7-7 9-9zM5 12l-2 9 9-2",
  line: "M4 20L20 4M4 20h.01M20 4h.01",
};
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.square}"/></svg>`;
}
function hydrate(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
hydrate();
const query = new URLSearchParams(location.search);
const layout = query.get("layout") === "focus" ? "focus" : "docked";
document.body.classList.add(layout);
$(`[data-direction="${layout}"]`).classList.add("active");
const rooms = [
  {
    id: "living",
    name: "Living room",
    color: "#dbe9db",
    bounds: [4, 3.5, 11.67, 8.33],
    members: 5,
  },
  {
    id: "kitchen",
    name: "Kitchen",
    color: "#ebe9d4",
    bounds: [15.67, 3.5, 12.33, 8.33],
    members: 4,
  },
  {
    id: "hall",
    name: "Hallway",
    color: "#e1e9e5",
    bounds: [4, 11.83, 11.67, 5.67],
    members: 3,
  },
  {
    id: "bedroom",
    name: "Bedroom",
    color: "#e4dfeb",
    bounds: [15.67, 11.83, 7.5, 5.67],
    members: 4,
  },
  {
    id: "bathroom",
    name: "Bathroom",
    color: "#dce9eb",
    bounds: [23.17, 11.83, 4.83, 5.67],
    members: 2,
  },
];
let devices = [
  {
    id: "mqtt/window-light",
    name: "Window light",
    room: "living",
    color: "#f4ce8b",
    brightness: 0.7,
    x: 8,
    y: 8,
  },
  {
    id: "mqtt/kitchen-pendant",
    name: "Kitchen pendant",
    room: "kitchen",
    color: "#ffe3a4",
    brightness: 0.85,
    x: 21,
    y: 6,
  },
  {
    id: "mqtt/climate",
    name: "Kitchen climate",
    room: "kitchen",
    type: "temperature",
    x: 24,
    y: 8,
  },
  {
    id: "mqtt/hall-motion",
    name: "Hall motion",
    room: "hall",
    type: "motion",
    x: 10,
    y: 14,
  },
  {
    id: "mqtt/bedside",
    name: "Bedside lamp",
    room: "bedroom",
    color: "#dba4a0",
    brightness: 0.4,
    x: 18.5,
    y: 15,
  },
  {
    id: "mqtt/bathroom",
    name: "Bathroom spot",
    room: "bathroom",
    color: "#dde8f4",
    brightness: 0.6,
    x: 25.5,
    y: 14.5,
  },
  {
    id: "mqtt/desk-strip",
    name: "Desk light strip",
    room: "living",
    color: "#97c6b6",
    brightness: 0.65,
    x: null,
    y: null,
  },
  {
    id: "mqtt/balcony",
    name: "Balcony sensor",
    room: "living",
    type: "temperature",
    x: null,
    y: null,
  },
  {
    id: "mqtt/towel",
    name: "Towel heater",
    room: "bathroom",
    color: "#dbe5db",
    brightness: 0,
    x: null,
    y: null,
  },
];
let tool = query.get("tool") || "devices";
if (tool === "tiles") tool = "walls";
let selected = "mqtt/window-light",
  currentRoom = "kitchen",
  shape = "brush",
  material = "wall",
  roomErase = false,
  filter = "all",
  search = "",
  pending = null;
let paints = [],
  undo = [],
  redo = [],
  baseline,
  space = false,
  gesture = null,
  panels = { library: true, inspector: true },
  layers = { grid: false, rooms: true, devices: true, labels: true };
let view = { x: 0, y: 0, scale: 1 },
  fitScale = 1,
  toastTimer;
const canvas = $("#canvas");
function snapshot() {
  return JSON.stringify({ devices, paints });
}
function restore(value) {
  ({ devices, paints } = JSON.parse(value));
  render();
  draw();
  dirty();
}
function edit(before) {
  if (before !== snapshot()) {
    undo.push(before);
    redo = [];
  }
  dirty();
}
function dirty() {
  const changed = baseline !== snapshot();
  $("#dirty").textContent = changed ? "Unsaved" : "Saved";
  $("#dirty").classList.toggle("unsaved", changed);
  $("#save").disabled = !changed;
  $("#discard").disabled = !changed;
  $('[data-action="undo"]').disabled = !undo.length;
  $('[data-action="redo"]').disabled = !redo.length;
}
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3200);
}
function preview(d) {
  if (d.type)
    return `<span class="sensor-preview">${icon(d.type === "temperature" ? "thermometer" : "motion")}</span>`;
  return `<span class="preview"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="#dce6df" stroke-width="2"/><circle cx="18" cy="18" r="15" fill="none" stroke="#638e74" stroke-width="2.5" stroke-dasharray="${94.25 * d.brightness} 94.25" transform="rotate(-90 18 18)" stroke-linecap="round"/><circle cx="18" cy="18" r="10.5" fill="${d.color}" stroke="#ffffff" stroke-width="2"/></svg></span>`;
}
const roomName = (id) => rooms.find((r) => r.id === id)?.name || "Unassigned";
function roomRow(r) {
  return `<button class="entity-row ${r.id === currentRoom ? "active" : ""}" data-room="${r.id}"><span class="room-swatch" style="background:${r.color}">${icon("room")}</span><span><strong>${r.name}</strong><small>${r.members} members · area on this floor</small></span>${r.id === currentRoom ? icon("check") : ""}</button>`;
}
function deviceRow(d) {
  return `<button class="entity-row ${d.id === selected ? "active" : ""}" data-device="${d.id}">${preview(d)}<span><strong>${d.name}</strong><small>${roomName(d.room)}${d.x !== null ? " · placed" : ""}</small></span>${icon(d.x === null ? "plus" : d.id === selected ? "check" : "position")}</button>`;
}
function renderLibrary() {
  const mode = tool === "select" || tool === "hand" ? "devices" : tool;
  $("#library-title").textContent = {
    devices: "Devices",
    rooms: "Room areas",
    walls: "Walls & tiles",
    erase: "Erase",
    layout: "Layout",
  }[mode];
  $("#library-eyebrow").textContent = {
    devices: "PLACE & ORGANIZE",
    rooms: "PAINT ROOM MASKS",
    walls: "DRAW THE FLOORPLAN",
    erase: "REMOVE FROM LAYOUT",
    layout: "DOCUMENT SETTINGS",
  }[mode];
  let html = "";
  if (mode === "devices") {
    const matches = devices.filter(
      (d) =>
        (filter === "all" || (filter === "lights" ? !d.type : !!d.type)) &&
        d.name.toLowerCase().includes(search.toLowerCase()),
    );
    html = `<label class="search">${icon("search")}<input id="catalog-search" placeholder="Find a device…" value="${search}" aria-label="Find a device"></label><div class="filter-row"><button data-filter="all" class="${filter === "all" ? "active" : ""}">All devices</button><button data-filter="lights" class="${filter === "lights" ? "active" : ""}">Lights</button><button data-filter="sensors" class="${filter === "sensors" ? "active" : ""}">Sensors</button></div>`;
    for (const placed of [false, true]) {
      const group = matches.filter((d) => (d.x !== null) === placed);
      html += `<div class="section-label">${placed ? "Placed" : "To place"}<span class="count">${group.length}</span></div><div>${group.map(deviceRow).join("") || '<div class="empty-state">No matching devices</div>'}</div>`;
    }
    html +=
      '<div class="panel-note">Choose a device to place it. Drag a placed marker to move it. This editor never controls devices.</div>';
  } else if (mode === "rooms")
    html = `<div class="mode-explanation">Paint where a room belongs. Its devices and membership stay unchanged.</div>${rooms.map(roomRow).join("")}<div class="panel-note">Room areas are tile masks. Paint more than one area if a group spans several spaces.</div>`;
  else if (mode === "walls" || mode === "erase") {
    html = `<div class="mode-explanation">${mode === "erase" ? "Erase tiles with a stroke. Device and room removal lives in their inspectors." : "Draw the structure over the background. All shapes snap to tiles."}</div><div class="section-label">Material</div>${[
      ["floor", "#edf1e9", "Floor"],
      ["wall", "#667869", "Wall"],
      ["door", "#c5ab83", "Door"],
      ["window", "#96c2d0", "Window"],
      ["empty", "#ffffff", "Empty"],
    ]
      .map(
        ([id, color, name]) =>
          `<button class="material ${material === id ? "active" : ""}" data-material="${id}"><span class="material-chip" style="background:${color}"></span>${name}${material === id ? icon("check") : ""}</button>`,
      )
      .join(
        "",
      )}<div class="panel-note">Brush for small changes, line for walls, rectangle for larger areas. Each complete stroke is one undo step.</div>`;
  } else
    html = `<div class="full-field"><label for="floorplan-name">Name</label><input id="floorplan-name" value="Ground floor" readonly></div><div class="section-heading">${icon("image")}Background image</div><div class="image-preview">${icon("map")}<span>ground-floor.svg · sample</span></div><div class="small-actions"><button data-action="replace-image">Replace…</button><button data-action="remove-image">Remove</button></div><div class="section-heading">${icon("room")}Grid</div><div class="fields"><div class="field"><label>Width · tiles</label><input value="32" readonly></div><div class="field"><label>Height · tiles</label><input value="20" readonly></div></div><div class="small-actions" style="margin-top:10px"><button data-action="resize">Resize…</button><button data-action="crop">Auto crop</button></div><div class="section-heading">${icon("bulb")}Markers</div><div class="full-field"><label>Marker size <span id="marker-size-label">100%</span></label><input id="marker-size" type="range" min="50" max="150" value="100"></div><div class="filter-row"><button data-labels="none">No labels</button><button data-labels="all" class="active">All labels</button></div><div class="panel-note">Background and layout save together. Grid resizing previews what shifts or gets cropped before you confirm.</div>`;
  $("#library-content").innerHTML = html;
}
function renderInspector() {
  let html = "";
  if (tool === "rooms") {
    const r = rooms.find((r) => r.id === currentRoom);
    $("#inspector-title").textContent = "Room area";
    html = `<div class="inspector-entity"><span class="room-swatch" style="background:${r.color}">${icon("room")}</span><div><strong>${r.name}</strong><small>Area on Ground floor</small></div></div><div class="section-heading">${icon("brush")}Paint area</div><div class="segmented"><button data-shape="brush" class="${shape === "brush" ? "active" : ""}">${icon("brush")}Brush</button><button data-shape="rectangle" class="${shape === "rectangle" ? "active" : ""}">${icon("square")}Rectangle</button></div><div class="metric"><span>Area</span><strong>${Math.round(r.bounds[2] * r.bounds[3])} tiles</strong></div><div class="metric"><span>Member devices placed here</span><strong>${devices.filter((d) => d.room === r.id && d.x !== null).length} / ${r.members}</strong></div><div class="inspector-tip">Painting changes only the floorplan area. Device membership is managed in Rooms & groups.</div><a class="related-link" href="index.html#rooms">Open room settings ${icon("arrow")}</a><button class="danger-quiet" data-action="remove-area">${icon("trash")}Remove area from this floor</button>`;
  } else if (tool === "walls" || tool === "erase") {
    $("#inspector-title").textContent = "Drawing";
    html = `<div class="inspector-entity"><span class="room-swatch" style="background:#e7eee7">${icon("wall")}</span><div><strong>${tool === "erase" ? "Erase tiles" : material[0].toUpperCase() + material.slice(1)}</strong><small>${shape === "brush" ? "Freehand brush" : shape === "line" ? "Straight line" : "Rectangle"} · tile aligned</small></div></div><div class="section-heading">${icon("square")}Shape</div><div class="segmented">${["brush", "line", "rectangle"].map((s) => `<button data-shape="${s}" class="${shape === s ? "active" : ""}" title="${s}">${icon(s === "rectangle" ? "square" : s)}</button>`).join("")}</div><div class="metric"><span>Grid size</span><strong>32 × 20 tiles</strong></div><div class="inspector-tip">Space + drag or middle-drag pans while keeping your drawing tool selected. The wheel zooms at the pointer.</div><div class="panel-note">Undo reverses the entire stroke, not each individual tile.</div>`;
  } else if (tool === "layout") {
    $("#inspector-title").textContent = "Document";
    html = `<div class="metric"><span>Floorplan ID</span><strong>ground-floor</strong></div><div class="metric"><span>Tile size</span><strong>30 px</strong></div><div class="metric"><span>Placed devices</span><strong>${devices.filter((d) => d.x !== null).length}</strong></div><div class="metric"><span>Room areas</span><strong>${rooms.length}</strong></div><div class="inspector-tip">Dimensions use tile coordinates. No physical measurements are inferred from the image.</div><a class="related-link" href="everyday.html#map">Open normal map ${icon("arrow")}</a>`;
  } else {
    $("#inspector-title").textContent = "Placement";
    const d = devices.find((d) => d.id === selected);
    if (!d)
      html =
        '<div class="empty-state">Select a marker on the canvas to inspect its position.</div>';
    else
      html = `<div class="inspector-entity">${preview(d)}<div><strong>${d.name}</strong><small>${roomName(d.room)}</small></div></div><span class="tag">${icon("check")}${d.x === null ? "Ready to place" : "Placed on this floor"}</span><div class="section-heading">${icon("position")}Position · tiles</div><div class="fields"><div class="field"><label for="position-x">X</label><input id="position-x" type="number" step=".5" min="0" max="31.99" value="${d.x ?? 0}" ${d.x === null ? "disabled" : ""}></div><div class="field"><label for="position-y">Y</label><input id="position-y" type="number" step=".5" min="0" max="19.99" value="${d.y ?? 0}" ${d.x === null ? "disabled" : ""}></div></div><p class="inspector-caption">Drag the marker or enter its position. Fractional tile positions are supported.</p><div class="section-heading">${icon(d.type ? "thermometer" : "bulb")}Preview</div><div class="metric"><span>${d.type ? "Sensor" : "Brightness"}</span><strong>${d.type ? (d.type === "temperature" ? "21.4 °C · 43%" : "No motion") : Math.round(d.brightness * 100) + "%"}</strong></div><div class="inspector-caption">Live appearance is a preview. Placement editing sends no device commands.</div><a class="related-link" href="index.html#devices">Open device settings ${icon("arrow")}</a>${d.x !== null ? `<button class="danger-quiet" data-action="remove-placement">${icon("trash")}Remove placement</button>` : ""}<div class="key-detail">${d.id}</div>`;
  }
  $("#inspector-content").innerHTML = html;
}
function renderOptions() {
  const title = {
    devices: "Device placement",
    select: "Select & move",
    rooms: "Room area",
    walls: "Walls & tiles",
    erase: "Erase tiles",
    hand: "Pan canvas",
    layout: "Layout & background",
  }[tool];
  let content = `<span class="context-label">${title}</span>`;
  if (["walls", "rooms", "erase"].includes(tool)) {
    content += `<span class="context-divider"></span><div class="segmented">${(tool === "rooms" ? ["brush", "rectangle"] : ["brush", "line", "rectangle"]).map((s) => `<button data-shape="${s}" class="${shape === s ? "active" : ""}" title="${s}">${icon(s === "rectangle" ? "square" : s)}<span class="desktop-only">${s[0].toUpperCase() + s.slice(1)}</span></button>`).join("")}</div>`;
    if (tool === "rooms")
      content += `<button data-action="room-erase" class="${roomErase ? "active" : ""}">${icon("erase")}Erase</button>`;
    else
      content += `<span class="desktop-only" style="color:#809387;font-size:11px">${tool === "erase" ? "Empty" : material[0].toUpperCase() + material.slice(1)}</span>`;
  } else if (tool === "devices" || tool === "select")
    content +=
      '<span class="desktop-only" style="color:#8a9b8f;font-size:11px">Drag to move · click to inspect</span>';
  else if (tool === "hand")
    content +=
      '<span style="color:#8a9b8f;font-size:11px">Drag to pan · wheel to zoom</span>';
  $("#context-options").innerHTML = `<div class="context">${content}</div>`;
  $("#status-tool").textContent = title;
  $("#canvas-tip").textContent = {
    devices: "Choose a device, then click to place it",
    select: "Select a marker to inspect or move",
    rooms: "Paint an area · Space + drag to pan",
    walls: "Draw on tiles · a stroke is one undo step",
    erase: "Erase tiles · Undo restores the stroke",
    hand: "Drag to pan · Fit shows the whole floor",
    layout: "Background and layout save together",
  }[tool];
}
function render() {
  document.body.dataset.tool = tool;
  renderLibrary();
  renderInspector();
  renderOptions();
  $$("[data-tool]").forEach((el) => {
    el.classList.toggle("active", el.dataset.tool === tool);
    el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
  });
  $(".stage").dataset.tool = tool;
  syncPanels();
  dirty();
}
function mobile() {
  return window.innerWidth < 700;
}
function syncPanels() {
  $(".library").classList.toggle("hidden-panel", !mobile() && !panels.library);
  $(".inspector").classList.toggle(
    "hidden-panel",
    !mobile() && !panels.inspector,
  );
}
function openTray(which) {
  if (mobile()) {
    $$(".panel").forEach((p) => p.classList.remove("open"));
    $(`.${which}`).classList.add("open");
    fit();
  } else {
    panels[which] = true;
    syncPanels();
  }
}
function setTool(value, open = true) {
  tool = value;
  pending = null;
  search = "";
  if (tool === "rooms" && shape === "line") shape = "brush";
  render();
  draw();
  if (open && mobile() && !["hand", "select"].includes(tool))
    openTray("library");
}
function drawArchitecture() {
  $("#architecture").innerHTML =
    `<rect x="120" y="105" width="720" height="420" rx="2" fill="#fbfcf8" stroke="#d1dbd0" stroke-width="1"/><g fill="#ecefe6" stroke="#d6ded2" stroke-width="2"><rect x="155" y="160" width="83" height="116" rx="8"/><rect x="149" y="155" width="18" height="126" rx="5"/><rect x="164" y="282" width="105" height="53" rx="6"/><rect x="281" y="220" width="83" height="56" rx="8"/><rect x="423" y="158" width="18" height="112" rx="4"/><rect x="549" y="132" width="217" height="33" rx="4"/><rect x="776" y="132" width="33" height="168" rx="4"/><rect x="572" y="240" width="127" height="55" rx="8"/><rect x="572" y="418" width="85" height="81" rx="7"/><rect x="578" y="410" width="73" height="34" rx="4"/><rect x="728" y="394" width="79" height="54" rx="8"/><rect x="753" y="473" width="40" height="25" rx="8"/><rect x="167" y="419" width="105" height="26" rx="5"/></g><g stroke="#5e7165" stroke-width="9" fill="none" stroke-linecap="square"><path d="M120 300V105H840V525H550M465 525H120V405M470 105v171M470 333v81M470 479v46M120 355h241M415 355h305M790 355h50M695 355v61M695 475v50"/></g><g stroke="#acc7c5" stroke-width="9"><path d="M198 105h114M610 105h139M840 178v106M571 525h72M120 182v83"/></g><g stroke="#b4c3b4" stroke-width="1.5" fill="none"><path d="M470 276h-57a57 57 0 0 1 57 57M361 355v54a54 54 0 0 0 54-54M720 355v70a70 70 0 0 0 70-70M470 414h65a65 65 0 0 1-65 65M695 416h59a59 59 0 0 1-59 59"/></g>`;
}
function draw() {
  $("#room-masks").innerHTML = layers.rooms
    ? rooms
        .map((r) => {
          const [x, y, w, h] = r.bounds;
          return `<rect x="${x * 30 + 5}" y="${y * 30 + 5}" width="${w * 30 - 10}" height="${h * 30 - 10}" fill="${r.color}" opacity="${tool === "rooms" && r.id === currentRoom ? ".65" : ".28"}" ${tool === "rooms" && r.id === currentRoom ? 'stroke="#789b76" stroke-width="2" stroke-dasharray="6 5"' : ""} pointer-events="none"/><text x="${x * 30 + 22}" y="${y * 30 + 33}" fill="#607664" font-size="${mobile() ? Math.min(10 / view.scale, 22) : 15}" font-weight="550" pointer-events="none">${r.name}</text>`;
        })
        .join("")
    : "";
  $("#paint").innerHTML = paints
    .map(
      (p) =>
        `<rect x="${p.x * 30}" y="${p.y * 30}" width="30" height="30" fill="${p.color}" opacity=".66" stroke="#ffffff" stroke-opacity=".3" stroke-width="1" pointer-events="none"/>`,
    )
    .join("");
  const radius = mobile() ? 12 : 13;
  $("#markers").innerHTML = layers.devices
    ? devices
        .filter((d) => d.x !== null)
        .map((d) => {
          const scale = 1 / view.scale;
          return `<g transform="translate(${d.x * 30} ${d.y * 30}) scale(${scale})" data-marker="${d.id}" style="cursor:move"><circle r="${radius + 10}" fill="transparent"/>${selected === d.id ? `<circle r="${radius + 8}" fill="white" fill-opacity=".6" stroke="#507e5b" stroke-width="1.4" stroke-dasharray="3 3"/>` : ""}<circle r="${radius + 3}" fill="white" filter="url(#marker-shadow)"/><circle r="${radius}" fill="none" stroke="#d7e1d9" stroke-width="2.4"/>${!d.type ? `<circle r="${radius}" fill="none" stroke="#62856a" stroke-width="2.6" stroke-dasharray="${2 * Math.PI * radius * d.brightness} ${2 * Math.PI * radius}" transform="rotate(-90)" stroke-linecap="round"/><circle r="${radius - 4}" fill="${d.color}"/>` : `<circle r="${radius - 3}" fill="#eaf2ee"/><g transform="translate(-7 -7) scale(.58)" stroke="#758f7d" stroke-width="1.7" fill="none"><path d="${paths[d.type === "temperature" ? "thermometer" : "motion"]}"/></g>`}${layers.labels && (!mobile() || selected === d.id) ? `<text y="${radius + 21}" text-anchor="middle" font-size="${mobile() ? 9 : 10}" font-weight="500" fill="#587160" paint-order="stroke" stroke="#f6f8f3" stroke-width="3">${d.name}</text>` : ""}</g>`;
        })
        .join("")
    : "";
  $("#grid-layer").style.display = layers.grid ? "" : "none";
  $("#world").setAttribute(
    "transform",
    `translate(${view.x} ${view.y}) scale(${view.scale})`,
  );
  $("#zoom-label").textContent =
    `${Math.round((view.scale / fitScale) * 100)}%`;
  $("#pending").hidden = !pending;
  if (pending)
    $("#pending").innerHTML =
      `Place ${devices.find((d) => d.id === pending).name} on the canvas <button data-action="cancel-place" aria-label="Cancel placement">×</button>`;
}
function fit() {
  const box = canvas.getBoundingClientRect();
  let left = 0,
    right = 0,
    usableHeight = box.height;
  const libraryTray = mobile() && $(".library").classList.contains("open");
  if (libraryTray)
    usableHeight = Math.max(
      140,
      $(".library").getBoundingClientRect().top - box.top,
    );
  if (!mobile() && layout === "focus") {
    left = panels.library
      ? $(".library").getBoundingClientRect().right - box.left + 18
      : 0;
    right = panels.inspector
      ? box.right - $(".inspector").getBoundingClientRect().left + 18
      : 0;
  }
  const available = box.width - left - right;
  fitScale = Math.min(
    (available - (mobile() ? 34 : 55)) / 800,
    (usableHeight - (libraryTray ? 35 : mobile() ? 130 : 145)) / 490,
  );
  fitScale = Math.max(0.15, fitScale);
  view = {
    scale: fitScale,
    x: left + (available - 960 * fitScale) / 2,
    y: (usableHeight - 630 * fitScale) / 2,
  };
  if (mobile() && $(".inspector").classList.contains("open")) {
    const room = rooms.find((r) => r.id === currentRoom);
    const d =
      tool === "rooms"
        ? {
            x: room.bounds[0] + room.bounds[2] / 2,
            y: room.bounds[1] + room.bounds[3] / 2,
          }
        : devices.find((d) => d.id === selected);
    if (d && d.x !== null) {
      const sheet = $(".inspector").getBoundingClientRect();
      view.x = box.width / 2 - d.x * 30 * view.scale;
      view.y = Math.max(78, (sheet.top - box.top) / 2) - d.y * 30 * view.scale;
    }
  }
  draw();
}
function zoom(factor, x, y) {
  const bounds = canvas.getBoundingClientRect();
  x ??= bounds.width / 2;
  y ??= bounds.height / 2;
  const newScale = Math.max(
    fitScale * 0.35,
    Math.min(fitScale * 5, view.scale * factor),
  );
  const ratio = newScale / view.scale;
  view.x = x - (x - view.x) * ratio;
  view.y = y - (y - view.y) * ratio;
  view.scale = newScale;
  draw();
}
function worldPoint(e) {
  const box = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - box.left - view.x) / view.scale / 30,
    y: (e.clientY - box.top - view.y) / view.scale / 30,
  };
}
function safePoint(p) {
  return {
    x: Math.max(0, Math.min(31.9, Math.round(p.x * 2) / 2)),
    y: Math.max(0, Math.min(19.9, Math.round(p.y * 2) / 2)),
  };
}
function paintPoint(p) {
  const x = Math.floor(p.x),
    y = Math.floor(p.y);
  if (x < 0 || y < 0 || x > 31 || y > 19) return;
  const color =
    tool === "rooms"
      ? roomErase
        ? "#fcfdf8"
        : rooms.find((r) => r.id === currentRoom).color
      : tool === "erase"
        ? "#fcfdf8"
        : {
            floor: "#e3e8dc",
            wall: "#566957",
            door: "#ba9d78",
            window: "#86b7c6",
            empty: "#fcfdf8",
          }[material];
  const existing = paints.findIndex((v) => v.x === x && v.y === y);
  if (existing >= 0) paints.splice(existing, 1);
  paints.push({ x, y, color });
}
const touches = new Map();
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;
  $("#popover").hidden = true;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (touches.size === 2) {
    if (gesture?.before) restore(gesture.before);
    const [a, b] = [...touches.values()];
    gesture = {
      kind: "pinch",
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
    return;
  }
  if (touches.size > 2) return;
  const before = snapshot(),
    point = worldPoint(e),
    marker = e.target.closest("[data-marker]");
  if (
    e.button === 1 ||
    space ||
    tool === "hand" ||
    (["select", "devices", "layout"].includes(tool) && !marker && !pending)
  ) {
    gesture = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
    $(".stage").classList.add("panning");
    return;
  }
  if (marker && !pending && ["select", "devices"].includes(tool)) {
    selected = marker.dataset.marker;
    renderInspector();
    renderLibrary();
    draw();
    gesture = {
      kind: "move",
      before,
      offset: {
        x: devices.find((d) => d.id === selected).x - point.x,
        y: devices.find((d) => d.id === selected).y - point.y,
      },
    };
    return;
  }
  if (pending) {
    const d = devices.find((d) => d.id === pending);
    Object.assign(d, safePoint(point));
    selected = d.id;
    pending = null;
    edit(before);
    render();
    draw();
    openTray("inspector");
    return;
  }
  if (["walls", "rooms", "erase"].includes(tool)) {
    gesture = { kind: "paint", before, start: point, points: [] };
    if (shape === "brush") paintPoint(point);
    draw();
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (touches.has(e.pointerId))
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = worldPoint(e);
  $("#coordinates").textContent =
    `X ${p.x.toFixed(1)} · Y ${p.y.toFixed(1)} · 32 × 20`;
  if (gesture?.kind === "pinch" && touches.size === 2) {
    const [a, b] = [...touches.values()],
      distance = Math.hypot(a.x - b.x, a.y - b.y),
      cx = (a.x + b.x) / 2,
      cy = (a.y + b.y) / 2,
      box = canvas.getBoundingClientRect();
    zoom(distance / Math.max(1, gesture.distance), cx - box.left, cy - box.top);
    view.x += cx - gesture.cx;
    view.y += cy - gesture.cy;
    Object.assign(gesture, { distance, cx, cy });
    draw();
    return;
  }
  if (gesture?.kind === "pan") {
    view.x += e.clientX - gesture.lastX;
    view.y += e.clientY - gesture.lastY;
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
    draw();
  } else if (gesture?.kind === "move") {
    Object.assign(
      devices.find((d) => d.id === selected),
      safePoint({ x: p.x + gesture.offset.x, y: p.y + gesture.offset.y }),
    );
    draw();
  } else if (gesture?.kind === "paint") {
    if (shape === "brush") paintPoint(p);
    else {
      ({ paints } = JSON.parse(gesture.before));
      if (shape === "rectangle") {
        for (
          let x = Math.floor(Math.min(p.x, gesture.start.x));
          x <= Math.floor(Math.max(p.x, gesture.start.x));
          x++
        )
          for (
            let y = Math.floor(Math.min(p.y, gesture.start.y));
            y <= Math.floor(Math.max(p.y, gesture.start.y));
            y++
          )
            paintPoint({ x, y });
      } else {
        const dx = p.x - gesture.start.x,
          dy = p.y - gesture.start.y,
          steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
        for (let n = 0; n <= steps; n++)
          paintPoint({
            x: gesture.start.x + (dx * n) / (steps || 1),
            y: gesture.start.y + (dy * n) / (steps || 1),
          });
      }
    }
    draw();
  } else if (pending) {
    $("#ghost").innerHTML =
      `<circle cx="${p.x * 30}" cy="${p.y * 30}" r="${15 / view.scale}" fill="#286954" fill-opacity=".2" stroke="#286954" stroke-dasharray="4 4" stroke-width="${1.3 / view.scale}"/>`;
  }
});
function endGesture(e, cancel = false) {
  touches.delete(e.pointerId);
  if (gesture?.kind === "pinch") {
    if (touches.size === 0) gesture = null;
    return;
  }
  if (gesture?.before) {
    if (cancel) restore(gesture.before);
    else {
      edit(gesture.before);
      renderInspector();
      renderLibrary();
      if (gesture.kind === "move") openTray("inspector");
    }
  }
  gesture = null;
  $(".stage").classList.remove("panning");
}
canvas.addEventListener("pointerup", (e) => endGesture(e));
canvas.addEventListener("pointercancel", (e) => endGesture(e, true));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - b.left, e.clientY - b.top);
  },
  { passive: false },
);
function showMenu(anchor, html) {
  const pop = $("#popover");
  pop.innerHTML = html;
  pop.hidden = false;
  const b = anchor.getBoundingClientRect(),
    h = pop.getBoundingClientRect().height;
  pop.style.left = `${Math.min(window.innerWidth - pop.offsetWidth - 10, Math.max(10, b.right - pop.offsetWidth))}px`;
  pop.style.top = `${b.bottom + h + 8 > window.innerHeight ? b.top - h - 8 : b.bottom + 8}px`;
}
function demoDialog(title, text, extra = "") {
  $("#dialog-content").innerHTML = `<h2>${title}</h2><p>${text}</p>${extra}`;
  $("#dialog").showModal();
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (
    !e.target.closest("#popover") &&
    !e.target.closest('[data-action="layers"], [data-action="document-menu"]')
  )
    $("#popover").hidden = true;
  if (!btn) return;
  if (btn.dataset.tool) {
    setTool(btn.dataset.tool);
    return;
  }
  if (btn.dataset.device) {
    selected = btn.dataset.device;
    const d = devices.find((d) => d.id === selected);
    pending = d.x === null ? selected : null;
    render();
    draw();
    if (pending) {
      $$(".panel").forEach((p) => p.classList.remove("open"));
      if (mobile()) fit();
      notify("Click the canvas to place " + d.name);
    } else openTray("inspector");
    return;
  }
  if (btn.dataset.room) {
    currentRoom = btn.dataset.room;
    render();
    draw();
    if (mobile()) $(".library").classList.remove("open");
    return;
  }
  if (btn.dataset.filter) {
    filter = btn.dataset.filter;
    renderLibrary();
    return;
  }
  if (btn.dataset.shape) {
    shape = btn.dataset.shape;
    renderOptions();
    renderInspector();
    return;
  }
  if (btn.dataset.material) {
    material = btn.dataset.material;
    renderLibrary();
    renderInspector();
    renderOptions();
    return;
  }
  if (btn.dataset.doc) {
    notify(
      "The study has one synthetic floorplan. Floorplan tabs will preserve separate drafts.",
    );
    return;
  }
  if (btn.dataset.labels) {
    layers.labels = btn.dataset.labels === "all";
    $$("[data-labels]").forEach((b) => b.classList.toggle("active", b === btn));
    draw();
    return;
  }
  const action = btn.dataset.action;
  if (action === "save") {
    baseline = snapshot();
    undo = [];
    redo = [];
    dirty();
    notify("Saved in this demo only · reload restores the sample");
  } else if (action === "discard") {
    undo = [];
    redo = [];
    restore(baseline);
    notify("Demo edits discarded");
  } else if (action === "undo" && undo.length) {
    redo.push(snapshot());
    restore(undo.pop());
  } else if (action === "redo" && redo.length) {
    undo.push(snapshot());
    restore(redo.pop());
  } else if (action === "fit") fit();
  else if (action === "zoom-in") zoom(1.2);
  else if (action === "zoom-out") zoom(1 / 1.2);
  else if (action === "room-erase") {
    roomErase = !roomErase;
    renderOptions();
  } else if (action === "library" || action === "inspector") {
    if (mobile()) {
      const panel = $(`.${action}`),
        wasOpen = panel.classList.contains("open");
      $$(".panel").forEach((p) => p.classList.remove("open"));
      if (!wasOpen) panel.classList.add("open");
      fit();
    } else {
      panels[action] = !panels[action];
      syncPanels();
    }
  } else if (action === "close-tray") {
    $$(".panel").forEach((p) => p.classList.remove("open"));
    fit();
  } else if (action === "close-inspector") {
    if (mobile()) {
      $(".inspector").classList.remove("open");
      fit();
    } else {
      panels.inspector = false;
      syncPanels();
    }
  } else if (action === "cancel-place") {
    pending = null;
    $("#ghost").innerHTML = "";
    draw();
  } else if (action === "remove-placement") {
    const before = snapshot(),
      d = devices.find((d) => d.id === selected);
    d.x = d.y = null;
    edit(before);
    render();
    draw();
    notify("Placement removed · device remains available");
  } else if (action === "layers") {
    showMenu(
      btn,
      `<div class="section-label" style="margin:6px 8px">View layers</div>${[
        ["grid", "Tile grid"],
        ["rooms", "Room areas"],
        ["devices", "Device markers"],
        ["labels", "Marker labels"],
      ]
        .map(
          ([id, label]) =>
            `<label><input type="checkbox" data-layer="${id}" ${layers[id] ? "checked" : ""}>${label}</label>`,
        )
        .join("")}`,
    );
  } else if (action === "document-menu")
    showMenu(
      btn,
      `${[
        ["rename", "cursor", "Rename floorplan…"],
        ["download", "download", "Export layout JSON"],
        ["import", "upload", "Import layout…"],
        ["reset", "undo", "Reset layout…"],
        ["delete", "trash", "Delete floorplan…"],
      ]
        .map(
          ([id, ico, title]) =>
            `<button data-action="${id}">${icon(ico)}${title}</button>`,
        )
        .join(
          "",
        )}<hr><button data-action="discard">${icon("close")}Discard unsaved changes</button>`,
    );
  else if (action === "download") {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            width: 32,
            height: 20,
            tileSize: 30,
            deviceScale: 1,
            labelMode: "all",
            tiles: Array.from({ length: 20 }, () => Array(32).fill("empty")),
            devices: devices
              .filter((d) => d.x !== null)
              .map((d) => ({
                deviceKey: d.id,
                deviceName: d.name,
                x: d.x,
                y: d.y,
              })),
            groups: {},
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "synthetic-floorplan.json";
    a.click();
    URL.revokeObjectURL(a.href);
    notify(
      "Synthetic placement sample exported · illustration and paint samples are not included",
    );
  } else if (action === "resize")
    demoDialog(
      "Resize grid",
      "Choose which edge grows or shrinks. Production will preview moved placements and cropped room areas before applying.",
      `<div class="fields"><div class="field"><label>Width · tiles</label><input value="32" readonly></div><div class="field"><label>Height · tiles</label><input value="20" readonly></div></div><div class="filter-row" style="margin-top:16px"><button>Grow right</button><button>Grow bottom</button></div>`,
    );
  else if (action === "close-dialog") $("#dialog").close();
  else if (action === "remove-area")
    demoDialog(
      "Remove room area",
      "This would remove only the selected floorplan mask. The room and all its members would remain. This study keeps its synthetic room masks.",
    );
  else if (action)
    demoDialog(
      {
        assistant: "Assistant",
        rename: "Rename floorplan",
        import: "Import layout",
        reset: "Reset layout",
        delete: "Delete floorplan",
        crop: "Auto crop",
        "replace-image": "Replace background",
        "remove-image": "Remove background",
        "add-document": "Add floorplan",
      }[action] || "Document action",
      "This control shows its proposed location. File operations, document management and recovery will use the existing API during implementation; the mockup makes no server calls.",
    );
});
document.addEventListener("input", (e) => {
  if (e.target.id === "catalog-search") {
    search = e.target.value;
    const caret = e.target.selectionStart;
    renderLibrary();
    $("#catalog-search").focus();
    $("#catalog-search").setSelectionRange(caret, caret);
  }
  if (e.target.id === "marker-size") {
    $("#marker-size-label").textContent = e.target.value + "%";
    notify(
      "Marker size control location · the study keeps markers at their sample size",
    );
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.layer) {
    layers[e.target.dataset.layer] = e.target.checked;
    draw();
  }
  if (["position-x", "position-y"].includes(e.target.id)) {
    const before = snapshot(),
      d = devices.find((d) => d.id === selected);
    d[e.target.id === "position-x" ? "x" : "y"] = Math.max(
      0,
      Math.min(
        e.target.id === "position-x" ? 31.9 : 19.9,
        Number(e.target.value),
      ),
    );
    edit(before);
    renderInspector();
    draw();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    space = true;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $(`[data-action="${e.shiftKey ? "redo" : "undo"}"]`).click();
    return;
  }
  if (e.key === "Escape") {
    pending = null;
    selected = null;
    $$(".panel").forEach((p) => p.classList.remove("open"));
    $("#popover").hidden = true;
    $("#ghost").innerHTML = "";
    if (gesture?.before) restore(gesture.before);
    gesture = null;
    renderInspector();
    draw();
  }
  const shortcuts = {
    v: "select",
    d: "devices",
    r: "rooms",
    b: "walls",
    e: "erase",
    h: "hand",
  };
  if (!e.ctrlKey && !e.metaKey && shortcuts[e.key.toLowerCase()])
    setTool(shortcuts[e.key.toLowerCase()]);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") space = false;
});
window.addEventListener("blur", () => {
  space = false;
  if (gesture?.before) restore(gesture.before);
  gesture = null;
  touches.clear();
});
new ResizeObserver(() => {
  fit();
  syncPanels();
}).observe(canvas);
baseline = snapshot();
drawArchitecture();
render();
fit();
if (query.get("tray")) openTray(query.get("tray"));
