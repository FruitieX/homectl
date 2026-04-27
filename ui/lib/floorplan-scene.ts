import { type Device } from '@/bindings/Device';
import { type FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { getBrightness, getColor, getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import {
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/ui/FloorplanBackground';
import { type FloorplanGrid, type TileType } from '@/ui/FloorplanGridEditor';

export interface FloorplanSceneTile {
  x: number;
  y: number;
  width: number;
  height: number;
  type: TileType;
}

export interface FloorplanScenePoint {
  x: number;
  y: number;
}

export interface FloorplanSceneLight {
  deviceKey: string;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  power: boolean;
  color: readonly [number, number, number];
  visibilityPolygon?: FloorplanScenePoint[];
}

export interface FloorplanSceneSensor {
  deviceKey: string;
  x: number;
  y: number;
  scale: number;
  label: string;
  statusLabel?: string;
}

export interface FloorplanSceneGroupMask {
  groupId: string;
  name: string;
  deviceKeys: string[];
  cells: Array<{ x: number; y: number }>;
}

export interface FloorplanScene {
  width: number;
  height: number;
  backgroundImage?: HTMLImageElement;
  tileWidth: number;
  tileHeight: number;
  tiles: FloorplanSceneTile[];
  lights: FloorplanSceneLight[];
  sensors: FloorplanSceneSensor[];
  groups: FloorplanSceneGroupMask[];
}

interface BuildFloorplanSceneInput {
  grid: FloorplanGrid | null;
  image?: HTMLImageElement;
  devices: Device[];
  groups: FlattenedGroupsConfig;
  displayNames?: Record<string, string>;
}

interface Segment {
  a: FloorplanScenePoint;
  b: FloorplanScenePoint;
}

const visibilityCircleSampleCount = 144;

function colorToRgbTuple(device: Device): readonly [number, number, number] {
  const rgb = getColor(device.data).rgb().array();
  return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0];
}

function buildTiles(
  grid: FloorplanGrid | null,
  tileWidth: number,
  tileHeight: number,
) {
  if (!grid) {
    return [];
  }

  const tiles: FloorplanSceneTile[] = [];

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const type = grid.tiles[y]?.[x] ?? 'floor';
      tiles.push({
        x: x * tileWidth,
        y: y * tileHeight,
        width: tileWidth,
        height: tileHeight,
        type,
      });
    }
  }

  return tiles;
}

function cross(left: FloorplanScenePoint, right: FloorplanScenePoint) {
  return left.x * right.y - left.y * right.x;
}

function subtract(left: FloorplanScenePoint, right: FloorplanScenePoint) {
  return { x: left.x - right.x, y: left.y - right.y };
}

function buildBlockingSegments(
  grid: FloorplanGrid | null,
  tileWidth: number,
  tileHeight: number,
): Segment[] {
  if (!grid || tileWidth <= 0 || tileHeight <= 0) {
    return [];
  }

  const segments: Segment[] = [];

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if ((grid.tiles[y]?.[x] ?? 'floor') !== 'wall') {
        continue;
      }

      const left = x * tileWidth;
      const top = y * tileHeight;
      const right = left + tileWidth;
      const bottom = top + tileHeight;

      segments.push(
        { a: { x: left, y: top }, b: { x: right, y: top } },
        { a: { x: right, y: top }, b: { x: right, y: bottom } },
        { a: { x: right, y: bottom }, b: { x: left, y: bottom } },
        { a: { x: left, y: bottom }, b: { x: left, y: top } },
      );
    }
  }

  return segments;
}

function intersectRaySegment(
  origin: FloorplanScenePoint,
  angle: number,
  radius: number,
  segment: Segment,
): FloorplanScenePoint | null {
  const ray = {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
  const segmentVector = subtract(segment.b, segment.a);
  const denominator = cross(ray, segmentVector);

  if (Math.abs(denominator) < 0.000001) {
    return null;
  }

  const offset = subtract(segment.a, origin);
  const rayDistance = cross(offset, segmentVector) / denominator;
  const segmentDistance = cross(offset, ray) / denominator;

  if (
    rayDistance < 0 ||
    rayDistance > 1 ||
    segmentDistance < 0 ||
    segmentDistance > 1
  ) {
    return null;
  }

  return {
    x: origin.x + ray.x * rayDistance,
    y: origin.y + ray.y * rayDistance,
  };
}

function buildVisibilityPolygon(
  origin: FloorplanScenePoint,
  radius: number,
  blockers: Segment[],
) {
  if (blockers.length === 0 || radius <= 0) {
    return undefined;
  }

  const angles = new Set<number>();
  for (let sample = 0; sample < visibilityCircleSampleCount; sample += 1) {
    angles.add((sample / visibilityCircleSampleCount) * Math.PI * 2 - Math.PI);
  }

  for (const segment of blockers) {
    for (const point of [segment.a, segment.b]) {
      const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
      angles.add(angle - 0.0001);
      angles.add(angle);
      angles.add(angle + 0.0001);
    }
  }

  return Array.from(angles)
    .sort((left, right) => left - right)
    .map((angle) => {
      let closestPoint: FloorplanScenePoint = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      };
      let closestDistance = radius;

      for (const segment of blockers) {
        const intersection = intersectRaySegment(
          origin,
          angle,
          radius,
          segment,
        );
        if (!intersection) {
          continue;
        }

        const distance = Math.hypot(
          intersection.x - origin.x,
          intersection.y - origin.y,
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPoint = intersection;
        }
      }

      return closestPoint;
    });
}

function getSensorStatusLabel(device: Device) {
  if (!('Sensor' in device.data)) {
    return undefined;
  }

  const sensor = device.data.Sensor;
  if (!('value' in sensor)) {
    return 'COLOR';
  }

  if (typeof sensor.value === 'boolean') {
    return sensor.value ? 'ON' : 'OFF';
  }

  if (typeof sensor.value === 'number' || typeof sensor.value === 'string') {
    return String(sensor.value);
  }

  return undefined;
}

export function buildFloorplanScene({
  grid,
  image,
  devices,
  groups,
  displayNames,
}: BuildFloorplanSceneInput): FloorplanScene {
  const metrics = getFloorplanRenderMetrics(grid, image);
  const positions = getFloorplanDevicePositions(grid, metrics);
  const blockers = buildBlockingSegments(
    grid,
    metrics.tileWidth,
    metrics.tileHeight,
  );
  const deviceScale = grid?.deviceScale ?? 1;
  const lights: FloorplanSceneLight[] = [];
  const sensors: FloorplanSceneSensor[] = [];

  for (const device of devices) {
    const deviceKey = getDeviceKey(device);
    const position = positions[deviceKey];

    if (!position) {
      continue;
    }

    if ('Controllable' in device.data) {
      const brightness = getBrightness(device.data);
      const radius = (100 + 200 * brightness) * deviceScale;
      lights.push({
        deviceKey,
        x: position.x,
        y: position.y,
        radius,
        intensity: brightness,
        power: getPower(device.data),
        color: colorToRgbTuple(device),
        visibilityPolygon: buildVisibilityPolygon(position, radius, blockers),
      });
      continue;
    }

    if ('Sensor' in device.data) {
      sensors.push({
        deviceKey,
        x: position.x,
        y: position.y,
        scale: deviceScale,
        label: (displayNames?.[deviceKey] ?? device.name.trim()) || device.id,
        statusLabel: getSensorStatusLabel(device),
      });
    }
  }

  const groupMasks = grid?.groups ?? {};
  const sceneGroups: FloorplanSceneGroupMask[] = Object.entries(groupMasks)
    .filter(
      ([groupId, cells]) =>
        (groups[groupId]?.hidden ?? false) === false && cells.length > 0,
    )
    .map(([groupId, cells]) => ({
      groupId,
      name: groups[groupId]?.name ?? groupId,
      deviceKeys: groups[groupId]?.device_keys ?? [],
      cells,
    }));

  return {
    width: metrics.width,
    height: metrics.height,
    ...(image ? { backgroundImage: image } : {}),
    tileWidth: metrics.tileWidth,
    tileHeight: metrics.tileHeight,
    tiles: buildTiles(grid, metrics.tileWidth, metrics.tileHeight),
    lights,
    sensors,
    groups: sceneGroups,
  };
}
