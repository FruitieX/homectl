const icons = {
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="13" cy="7" r="1"/><circle cx="16" cy="12" r="1"/><path d="M11 20c4-5-3-4-1-8"/>',
  select: '<path d="m5 3 15 7-7 3-3 7Z"/>',
  details: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  power: '<path d="M12 3v8M7 5a8 8 0 1 0 10 0"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function hsv(h, s, v = 1) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}
function inside(p, r, padding = 0) {
  return (
    p.x >= r.left - padding &&
    p.x <= r.right + padding &&
    p.y >= r.top - padding &&
    p.y <= r.bottom + padding
  );
}
class Concept {
  constructor(article) {
    this.article = article;
    this.kind = article.dataset.concept;
    article.classList.add(this.kind);
    this.stage = article.querySelector(".stage");
    this.stage.insertAdjacentHTML(
      "beforeend",
      `
      <svg class="trace" aria-hidden="true"><polyline/></svg>
      <div class="popover" role="dialog" aria-label="${this.kind} selection quick controls">
        <div class="title">3 selected lights</div>
        <div class="tools">
          <button class="icon" title="Color mode" aria-label="Color mode">${icon("palette")}</button>
          <button class="icon" title="Keep selection" aria-label="Keep selection">${icon("select")}</button>
          <button class="icon" title="Full controls" aria-label="Full controls">${icon("details")}</button>
          <button class="icon" data-close title="Close quick controls" aria-label="Close quick controls">${icon("close")}</button>
        </div>
        <div class="surface">
          <svg class="gauge" viewBox="0 0 268 268" aria-hidden="true"><circle class="gauge-track" cx="134" cy="134" r="119"/><circle class="gauge-level" cx="134" cy="134" r="119" pathLength="100" transform="rotate(-90 134 134)"/></svg>
          ${this.kind === "moat" ? '<div class="moat-guide"></div>' : ""}
          <div class="wheel" role="slider" aria-label="${this.kind} hue and saturation" aria-valuemin="0" aria-valuemax="360" tabindex="0"><canvas width="400" height="400"></canvas><span class="dot"></span></div>
          <div class="brightness-face"><strong>62%</strong><span>Brightness · color held</span></div>
          <button class="power" title="Tap to toggle power · hold to dismiss" aria-label="Toggle selected lights"><span>${icon("power")}</span><span data-level>62%</span></button>
        </div>
        ${this.kind === "tabs" ? '<div class="mode-buttons"><button data-mode-button="color">Color</button><button data-mode-button="brightness">Brightness</button></div>' : ""}
        ${this.kind === "rail" ? '<div class="rail-handle" aria-hidden="true"><span>☀</span> ›</div><div class="brightness-rail" role="slider" aria-label="rail brightness" aria-valuemin="0" aria-valuemax="100" tabindex="0"><span class="rail-high">☀</span><div class="rail-track"></div><span class="rail-thumb"></span><span class="rail-low">−</span></div><button class="rail-return" title="Slide through here to return to color">‹ Color</button>' : ""}
        <div class="status" aria-live="polite"><i></i><span>Color active</span></div>
        <div class="gesture-hint"></div>
      </div><div class="finger" aria-hidden="true"></div>`,
    );
    this.popover = this.stage.querySelector(".popover");
    this.surface = this.stage.querySelector(".surface");
    this.wheel = this.stage.querySelector(".wheel");
    this.finger = this.stage.querySelector(".finger");
    this.status = this.stage.querySelector(".status");
    this.trace = this.stage.querySelector("polyline");
    this.power = this.stage.querySelector(".power");
    this.renderWheel();
    this.reset();
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary || e.target.closest("button")) return;
      if (this.playing) return;
      if (!this.popover.contains(e.target)) {
        this.close();
        return;
      }
      e.preventDefault();
      this.stage.setPointerCapture(e.pointerId);
      this.pointer = e.pointerId;
      this.begin({ x: e.clientX, y: e.clientY });
    });
    this.stage.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.pointer) {
        e.preventDefault();
        this.move({ x: e.clientX, y: e.clientY });
      }
    });
    const end = (e) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.end();
    };
    this.stage.addEventListener("pointerup", end);
    this.stage.addEventListener("pointercancel", end);
    this.stage.addEventListener("lostpointercapture", end);
    article
      .querySelector("[data-demo]")
      .addEventListener("click", () => this.demo());
    this.stage
      .querySelector("[data-close]")
      .addEventListener("click", () => this.close());
    this.stage
      .querySelector('[aria-label="Color mode"]')
      .addEventListener("click", () => this.setMode("color"));
    this.stage
      .querySelector('[aria-label="Keep selection"]')
      .addEventListener("click", () => {
        this.status.querySelector("span").textContent =
          "3 lights remain selected";
      });
    this.stage
      .querySelector('[aria-label="Full controls"]')
      .addEventListener("click", () => {
        this.status.querySelector("span").textContent =
          "Gesture study · full controls unchanged";
      });
    this.stage
      .querySelectorAll("[data-mode-button]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.setMode(button.dataset.modeButton),
        ),
      );
    this.stage
      .querySelector(".rail-return")
      ?.addEventListener("click", () => this.setMode("color"));
    let powerTimer, start;
    const cancelPower = () => {
      clearTimeout(powerTimer);
      powerTimer = undefined;
    };
    this.power.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.power.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      this.suppressPower = false;
      powerTimer = setTimeout(() => {
        this.suppressPower = true;
        this.close();
      }, 500);
    });
    this.power.addEventListener("pointermove", (e) => {
      if (
        powerTimer &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8
      ) {
        cancelPower();
        this.suppressPower = true;
      }
    });
    this.power.addEventListener("pointerup", cancelPower);
    this.power.addEventListener("pointercancel", () => {
      cancelPower();
      this.suppressPower = true;
    });
    this.power.addEventListener("lostpointercapture", cancelPower);
    this.power.addEventListener("contextmenu", (e) => e.preventDefault());
    this.power.addEventListener("click", () => {
      if (!this.suppressPower) {
        this.on = !this.on;
        this.render();
      }
    });
    this.wheel.addEventListener("keydown", (e) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
        return;
      e.preventDefault();
      const delta = ["ArrowUp", "ArrowRight"].includes(e.key) ? 1 : -1;
      if (e.altKey) this.s = clamp(this.s + delta * 0.05, 0, 1);
      else this.h = (this.h + delta * 5 + 360) % 360;
      this.setMode("color");
      this.render();
    });
    this.stage
      .querySelector(".brightness-rail")
      ?.addEventListener("keydown", (e) => {
        if (
          !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
        )
          return;
        e.preventDefault();
        this.b = clamp(
          this.b + (["ArrowUp", "ArrowRight"].includes(e.key) ? 1 : -1),
          0,
          100,
        );
        this.setMode("brightness");
        this.render();
      });
  }
  renderWheel() {
    const canvas = this.wheel.querySelector("canvas"),
      ctx = canvas.getContext("2d"),
      pixels = ctx.createImageData(400, 400);
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 400; x++) {
        const dx = x - 200,
          dy = y - 200,
          r = Math.hypot(dx, dy),
          h = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360;
        const rgb = hsv(h, clamp((r - 76) / 116, 0, 1));
        const index = (y * 400 + x) * 4;
        pixels.data.set([...rgb, 255], index);
      }
    ctx.putImageData(pixels, 0, 0);
  }
  reset() {
    this.demoToken = (this.demoToken ?? 0) + 1;
    this.playing = false;
    this.pointer = null;
    this.h = 32;
    this.s = 0.64;
    this.b = 62;
    this.on = true;
    this.path = [];
    this.trace.setAttribute("points", "");
    this.finger.classList.remove("active");
    this.popover.classList.remove("closed");
    this.stage.querySelector(".reopen")?.remove();
    this.article.querySelector("[data-demo]").textContent = "Play gesture";
    this.setMode("color");
    this.render();
  }
  center() {
    const r = this.surface.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, size: r.width };
  }
  polar(p) {
    const c = this.center(),
      dx = p.x - c.x,
      dy = p.y - c.y;
    return {
      r: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx),
      x: dx,
      y: dy,
      size: c.size,
    };
  }
  setMode(mode) {
    this.mode = mode;
    this.awaitingDial = this.kind === "tabs" && mode === "brightness";
    this.article.dataset.mode = mode;
    this.armed = null;
    this.pending = null;
    this.status.classList.remove("pending");
    this.status.querySelector("span").textContent =
      mode === "color"
        ? "Color active · brightness held"
        : "Brightness active · color held";
    this.article
      .querySelectorAll("[data-mode-button]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.modeButton === mode),
      );
    this.article
      .querySelectorAll(".pending")
      .forEach((node) => node.classList.remove("pending"));
    this.stage.querySelector(".gesture-hint").textContent = {
      moat: "Pause on the other control to switch",
      tabs: "Slide onto a mode button without letting go",
      rail: "Pull through the handle to switch lanes",
    }[this.kind];
    this.render();
  }
  begin(p) {
    this.path = [];
    this.trace.setAttribute("points", "");
    this.last = p;
    this.active = true;
    this.bAnchor = this.b;
    this.angleAnchor = this.polar(p).angle;
    this.yAnchor = p.y;
    this.switchAt = null;
    this.move(p);
  }
  end() {
    this.active = false;
    this.pending = null;
    this.armed = null;
    this.status.classList.remove("pending");
    this.article
      .querySelectorAll(".pending")
      .forEach((node) => node.classList.remove("pending"));
    this.finger.classList.remove("active");
    this.status.querySelector("span").textContent =
      this.mode === "color"
        ? "Color active · brightness held"
        : "Brightness active · color held";
  }
  mark(p) {
    const r = this.stage.getBoundingClientRect(),
      x = p.x - r.left,
      y = p.y - r.top;
    this.finger.classList.add("active");
    this.finger.style.left = x + "px";
    this.finger.style.top = y + "px";
    this.path.push([x, y]);
    this.trace.setAttribute(
      "points",
      this.path.map((point) => point.join(",")).join(" "),
    );
  }
  dwell(mode, p, milliseconds) {
    if (
      !this.pending ||
      this.pending.mode !== mode ||
      Math.hypot(p.x - this.pending.p.x, p.y - this.pending.p.y) > 8
    )
      this.pending = { mode, p: { ...p }, time: performance.now() };
    const progress = clamp(
      (performance.now() - this.pending.time) / milliseconds,
      0,
      1,
    );
    this.status.classList.add("pending");
    this.status.querySelector("span").textContent =
      `Hold for ${mode} · ${Math.round(progress * 100)}%`;
    if (progress >= 1) {
      this.setMode(mode);
      this.bAnchor = this.b;
      this.angleAnchor = this.polar(p).angle;
      this.yAnchor = p.y;
      this.switchAt = { ...p };
      return true;
    }
    return false;
  }
  move(p) {
    if (!this.active) return;
    this.last = p;
    this.mark(p);
    const polar = this.polar(p),
      ring = polar.size / 268;
    if (this.kind === "moat") {
      const switchZone =
        this.mode === "color"
          ? polar.r >= 110 * ring && polar.r <= 142 * ring
          : polar.r >= 44 * ring && polar.r <= 91 * ring;
      if (switchZone) {
        this.dwell(this.mode === "color" ? "brightness" : "color", p, 320);
        return;
      }
      this.pending = null;
      this.status.classList.remove("pending");
      if (this.mode === "color" && polar.r > 96 * ring) return;
      if (this.mode === "brightness" && polar.r < 107 * ring) return;
    }
    if (this.kind === "tabs") {
      const other = this.article.querySelector(
        `[data-mode-button="${this.mode === "color" ? "brightness" : "color"}"]`,
      );
      if (inside(p, other.getBoundingClientRect())) {
        other.classList.add("pending");
        this.dwell(other.dataset.modeButton, p, 180);
        return;
      }
      this.pending = null;
      this.status.classList.remove("pending");
      other.classList.remove("pending");
      if (polar.r > 102 * ring) return;
      if (this.mode === "brightness" && this.awaitingDial) {
        this.angleAnchor = polar.angle;
        this.awaitingDial = false;
        return;
      }
    }
    if (this.kind === "rail") {
      if (this.mode === "color") {
        const handle = this.stage.querySelector(".rail-handle"),
          bounds = handle.getBoundingClientRect();
        if (inside(p, bounds, 4)) {
          this.armed = true;
          handle.classList.add("active");
          this.status.querySelector("span").textContent =
            "Pull 14 px farther to open brightness";
          return;
        }
        if (
          this.armed &&
          p.x > bounds.right + 14 &&
          Math.abs(p.y - (bounds.top + bounds.height / 2)) < 35
        ) {
          this.setMode("brightness");
          this.yAnchor = p.y;
          this.bAnchor = this.b;
          this.switchAt = { ...p };
          handle.classList.remove("active");
          return;
        }
        if (
          this.armed &&
          p.x >= bounds.left &&
          p.x <= bounds.right + 60 &&
          Math.abs(p.y - (bounds.top + bounds.height / 2)) < 35
        )
          return;
        this.armed = null;
        handle.classList.remove("active");
        if (polar.r > 94 * ring) return;
      } else {
        const back = this.stage.querySelector(".rail-return"),
          bounds = back.getBoundingClientRect();
        if (inside(p, bounds)) {
          this.armed = true;
          this.status.querySelector("span").textContent =
            "Pull into the wheel to return to color";
          return;
        }
        if (
          this.armed &&
          p.x < bounds.left - 14 &&
          Math.abs(p.y - (bounds.top + bounds.height / 2)) < 35
        ) {
          this.setMode("color");
          this.switchAt = { ...p };
          return;
        }
        if (
          this.armed &&
          p.x >= bounds.left - 60 &&
          p.x <= bounds.right &&
          Math.abs(p.y - (bounds.top + bounds.height / 2)) < 35
        )
          return;
        this.armed = null;
        const rail = this.stage
          .querySelector(".brightness-rail")
          .getBoundingClientRect();
        if (p.x < rail.left - 12) return;
      }
    }
    if (this.mode === "color") {
      if (polar.r < 42 * ring) return;
      this.h = ((polar.angle * 180) / Math.PI + 450) % 360;
      this.s = clamp((polar.r - 42 * ring) / (50 * ring), 0, 1);
    } else if (this.kind === "rail")
      this.b = clamp(this.bAnchor + ((this.yAnchor - p.y) / 156) * 100, 0, 100);
    else {
      const delta = Math.atan2(
        Math.sin(polar.angle - this.angleAnchor),
        Math.cos(polar.angle - this.angleAnchor),
      );
      this.b = clamp(this.b + (delta / (Math.PI * 2)) * 100, 0, 100);
      this.angleAnchor = polar.angle;
    }
    this.render();
  }
  render() {
    const rgb = hsv(this.h, this.s),
      actual = `rgb(${rgb.join(",")})`;
    // A quiet center preview, with a clearer outline in the actual selected color.
    const neutral = rgb.map((value) => Math.round(value * 0.62 + 160 * 0.38));
    this.popover.style.setProperty("--light", actual);
    this.popover.style.setProperty(
      "--muted-light",
      `rgb(${neutral.join(",")})`,
    );
    this.popover.classList.toggle("off", !this.on);
    this.popover
      .querySelector(".gauge-level")
      .setAttribute("stroke-dasharray", `${this.b} 100`);
    this.popover.querySelector("[data-level]").textContent =
      Math.round(this.b) + "%";
    this.popover.querySelector(".brightness-face strong").textContent =
      Math.round(this.b) + "%";
    const radius = 38 + this.s * 58,
      angle = (this.h * Math.PI) / 180 - Math.PI / 2,
      dot = this.wheel.querySelector(".dot");
    dot.style.left = `${50 + (Math.cos(angle) * radius) / 2}%`;
    dot.style.top = `${50 + (Math.sin(angle) * radius) / 2}%`;
    this.wheel.setAttribute("aria-valuenow", Math.round(this.h));
    this.wheel.setAttribute(
      "aria-valuetext",
      `Hue ${Math.round(this.h)} degrees, saturation ${Math.round(this.s * 100)} percent`,
    );
    this.stage
      .querySelector(".brightness-rail")
      ?.setAttribute("aria-valuenow", Math.round(this.b));
    const thumb = this.stage.querySelector(".rail-thumb");
    if (thumb) thumb.style.bottom = `${34 + (this.b / 100) * 156}px`;
    this.article.querySelector("[data-result]").textContent =
      `H ${Math.round(this.h)}° · S ${Math.round(this.s * 100)}% · ${Math.round(this.b)}%`;
    this.stage.querySelectorAll(".lamp").forEach((lamp) => {
      lamp.style.fill = this.on ? actual : "#788676";
      lamp.style.opacity = this.on ? 0.35 + (this.b / 100) * 0.65 : 0.4;
    });
  }
  close() {
    this.demoToken++;
    this.playing = false;
    this.end();
    this.popover.classList.add("closed");
    this.closedAt = performance.now();
    this.article.querySelector("[data-demo]").textContent = "Play gesture";
    if (this.stage.querySelector(".reopen")) return;
    const button = document.createElement("button");
    button.className = "reopen";
    button.textContent = "Open selected lights";
    button.addEventListener("click", (event) => {
      // A held touch can synthesize a click on the replacement button after
      // the power control vanishes. Require a separate tap to reopen.
      if (event.detail !== 0 && performance.now() - this.closedAt < 350) return;
      button.remove();
      this.popover.classList.remove("closed");
    });
    this.stage.append(button);
  }
  async demo() {
    this.reset();
    this.playing = true;
    const token = this.demoToken;
    this.article.querySelector("[data-demo]").textContent = "Playing…";
    const c = this.center(),
      scale = c.size / 268;
    const polar = (angle, r) => ({
      x: c.x + Math.cos(((angle - 90) * Math.PI) / 180) * r * scale,
      y: c.y + Math.sin(((angle - 90) * Math.PI) / 180) * r * scale,
    });
    const boundsCenter = (selector) => {
      const r = this.stage.querySelector(selector).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const stroke = async (from, to, ms) => {
      const steps = Math.ceil(ms / 24);
      for (let i = 0; i <= steps; i++) {
        if (token !== this.demoToken) return false;
        const t = i / steps;
        this.move({
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        });
        await wait(ms / steps);
      }
      return true;
    };
    const pause = async (p, ms) => stroke(p, p, ms);
    const start = polar(32, 74);
    this.begin(start);
    this.status.querySelector("span").textContent =
      "Finger stays down throughout";
    let p = polar(160, 78);
    if (!(await stroke(start, p, 900))) return;
    if (this.kind === "moat") {
      const arm = polar(160, 119);
      if (!(await stroke(p, arm, 350)) || !(await pause(arm, 400))) return;
      const bright = polar(235, 119);
      if (!(await stroke(arm, bright, 800)) || !(await pause(bright, 200)))
        return;
      const back = polar(235, 78);
      if (!(await stroke(bright, back, 350)) || !(await pause(back, 400)))
        return;
      p = back;
    } else if (this.kind === "tabs") {
      const arm = boundsCenter('[data-mode-button="brightness"]');
      if (!(await stroke(p, arm, 600)) || !(await pause(arm, 250))) return;
      const dial = polar(160, 78);
      if (!(await stroke(arm, dial, 450))) return;
      const bright = polar(240, 78);
      if (!(await stroke(dial, bright, 800))) return;
      const back = boundsCenter('[data-mode-button="color"]');
      if (!(await stroke(bright, back, 550)) || !(await pause(back, 250)))
        return;
      p = back;
    } else {
      const handle = boundsCenter(".rail-handle");
      if (!(await stroke(p, handle, 650))) return;
      const pulled = { x: handle.x + 44, y: handle.y };
      if (!(await stroke(handle, pulled, 350))) return;
      const bright = { x: pulled.x, y: pulled.y - 36 };
      if (!(await stroke(pulled, bright, 650)) || !(await pause(bright, 180)))
        return;
      const back = boundsCenter(".rail-return");
      if (!(await stroke(bright, back, 550))) return;
      const inner = { x: back.x - 46, y: back.y };
      if (!(await stroke(back, inner, 350))) return;
      p = inner;
    }
    const final = polar(285, 70);
    if (!(await stroke(p, final, 800)) || !(await pause(final, 400))) return;
    this.end();
    this.playing = false;
    this.article.querySelector("[data-demo]").textContent = "Replay gesture";
  }
}
const concepts = [...document.querySelectorAll("[data-concept]")].map(
  (article) => new Concept(article),
);
document
  .querySelector("#reset-all")
  .addEventListener("click", () =>
    concepts.forEach((concept) => concept.reset()),
  );
function direction() {
  const current = ["moat", "tabs", "rail"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "all";
  document.body.dataset.direction = current;
  document
    .querySelectorAll(".directions a")
    .forEach((link) =>
      link.classList.toggle("active", link.hash === "#" + current),
    );
  concepts.forEach((concept) =>
    concept.article.classList.toggle(
      "mobile-active",
      concept.kind === (current === "all" ? "moat" : current),
    ),
  );
}
window.addEventListener("hashchange", () => {
  concepts.forEach((concept) => concept.reset());
  direction();
});
direction();
// Dwell also advances while the finger is stationary; it does not need jitter.
setInterval(() => {
  for (const concept of concepts)
    if (concept.active && concept.pending && !concept.playing)
      concept.move(concept.last);
}, 30);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") concepts.forEach((concept) => concept.close());
});
window.quickAdjustStudy = { concepts };
const preview = new URLSearchParams(location.search).get("preview");
if (preview === "brightness" || preview === "compare")
  concepts.forEach((concept) => {
    if (preview === "brightness" || concept.kind !== "moat")
      concept.setMode("brightness");
  });
