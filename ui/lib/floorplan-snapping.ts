export type DeviceSnap = 0 | 0.25 | 1;

/** Alt bypasses snapping; Shift provides quarter-cell precision. */
export function effectiveDeviceSnap(
  snap: DeviceSnap,
  modifiers: { altKey?: boolean; shiftKey?: boolean },
): DeviceSnap {
  return modifiers.altKey ? 0 : modifiers.shiftKey ? 0.25 : snap;
}

/** Placement coordinates measure cell centres (integer = centre of a tile). */
export function snapDevicePoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  step: DeviceSnap,
) {
  const axis = (value: number, limit: number) => {
    const max = step
      ? Math.floor((limit - 0.001) / step) * step
      : limit - 0.001;
    const rounded = step
      ? Math.round(value / step) * step
      : Math.round(value * 1000) / 1000;
    return Math.max(0, Math.min(max, rounded));
  };
  return { x: axis(point.x, width), y: axis(point.y, height) };
}
