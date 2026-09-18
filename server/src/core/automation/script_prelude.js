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

  __homectl_deep_freeze(api);
  globalThis.api = api;
})();
