// homectl JavaScript ABI prelude (P07).
//
// Injected by the script worker before the user's function body, after the
// immutable `ctx` global. Everything here is pure data manipulation: no I/O,
// no timers, no ambient time or randomness.
//
// The prelude is a fixed, versioned application asset. It is syntax-checked
// and executed inside the worker process alongside the user body and shares
// the invocation's fresh realm.

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Deterministic host surface
  // ---------------------------------------------------------------------------

  var __homectl_now =
    ctx && typeof ctx.now_ms === "number" && isFinite(ctx.now_ms)
      ? ctx.now_ms
      : 0;

  var __homectl_seed =
    ctx && typeof ctx.seed === "number" && isFinite(ctx.seed)
      ? ctx.seed >>> 0
      : 0;

  var __homectl_rng_state = __homectl_seed;

  function __homectl_random() {
    // mulberry32: deterministic, self-contained, good enough for automation.
    __homectl_rng_state = (__homectl_rng_state + 0x6d2b79f5) >>> 0;
    var t = __homectl_rng_state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  Math.random = function () {
    return __homectl_random();
  };

  var __homectl_real_date = Date;

  function __homectl_date() {
    if (arguments.length === 0) {
      return new __homectl_real_date(__homectl_now);
    }
    var args = Array.prototype.slice.call(arguments);
    return new (Function.prototype.bind.apply(
      __homectl_real_date,
      [null].concat(args)
    ))();
  }

  __homectl_date.now = function () {
    return __homectl_now;
  };
  __homectl_date.parse = __homectl_real_date.parse;
  __homectl_date.UTC = __homectl_real_date.UTC;
  __homectl_date.prototype = __homectl_real_date.prototype;
  globalThis.Date = __homectl_date;

  // ---------------------------------------------------------------------------
  // Immutable context
  // ---------------------------------------------------------------------------

  function __homectl_deep_freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      var keys = Object.keys(value);
      for (var index = 0; index < keys.length; index += 1) {
        __homectl_deep_freeze(value[keys[index]]);
      }
    }
    return value;
  }

  __homectl_deep_freeze(ctx);

  // ---------------------------------------------------------------------------
  // Pure API namespace
  // ---------------------------------------------------------------------------

  var api = {};

  // Three-valued logic helpers. Plain JavaScript `!` is not unknown-preserving.
  api.unknown = function (reason) {
    var result = { kind: "unknown" };
    if (reason !== undefined && reason !== null) {
      result.reason = reason;
    }
    return result;
  };

  api.not = function (value) {
    if (value === true) {
      return false;
    }
    if (value === false) {
      return true;
    }
    if (value && typeof value === "object" && value.kind === "unknown") {
      return value;
    }
    throw new Error("api.not expects a boolean or api.unknown(...)");
  };

  // Fixed clock and seeded randomness for this invocation.
  api.now = __homectl_now;
  api.random = __homectl_random;

  api.values = {
    get: function (helperId) {
      var helpers = ctx && ctx.values ? ctx.values.helpers : undefined;
      if (!helpers || !Object.prototype.hasOwnProperty.call(helpers, helperId)) {
        return undefined;
      }
      return helpers[helperId];
    },
    requireEnum: function (helperId) {
      var entry = api.values.get(helperId);
      if (!entry || entry.kind !== "enum" || entry.value === undefined) {
        throw new Error(
          "helper '" + helperId + "' has no known enum value"
        );
      }
      return entry.value;
    },
  };

  function __homectl_targets(targets) {
    if (!targets) {
      return { devices: [], groups: [] };
    }
    return {
      devices: targets.devices || [],
      groups: targets.groups || [],
    };
  }

  function __homectl_action(kind, spec, extra) {
    var action = { action: kind, id: spec && spec.id ? spec.id : "" };
    if (extra) {
      var keys = Object.keys(extra);
      for (var index = 0; index < keys.length; index += 1) {
        action[keys[index]] = extra[keys[index]];
      }
    }
    return action;
  }

  api.actions = {
    setPower: function (spec) {
      if (!spec || !spec.device) {
        throw new Error("api.actions.setPower requires a device");
      }
      return __homectl_action("set_power", spec, {
        device: spec.device,
        power: !!spec.power,
      });
    },
    activateScene: function (spec) {
      if (!spec || (!spec.scene && !spec.select)) {
        throw new Error("api.actions.activateScene requires scene or select");
      }
      var extra = { targets: __homectl_targets(spec.targets) };
      if (spec.scene) {
        extra.scene_id = spec.scene;
      }
      if (spec.select) {
        extra.select = spec.select;
      }
      return __homectl_action("activate_scene", spec, extra);
    },
    dim: function (spec) {
      if (!spec || typeof spec.step !== "number") {
        throw new Error("api.actions.dim requires a numeric step");
      }
      var extra = {
        targets: __homectl_targets(spec.targets),
        step: spec.step,
      };
      if (spec.transitionMs !== undefined) {
        extra.transition_ms = spec.transitionMs;
      }
      return __homectl_action("dim", spec, extra);
    },
    randomizeColor: function (spec) {
      if (!spec || !spec.targets) {
        throw new Error("api.actions.randomizeColor requires targets");
      }
      var targets = __homectl_targets(spec.targets);
      if (targets.devices.length === 0 && targets.groups.length === 0) {
        throw new Error("api.actions.randomizeColor requires targets");
      }
      var extra = { targets: targets };
      if (spec.minSaturation !== undefined) {
        extra.min_saturation = spec.minSaturation;
      }
      if (spec.maxSaturation !== undefined) {
        extra.max_saturation = spec.maxSaturation;
      }
      if (spec.transitionMs !== undefined) {
        extra.transition_ms = spec.transitionMs;
      }
      return __homectl_action("randomize_color", spec, extra);
    },
    setHelper: function (spec) {
      if (!spec || !spec.helper) {
        throw new Error("api.actions.setHelper requires a helper id");
      }
      return __homectl_action("set_helper", spec, {
        helper: spec.helper,
        value: spec.value,
      });
    },
    scheduleTimer: function (spec) {
      if (!spec || !spec.key || typeof spec.afterMs !== "number") {
        throw new Error(
          "api.actions.scheduleTimer requires key and afterMs"
        );
      }
      return __homectl_action("schedule_timer", spec, {
        timer: spec.key,
        delay_ms: spec.afterMs,
      });
    },
    replaceTimer: function (spec) {
      if (!spec || !spec.key || typeof spec.afterMs !== "number") {
        throw new Error("api.actions.replaceTimer requires key and afterMs");
      }
      return __homectl_action("replace_timer", spec, {
        timer: spec.key,
        delay_ms: spec.afterMs,
      });
    },
    cancelTimer: function (spec) {
      if (!spec || !spec.key) {
        throw new Error("api.actions.cancelTimer requires key");
      }
      return __homectl_action("cancel_timer", spec, { timer: spec.key });
    },
    invokeRoutine: function (spec) {
      if (!spec || !spec.routine) {
        throw new Error("api.actions.invokeRoutine requires a routine id");
      }
      var extra = { routine_id: spec.routine };
      if (spec.mode) {
        extra.mode = spec.mode;
      }
      return __homectl_action("invoke_routine", spec, extra);
    },
  };

  // Timers are plan operations, not live JS timers.
  api.timers = {
    schedule: api.actions.scheduleTimer,
    replace: api.actions.replaceTimer,
    cancel: api.actions.cancelTimer,
  };

  // ---------------------------------------------------------------------------
  // Pure time and color helpers (computed-source presets)
  // ---------------------------------------------------------------------------

  function __homectl_local() {
    var local = ctx && ctx.local;
    if (
      !local ||
      typeof local.minutes_of_day !== "number" ||
      !isFinite(local.minutes_of_day)
    ) {
      throw new Error(
        "api.time requires a computed-source context with ctx.local"
      );
    }
    return local;
  }

  function __homectl_seconds_of_day() {
    var local = __homectl_local();
    if (typeof local.seconds_of_day === "number" && isFinite(local.seconds_of_day)) {
      return local.seconds_of_day;
    }
    return local.minutes_of_day * 60;
  }

  function __homectl_finite(value, what) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw new Error(what + " must be a finite number");
    }
    return value;
  }

  api.time = {
    // Strict `HH:MM` civil time to minutes since midnight.
    parseHHMM: function (text) {
      if (typeof text !== "string") {
        throw new Error("api.time.parseHHMM expects a string");
      }
      var match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(text);
      if (!match) {
        throw new Error("api.time.parseHHMM expects HH:MM, got " + text);
      }
      return Number(match[1]) * 60 + Number(match[2]);
    },

    // Injected civil time of this invocation, in minutes since midnight with
    // the seconds fraction included.
    minutes: function () {
      return __homectl_seconds_of_day() / 60;
    },

    seconds: function () {
      return __homectl_seconds_of_day();
    },

    dayFraction: function () {
      return api.time.minutes() / 1440;
    },

    lerp: function (from, to, t) {
      __homectl_finite(from, "api.time.lerp from");
      __homectl_finite(to, "api.time.lerp to");
      __homectl_finite(t, "api.time.lerp t");
      return from + (to - from) * t;
    },

    // The night-fade easing used by the shipped circadian preset.
    easeSine: function (t) {
      __homectl_finite(t, "api.time.easeSine t");
      return Math.sin((t * Math.PI) / 2);
    },
  };

  function __homectl_color_kind(color) {
    if (
      color &&
      typeof color === "object" &&
      typeof color.ct === "number" &&
      isFinite(color.ct)
    ) {
      return "ct";
    }
    if (
      color &&
      typeof color === "object" &&
      typeof color.h === "number" &&
      isFinite(color.h) &&
      typeof color.s === "number" &&
      isFinite(color.s)
    ) {
      return "hs";
    }
    return null;
  }

  api.color = {
    kelvin: function (kelvin) {
      __homectl_finite(kelvin, "api.color.kelvin");
      return { ct: Math.round(kelvin) };
    },

    hs: function (hue, saturation) {
      __homectl_finite(hue, "api.color.hs hue");
      __homectl_finite(saturation, "api.color.hs saturation");
      return { h: ((Math.round(hue) % 360) + 360) % 360, s: saturation };
    },

    isKelvin: function (color) {
      return __homectl_color_kind(color) === "ct";
    },

    isHs: function (color) {
      return __homectl_color_kind(color) === "hs";
    },

    // Mix two colors at `t` in `0.0..=1.0`. Kelvin pairs interpolate
    // linearly and round to whole Kelvin; HS pairs interpolate the shortest
    // hue arc and saturation. Exact half-circle hue differences walk the
    // positive arc, matching the built-in oracle's direction.
    mix: function (from, to, t) {
      __homectl_finite(t, "api.color.mix t");
      var clamped = t < 0 ? 0 : t > 1 ? 1 : t;
      var fromKind = __homectl_color_kind(from);
      var toKind = __homectl_color_kind(to);
      if (fromKind === "ct" && toKind === "ct") {
        return { ct: Math.round(api.time.lerp(from.ct, to.ct, clamped)) };
      }
      if (fromKind === "hs" && toKind === "hs") {
        var diff = (to.h - from.h) % 360;
        if (diff > 180) {
          diff -= 360;
        } else if (diff < -180) {
          diff += 360;
        }
        var hue = from.h + diff * clamped;
        return {
          h: ((Math.round(hue) % 360) + 360) % 360,
          s: api.time.lerp(from.s, to.s, clamped),
        };
      }
      throw new Error(
        "api.color.mix expects two Kelvin or two HS colors, got " +
          fromKind +
          " and " +
          toKind
      );
    },
  };

  __homectl_deep_freeze(api);
  globalThis.api = api;
})();
