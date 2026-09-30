import type { DeviceColor } from '../bindings/DeviceColor';
import type { Device } from '../bindings/Device';
import { isDeviceReadOnly } from './deviceCapabilities.ts';

export type LightAdjustment = {
  power?: boolean;
  brightness?: number;
  color?: DeviceColor;
};

/** Shared controls never issue an unsupported command to part of a selection. */
export function quickLightSelection(devices: Device[]) {
  const writable = devices.filter((device) => !isDeviceReadOnly(device));
  const capabilities = writable.flatMap((device) =>
    'Controllable' in device.data
      ? [device.data.Controllable.capabilities]
      : [],
  );
  const colored =
    capabilities.length > 0 &&
    capabilities.every((caps) => caps.hs || caps.xy || caps.rgb);
  const temperatures = capabilities.flatMap((caps) =>
    caps.ct ? [caps.ct] : [],
  );
  const start = Math.max(...temperatures.map((range) => range.start));
  const end = Math.min(...temperatures.map((range) => range.end));
  return {
    writable,
    skipped: devices.length - writable.length,
    caps: {
      hs: colored,
      xy: false,
      rgb: false,
      brightness:
        capabilities.length > 0 &&
        capabilities.every((caps) => caps.brightness === true),
      ct:
        capabilities.length > 0 &&
        temperatures.length === capabilities.length &&
        start < end
          ? { start, end }
          : null,
    },
  };
}

/** Send the newest drag value at a bounded rate; never overlap device writes. */
export function createLightAdjustmentQueue({
  send,
  onBusy,
  onFailure,
  interval = 120,
}: {
  send: (value: LightAdjustment) => Promise<boolean>;
  onBusy: (busy: boolean) => void;
  onFailure: () => void;
  interval?: number;
}) {
  let queued: LightAdjustment | null = null;
  let inFlight = false;
  let disposed = false;
  let flushRequested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const pump = async () => {
    if (inFlight || !queued) return;
    clearTimer();
    const value = queued;
    queued = null;
    inFlight = true;
    flushRequested = false;
    if (!disposed) onBusy(true);
    let applied = false;
    try {
      applied = await send(value);
    } catch {
      applied = false;
    } finally {
      inFlight = false;
      if (!applied) {
        queued = null;
        clearTimer();
        if (!disposed) onFailure();
      }
      if (queued) {
        if (disposed || flushRequested) void pump();
        else timer = setTimeout(() => void pump(), interval);
      } else if (!disposed) onBusy(false);
    }
  };
  return {
    update(value: LightAdjustment) {
      if (disposed) return;
      queued = { ...queued, ...value };
      // Keep one timer per burst, so a continuous drag also updates the light.
      if (!timer && !inFlight) timer = setTimeout(() => void pump(), interval);
    },
    flush() {
      flushRequested = true;
      clearTimer();
      void pump();
    },
    cancel() {
      queued = null;
      flushRequested = false;
      clearTimer();
    },
    dispose() {
      // Finish the released value even if the user closes before its ack.
      disposed = true;
      clearTimer();
      void pump();
    },
    get idle() {
      return !inFlight && !queued;
    },
  };
}

/** The outer ring follows StatePreview: clockwise from twelve o'clock. */
export function ringBrightness(x: number, y: number): number {
  const angle = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return Math.round((angle / (Math.PI * 2)) * 100);
}

export type LightHold = {
  pointerId: number;
  x: number;
  y: number;
  /** Actual press location, independent of the marker/popover anchor. */
  origin?: { x: number; y: number };
};
