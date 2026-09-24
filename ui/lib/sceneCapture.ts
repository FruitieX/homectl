import type { Capabilities } from '@/bindings/Capabilities';
import type { ControllableDevice } from '@/bindings/ControllableDevice';
import type { Device } from '@/bindings/Device';
import type { DeviceColor, SceneDeviceState } from '@/hooks/useConfig';

/**
 * Capture a scene target from a device's *requested* state.
 *
 * The plan is explicit: capture reads the requested state — what the app asked
 * the device to be — and never `last_report`, even when the report is fresher
 * or disagrees. A captured target therefore means "this is the requested app
 * state", not a claim about the physical device. Fields the device does not
 * support are omitted and explained instead of being filled from a report.
 *
 * The live device colors are untagged structs (`{h,s}`); scenes store the
 * tagged form the scene editor understands (`{Hs:{h,s}}`), so capture converts.
 */

export type CaptureResult = {
  state: SceneDeviceState;
  /** Plain-language notes for the target preview: what was omitted and why. */
  notes: string[];
};

export function controllableOf(
  device: Device | undefined,
): ControllableDevice | null {
  const data = device?.data as Record<string, unknown> | undefined;
  const controllable = data?.['Controllable'];
  return (controllable as ControllableDevice | undefined) ?? null;
}

export function isControllable(device: Device | undefined): boolean {
  return controllableOf(device) !== null;
}

/** Brightness is supported when declared, or inferred from a color capability. */
export function supportsBrightness(capabilities: Capabilities): boolean {
  if (capabilities.brightness === true) {
    return true;
  }
  if (capabilities.brightness === false) {
    return false;
  }
  return supportsColor(capabilities);
}

export function supportsColor(capabilities: Capabilities): boolean {
  return Boolean(
    capabilities.hs || capabilities.xy || capabilities.rgb || capabilities.ct,
  );
}

export function isOffline(device: Device | undefined): boolean {
  const controllable = controllableOf(device);
  const availability = controllable?.availability as
    { kind?: string; available?: boolean } | undefined;
  if (!availability) {
    return false;
  }
  if (typeof availability.available === 'boolean') {
    return !availability.available;
  }
  return availability.kind === 'offline' || availability.kind === 'unavailable';
}

/** Convert a live/untagged color into the tagged shape scenes store. */
export function toSceneColor(color: unknown): DeviceColor | undefined {
  if (!color || typeof color !== 'object') {
    return undefined;
  }
  // Colours are stored untagged: {h,s} | {r,g,b} | {x,y} | {ct}.
  const value = color as Record<string, unknown>;
  if (typeof value.h === 'number' && typeof value.s === 'number') {
    return { h: value.h, s: value.s } as DeviceColor;
  }
  if (
    typeof value.r === 'number' &&
    typeof value.g === 'number' &&
    typeof value.b === 'number'
  ) {
    return { r: value.r, g: value.g, b: value.b } as DeviceColor;
  }
  if (typeof value.x === 'number' && typeof value.y === 'number') {
    return { x: value.x, y: value.y } as DeviceColor;
  }
  if (typeof value.ct === 'number') {
    return { ct: value.ct } as DeviceColor;
  }
  return undefined;
}

/** Whether the device advertises the color space this color is expressed in. */
export function colorMatchesCapabilities(
  color: DeviceColor | undefined,
  capabilities: Capabilities,
): boolean {
  if (!color) {
    return false;
  }
  // Untagged wire shapes; kept local so this module stays importable by the
  // plain node test runner (lib/deviceColor.ts is the UI's shared parser).
  const value = color as Record<string, unknown>;
  if (typeof value.h === 'number' && typeof value.s === 'number') {
    return capabilities.hs;
  }
  if (typeof value.x === 'number' && typeof value.y === 'number') {
    return capabilities.xy;
  }
  if (
    typeof value.r === 'number' &&
    typeof value.g === 'number' &&
    typeof value.b === 'number'
  ) {
    return capabilities.rgb;
  }
  if (typeof value.ct === 'number') return capabilities.ct !== null;
  return false;
}

export function captureSceneDeviceState(
  device: Device | undefined,
): CaptureResult {
  const controllable = controllableOf(device);
  const notes: string[] = [];
  if (!controllable) {
    return {
      state: manualRoomState(),
      notes: [
        'This device is not controllable, so it cannot be a scene target.',
      ],
    };
  }

  const capabilities = controllable.capabilities;
  const requested = controllable.state ?? {
    power: true,
    brightness: null,
    color: null,
  };
  const state: SceneDeviceState = {
    power: requested.power ?? true,
    brightness: undefined,
    color: undefined,
    // Captured targets never carry a transition: the scene decides the fade.
    transition: undefined,
  };

  const requestedBrightness = requested.brightness;
  if (supportsBrightness(capabilities)) {
    if (typeof requestedBrightness === 'number') {
      state.brightness = requestedBrightness;
    } else {
      notes.push(
        'Brightness is supported but the requested state has no value; it is left out.',
      );
    }
  } else if (typeof requestedBrightness === 'number') {
    notes.push('This device does not support brightness, so it is left out.');
  }

  const sceneColor = toSceneColor(requested.color);
  if (supportsColor(capabilities)) {
    if (!sceneColor) {
      notes.push(
        'Color is supported but the requested state has no value; it is left out.',
      );
    } else if (!colorMatchesCapabilities(sceneColor, capabilities)) {
      notes.push(
        'The requested color is outside what this device advertises; it is left out.',
      );
    } else {
      state.color = sceneColor;
    }
  } else if (sceneColor) {
    notes.push('This device does not support color, so it is left out.');
  }

  if (isOffline(device)) {
    notes.push(
      'Captured from the last requested state: the device is offline, so this is not a live value.',
    );
  }

  return { state, notes };
}

/** True when nothing but power can be captured for this device. */
export function isPowerOnly(device: Device | undefined): boolean {
  const controllable = controllableOf(device);
  if (!controllable) {
    return true;
  }
  return (
    !supportsBrightness(controllable.capabilities) &&
    !supportsColor(controllable.capabilities)
  );
}

/** The manual starting point for a room target: a shared state the user edits. */
export function manualRoomState(): SceneDeviceState {
  return {
    power: true,
    brightness: undefined,
    color: undefined,
    transition: undefined,
  };
}
