import { type Device } from '@/bindings/Device';
import { type FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { getResolvedDeviceColorState } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import {
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/lib/floorplan-metrics';
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
  color?: readonly [number, number, number];
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
  layoutKey: string;
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
  deviceVisualOverrides?: Record<string, DeviceVisualOverride>;
  includeGroups?: boolean;
}

interface DeviceVisualOverride {
  brightness?: number;
  color?: readonly [number, number, number];
  power?: boolean;
}

interface Segment {
  a: FloorplanScenePoint;
  b: FloorplanScenePoint;
}

interface StaticFloorplanScene {
  key: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  positions: Record<string, FloorplanScenePoint>;
  blockers: Segment[];
  tiles: FloorplanSceneTile[];
  visibilityPolygons: Map<string, FloorplanScenePoint[] | null>;
}

const visibilityCircleSampleCount = 144;
const maxLightRadiusBase = 300;
const staticSceneCache = new WeakMap<
  FloorplanGrid,
  Map<string, StaticFloorplanScene>
>();

function colorToRgbTuple(
  device: Device,
  override?: DeviceVisualOverride,
): readonly [number, number, number] {
  if (override?.color) {
    return override.color;
  }

  const rgb = getResolvedDeviceColorState(device.data)?.color.rgb().array();
  return [rgb?.[0] ?? 0, rgb?.[1] ?? 0, rgb?.[2] ?? 0];
}

function buildTiles(
  grid: FloorplanGrid | null,
  tileWidth: number,
  tileHeight: number,
  includeFloorTiles: boolean,
) {
  if (!grid) {
    return [];
  }

  const tiles: FloorplanSceneTile[] = [];

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const type = grid.tiles[y]?.[x] ?? 'floor';
      if (type === 'empty') {
        continue;
      }

      if (type === 'floor' && !includeFloorTiles) {
        continue;
      }

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

function isWallTile(grid: FloorplanGrid, x: number, y: number) {
  return grid.tiles[y]?.[x] === 'wall';
}

function addMergedRange(
  rangesByLine: Map<number, Array<{ start: number; end: number }>>,
  line: number,
  start: number,
  end: number,
) {
  const ranges = rangesByLine.get(line) ?? [];
  ranges.push({ start: Math.min(start, end), end: Math.max(start, end) });
  rangesByLine.set(line, ranges);
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.000001) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }

    merged.push({ ...range });
  }

  return merged;
}

function buildBlockingSegments(
  grid: FloorplanGrid | null,
  tileWidth: number,
  tileHeight: number,
): Segment[] {
  if (!grid || tileWidth <= 0 || tileHeight <= 0) {
    return [];
  }

  const horizontalEdges = new Map<number, Array<{ start: number; end: number }>>();
  const verticalEdges = new Map<number, Array<{ start: number; end: number }>>();

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (!isWallTile(grid, x, y)) {
        continue;
      }

      const left = x * tileWidth;
      const top = y * tileHeight;
      const right = left + tileWidth;
      const bottom = top + tileHeight;

      if (y === 0 || !isWallTile(grid, x, y - 1)) {
        addMergedRange(horizontalEdges, top, left, right);
      }
      if (x === grid.width - 1 || !isWallTile(grid, x + 1, y)) {
        addMergedRange(verticalEdges, right, top, bottom);
      }
      if (y === grid.height - 1 || !isWallTile(grid, x, y + 1)) {
        addMergedRange(horizontalEdges, bottom, left, right);
      }
      if (x === 0 || !isWallTile(grid, x - 1, y)) {
        addMergedRange(verticalEdges, left, top, bottom);
      }
    }
  }

  const segments: Segment[] = [];

  for (const [y, ranges] of horizontalEdges) {
    for (const range of mergeRanges(ranges)) {
      segments.push({
        a: { x: range.start, y },
        b: { x: range.end, y },
      });
    }
  }

  for (const [x, ranges] of verticalEdges) {
    for (const range of mergeRanges(ranges)) {
      segments.push({
        a: { x, y: range.start },
        b: { x, y: range.end },
      });
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

function getStaticSceneCacheKey(
  grid: FloorplanGrid,
  image: HTMLImageElement | undefined,
) {
  const imageWidth = image?.width ?? 0;
  const imageHeight = image?.height ?? 0;
  return [
    grid.width,
    grid.height,
    grid.tileSize,
    grid.deviceScale,
    grid.devices.length,
    Object.keys(grid.groups).length,
    image ? 'image' : 'grid',
    imageWidth,
    imageHeight,
  ].join(':');
}

function buildStaticFloorplanScene(
  grid: FloorplanGrid | null,
  image: HTMLImageElement | undefined,
): StaticFloorplanScene {
  const metrics = getFloorplanRenderMetrics(grid, image);

  if (!grid) {
    return {
      key: `empty:${metrics.width}:${metrics.height}`,
      width: metrics.width,
      height: metrics.height,
      tileWidth: metrics.tileWidth,
      tileHeight: metrics.tileHeight,
      positions: {},
      blockers: [],
      tiles: [],
      visibilityPolygons: new Map(),
    };
  }

  const cacheKey = getStaticSceneCacheKey(grid, image);
  const cachedByKey = staticSceneCache.get(grid);
  const cached = cachedByKey?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const staticScene: StaticFloorplanScene = {
    key: cacheKey,
    width: metrics.width,
    height: metrics.height,
    tileWidth: metrics.tileWidth,
    tileHeight: metrics.tileHeight,
    positions: getFloorplanDevicePositions(grid, metrics),
    blockers: buildBlockingSegments(
      grid,
      metrics.tileWidth,
      metrics.tileHeight,
    ),
    tiles: buildTiles(grid, metrics.tileWidth, metrics.tileHeight, !image),
    visibilityPolygons: new Map(),
  };

  const nextCachedByKey = cachedByKey ?? new Map<string, StaticFloorplanScene>();
  nextCachedByKey.set(cacheKey, staticScene);
  staticSceneCache.set(grid, nextCachedByKey);

  return staticScene;
}

function getCachedVisibilityPolygon(
  staticScene: StaticFloorplanScene,
  deviceKey: string,
  origin: FloorplanScenePoint,
  radius: number,
) {
  const cacheKey = `${deviceKey}:${radius}`;
  if (!staticScene.visibilityPolygons.has(cacheKey)) {
    staticScene.visibilityPolygons.set(
      cacheKey,
      buildVisibilityPolygon(origin, radius, staticScene.blockers) ?? null,
    );
  }

  return staticScene.visibilityPolygons.get(cacheKey) ?? undefined;
}

export function buildFloorplanScene({
  grid,
  image,
  devices,
  groups,
  displayNames,
  deviceVisualOverrides,
  includeGroups = true,
}: BuildFloorplanSceneInput): FloorplanScene {
  const staticScene = buildStaticFloorplanScene(grid, image);
  const positions = staticScene.positions;
  const deviceScale = grid?.deviceScale ?? 1;
  const lights: FloorplanSceneLight[] = [];
  const sensors: FloorplanSceneSensor[] = [];

  for (const device of devices) {
    const deviceKey = getDeviceKey(device);
    const position = positions[deviceKey];

    if (!position) {
      continue;
    }

    const override = deviceVisualOverrides?.[deviceKey];

    if ('Controllable' in device.data) {
      const resolved = getResolvedDeviceColorState(device.data);
      const brightness = override?.brightness ?? resolved?.brightness ?? 0;
      const radius = (100 + 200 * brightness) * deviceScale;
      lights.push({
        deviceKey,
        x: position.x,
        y: position.y,
        radius,
        intensity: brightness,
        power: override?.power ?? resolved?.power ?? false,
        color: colorToRgbTuple(device, override),
        visibilityPolygon: getCachedVisibilityPolygon(
          staticScene,
          deviceKey,
          position,
          maxLightRadiusBase * deviceScale,
        ),
      });
      continue;
    }

    if ('Sensor' in device.data) {
      sensors.push({
        deviceKey,
        x: position.x,
        y: position.y,
        scale: deviceScale,
        ...(override?.color ? { color: override.color } : {}),
        label: (displayNames?.[deviceKey] ?? device.name.trim()) || device.id,
        statusLabel: getSensorStatusLabel(device),
      });
    }
  }

  const groupMasks = includeGroups ? (grid?.groups ?? {}) : {};
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
    layoutKey: staticScene.key,
    width: staticScene.width,
    height: staticScene.height,
    ...(image ? { backgroundImage: image } : {}),
    tileWidth: staticScene.tileWidth,
    tileHeight: staticScene.tileHeight,
    tiles: staticScene.tiles,
    lights,
    sensors,
    groups: sceneGroups,
  };
}
