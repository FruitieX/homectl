export type DeviceSnap = 0 | 0.25 | 1;

/** Alt bypasses snapping; Shift provides quarter-cell precision. */
export function effectiveDeviceSnap(
  snap: DeviceSnap,
  modifiers: { altKey?: boolean; shiftKey?: boolean },
): DeviceSnap {
  return modifiers.altKey ? 0 : modifiers.shiftKey ? 0.25 : snap;
}

/**
 * Devices may sit this many tiles outside the floorplan grid, e.g. outdoor
 * sensors in the yard. Keep in sync with the server's floorplan validation.
 */
export const FLOORPLAN_DEVICE_MARGIN = 16;

/** Whether a device position is inside the grid or its outside margin. */
export function isDevicePlacementInRange(
  value: number,
  limit: number,
  margin = FLOORPLAN_DEVICE_MARGIN,
) {
  return value >= -margin && value < limit + margin;
}

/** Placement coordinates measure cell centres (integer = centre of a tile). */
export function snapDevicePoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  step: DeviceSnap,
  margin = FLOORPLAN_DEVICE_MARGIN,
) {
  const axis = (value: number, limit: number) => {
    const max = step
      ? Math.floor((limit + margin - 0.001) / step) * step
      : limit + margin - 0.001;
    const min = step ? Math.ceil(-margin / step) * step : -margin;
    const rounded = step
      ? Math.round(value / step) * step
      : Math.round(value * 1000) / 1000;
    // `+ 0` turns -0 into 0.
    return Math.max(min, Math.min(max, rounded)) + 0;
  };
  return { x: axis(point.x, width), y: axis(point.y, height) };
}
