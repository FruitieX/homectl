import { validFloorplanLayers } from './floorplan-labels.ts';
import type { FloorplanGrid } from '../ui/FloorplanGridEditor';
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Authoring never silently repairs/drops saved placements, tiles or extensions. */
export function readFloorplanDraft(raw: string): {
  grid: FloorplanGrid | null;
  error?: string;
} {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value)) throw Error('The layout must be an object.');
    const { width, height, tileSize } = value;
    if (
      !finite(width) ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > 1024 ||
      !finite(height) ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 1024 ||
      width * height > 1_000_000
    )
      throw Error(
        'Canvas dimensions must be whole numbers from 1 to 1024, with at most one million tiles.',
      );
    if (!finite(tileSize) || tileSize <= 0)
      throw Error('Tile size must be positive.');
    if (
      !Array.isArray(value.tiles) ||
      value.tiles.length !== height ||
      value.tiles.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== width ||
          row.some(
            (tile) =>
              !['empty', 'floor', 'wall', 'door', 'window'].includes(tile),
          ),
      )
    )
      throw Error(
        'Tiles must match the canvas dimensions and use supported types.',
      );
    const devices = value.devices ?? [],
      groups = value.groups ?? {};
    if (!Array.isArray(devices))
      throw Error('Device placements must be a collection.');
    const keys = new Set();
    for (const device of devices) {
      if (
        !object(device) ||
        typeof device.deviceKey !== 'string' ||
        !device.deviceKey.trim() ||
        keys.has(device.deviceKey) ||
        typeof device.deviceName !== 'string' ||
        !finite(device.x) ||
        device.x < 0 ||
        device.x >= width ||
        !finite(device.y) ||
        device.y < 0 ||
        device.y >= height
      )
        throw Error(
          'Device placements need unique keys, names and positions inside the canvas.',
        );
      keys.add(device.deviceKey);
    }
    if (!object(groups)) throw Error('Room masks must be an object.');
    for (const points of Object.values(groups)) {
      if (
        !Array.isArray(points) ||
        points.some(
          (point) =>
            !object(point) ||
            !finite(point.x) ||
            !Number.isInteger(point.x) ||
            point.x < 0 ||
            point.x >= width ||
            !finite(point.y) ||
            !Number.isInteger(point.y) ||
            point.y < 0 ||
            point.y >= height,
        )
      )
        throw Error(
          'Room mask points must be whole tile coordinates inside the canvas.',
        );
    }
    const deviceScale = value.deviceScale ?? 1,
      labelMode = value.labelMode ?? 'sensors';
    if (!finite(deviceScale) || deviceScale <= 0)
      throw Error('Device scale must be positive.');
    if (!['none', 'sensors', 'lights', 'all'].includes(String(labelMode)))
      throw Error('This layout uses an unsupported label mode.');
    if (
      value.labelVisibility !== undefined &&
      !validFloorplanLayers(value.labelVisibility)
    )
      throw Error(
        'Label visibility must specify lights, sensors and groups as on/off values.',
      );
    return {
      grid: {
        ...value,
        devices,
        groups,
        deviceScale,
        labelMode,
      } as FloorplanGrid,
    };
  } catch (error) {
    return {
      grid: null,
      error:
        error instanceof Error
          ? error.message
          : 'Could not read the saved layout.',
    };
  }
}
