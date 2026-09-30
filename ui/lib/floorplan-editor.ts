import { validFloorplanLayers } from './floorplan-labels.ts';

export type TileType = 'empty' | 'floor' | 'wall' | 'door' | 'window';

export interface DevicePosition {
  [field: string]: unknown;
  deviceKey: string;
  deviceName: string;
  x: number;
  y: number;
}

export interface GridPoint {
  [field: string]: unknown;
  x: number;
  y: number;
}

export type HorizontalResizeDirection = 'left' | 'right';

export type VerticalResizeDirection = 'top' | 'bottom';

export type DrawShape = 'freehand' | 'line' | 'rectangle';

type ResizeOffsets = {
  x: number;
  y: number;
};

type FloorplanDeviceType = 'controllable' | 'sensor' | 'other';

export interface AvailableFloorplanDevice {
  key: string;
  name: string;
  type: FloorplanDeviceType;
  groupIds: string[];
  preview?: {
    color: string;
    brightness: number;
    power: boolean;
    disabled: boolean;
  };
}

export interface FloorplanGrid {
  [field: string]: unknown;
  labelMode?: 'none' | 'sensors' | 'lights' | 'all';
  labelVisibility?: { lights: boolean; sensors: boolean; groups: boolean };
  width: number;
  height: number;
  tiles: TileType[][];
  tileSize: number;
  deviceScale: number;
  devices: DevicePosition[];
  groups: Record<string, GridPoint[]>;
}

const defaultFloorplanDeviceScale = 1;
const minFloorplanDeviceScale = 0.5;
const maxFloorplanDeviceScale = 3;

const getCellKey = (x: number, y: number) => `${x},${y}`;

const normalizeFloorplanDeviceScale = (value: number) => {
  if (!Number.isFinite(value)) {
    return defaultFloorplanDeviceScale;
  }

  return Math.min(
    maxFloorplanDeviceScale,
    Math.max(minFloorplanDeviceScale, value),
  );
};

const normalizeGroupPoints = (
  points: unknown,
  width: number,
  height: number,
): GridPoint[] => {
  if (!Array.isArray(points)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: GridPoint[] = [];

  for (const point of points) {
    if (
      typeof point !== 'object' ||
      point === null ||
      typeof (point as GridPoint).x !== 'number' ||
      typeof (point as GridPoint).y !== 'number'
    ) {
      continue;
    }

    const x = Math.floor((point as GridPoint).x);
    const y = Math.floor((point as GridPoint).y);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }

    const key = getCellKey(x, y);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ ...point, x, y });
  }

  return normalized;
};

const normalizeGroupMasks = (
  groups: unknown,
  width: number,
  height: number,
): Record<string, GridPoint[]> => {
  if (typeof groups !== 'object' || groups === null) {
    return {};
  }

  const normalized = Object.entries(groups as Record<string, unknown>)
    .map(
      ([groupId, points]) =>
        [groupId, normalizeGroupPoints(points, width, height)] as const,
    )
    .filter(([, points]) => points.length > 0);

  return Object.fromEntries(normalized);
};

const buildEmptyTiles = (width: number, height: number): TileType[][] => {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      row.push('floor');
    }
    tiles.push(row);
  }
  return tiles;
};

const getResizeOffsets = (
  sourceGrid: FloorplanGrid,
  newWidth: number,
  newHeight: number,
  horizontalDirection: HorizontalResizeDirection,
  verticalDirection: VerticalResizeDirection,
): ResizeOffsets => ({
  x: horizontalDirection === 'left' ? newWidth - sourceGrid.width : 0,
  y: verticalDirection === 'top' ? newHeight - sourceGrid.height : 0,
});

const translateGridPoint = (
  point: GridPoint,
  offsets: ResizeOffsets,
  width: number,
  height: number,
): GridPoint | null => {
  const x = point.x + offsets.x;
  const y = point.y + offsets.y;

  if (x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }

  return { x, y };
};

export const getLinePoints = (
  start: GridPoint,
  end: GridPoint,
): GridPoint[] => {
  const points: GridPoint[] = [];

  let currentX = start.x;
  let currentY = start.y;
  const deltaX = Math.abs(end.x - start.x);
  const deltaY = Math.abs(end.y - start.y);
  const stepX = currentX < end.x ? 1 : -1;
  const stepY = currentY < end.y ? 1 : -1;
  let error = deltaX - deltaY;

  while (true) {
    points.push({ x: currentX, y: currentY });

    if (currentX === end.x && currentY === end.y) {
      return points;
    }

    const doubledError = error * 2;
    if (doubledError > -deltaY) {
      error -= deltaY;
      currentX += stepX;
    }
    if (doubledError < deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
};

export const getRectanglePoints = (
  start: GridPoint,
  end: GridPoint,
): GridPoint[] => {
  const points: GridPoint[] = [];
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      points.push({ x, y });
    }
  }

  return points;
};

export const getDragShapePoints = (
  drawShape: DrawShape,
  start: GridPoint,
  current: GridPoint,
): GridPoint[] => {
  if (drawShape === 'line') {
    return getLinePoints(start, current);
  }

  if (drawShape === 'rectangle') {
    return getRectanglePoints(start, current);
  }

  return [current];
};

export const applyTilePoints = (
  sourceGrid: FloorplanGrid,
  points: GridPoint[],
  tile: TileType,
): FloorplanGrid | null => {
  const nextTiles = [...sourceGrid.tiles],
    copied = new Set<number>();
  let changed = false;
  for (const { x, y } of points) {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= sourceGrid.width ||
      y >= sourceGrid.height ||
      nextTiles[y][x] === tile
    )
      continue;
    if (!copied.has(y)) {
      nextTiles[y] = [...nextTiles[y]];
      copied.add(y);
    }
    nextTiles[y][x] = tile;
    changed = true;
  }
  return changed ? { ...sourceGrid, tiles: nextTiles } : null;
};

export const applyGroupPoints = (
  sourceGrid: FloorplanGrid,
  groupId: string,
  points: GridPoint[],
  paintMode: GroupPaintMode,
): FloorplanGrid | null => {
  const currentPoints = sourceGrid.groups[groupId] ?? [];
  const currentPointKeys = new Set(
    currentPoints.map((point) => getCellKey(point.x, point.y)),
  );
  const targetKeys = points.map((point) => getCellKey(point.x, point.y));

  let changed = false;
  let nextPoints = currentPoints;

  if (paintMode === 'paint') {
    const appendedPoints = [...currentPoints];
    for (const point of points) {
      const pointKey = getCellKey(point.x, point.y);
      if (currentPointKeys.has(pointKey)) {
        continue;
      }

      currentPointKeys.add(pointKey);
      appendedPoints.push(point);
      changed = true;
    }
    nextPoints = appendedPoints;
  } else {
    const pointsToRemove = new Set(targetKeys);
    nextPoints = currentPoints.filter((point) => {
      const shouldKeep = !pointsToRemove.has(getCellKey(point.x, point.y));
      if (!shouldKeep) {
        changed = true;
      }
      return shouldKeep;
    });
  }

  if (!changed) {
    return null;
  }

  const nextGroups = { ...sourceGrid.groups };
  if (nextPoints.length === 0) {
    delete nextGroups[groupId];
  } else {
    nextGroups[groupId] = nextPoints;
  }

  return { ...sourceGrid, groups: nextGroups };
};

export const moveDeviceOnGrid = (
  sourceGrid: FloorplanGrid,
  deviceKey: string,
  x: number,
  y: number,
): FloorplanGrid | null => {
  const device = sourceGrid.devices.find(
    (candidate) => candidate.deviceKey === deviceKey,
  );
  if (!device || (device.x === x && device.y === y)) {
    return null;
  }

  return {
    ...sourceGrid,
    devices: sourceGrid.devices.map((candidate) =>
      candidate.deviceKey === deviceKey ? { ...candidate, x, y } : candidate,
    ),
  };
};

export const placeSelectedDeviceOnGrid = (
  sourceGrid: FloorplanGrid,
  selectedDevice: string | null,
  availableDevices: AvailableFloorplanDevice[],
  x: number,
  y: number,
): FloorplanGrid | null => {
  if (!selectedDevice) {
    return null;
  }

  const existingDevice = sourceGrid.devices.find(
    (device) => device.deviceKey === selectedDevice,
  );
  if (existingDevice) {
    return moveDeviceOnGrid(sourceGrid, selectedDevice, x, y);
  }

  const deviceInfo = availableDevices.find(
    (device) => device.key === selectedDevice,
  );
  if (!deviceInfo) {
    return null;
  }

  return {
    ...sourceGrid,
    devices: [
      ...sourceGrid.devices,
      { deviceKey: deviceInfo.key, deviceName: deviceInfo.name, x, y },
    ],
  };
};

export const removeDeviceFromGrid = (
  sourceGrid: FloorplanGrid,
  deviceKey: string,
): FloorplanGrid | null => {
  if (!sourceGrid.devices.some((device) => device.deviceKey === deviceKey)) {
    return null;
  }

  return {
    ...sourceGrid,
    devices: sourceGrid.devices.filter(
      (device) => device.deviceKey !== deviceKey,
    ),
  };
};

export const resizeGridState = (
  sourceGrid: FloorplanGrid,
  newWidth: number,
  newHeight: number,
  horizontalDirection: HorizontalResizeDirection,
  verticalDirection: VerticalResizeDirection,
): FloorplanGrid | null => {
  if (newWidth === sourceGrid.width && newHeight === sourceGrid.height) {
    return null;
  }

  const offsets = getResizeOffsets(
    sourceGrid,
    newWidth,
    newHeight,
    horizontalDirection,
    verticalDirection,
  );

  const newTiles = buildEmptyTiles(newWidth, newHeight);
  for (let y = 0; y < sourceGrid.height; y += 1) {
    for (let x = 0; x < sourceGrid.width; x += 1) {
      const translatedPoint = translateGridPoint(
        { x, y },
        offsets,
        newWidth,
        newHeight,
      );
      if (!translatedPoint) {
        continue;
      }

      newTiles[translatedPoint.y][translatedPoint.x] =
        sourceGrid.tiles[y]?.[x] ?? 'floor';
    }
  }

  const newDevices = sourceGrid.devices.flatMap((device) => {
    const x = device.x + offsets.x;
    const y = device.y + offsets.y;
    if (x < 0 || y < 0 || x >= newWidth || y >= newHeight) {
      return [];
    }

    return [{ ...device, x, y }];
  });
  const newGroups = Object.fromEntries(
    Object.entries(sourceGrid.groups)
      .map(
        ([groupId, points]) =>
          [
            groupId,
            normalizeGroupPoints(
              points.flatMap((point) => {
                const translatedPoint = translateGridPoint(
                  point,
                  offsets,
                  newWidth,
                  newHeight,
                );
                return translatedPoint
                  ? [{ ...point, ...translatedPoint }]
                  : [];
              }),
              newWidth,
              newHeight,
            ),
          ] as const,
      )
      .filter(([, points]) => points.length > 0),
  );

  return {
    ...sourceGrid,
    width: newWidth,
    height: newHeight,
    tiles: newTiles,
    devices: newDevices,
    groups: newGroups,
  };
};

type FloorplanContentBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const getFloorplanContentBounds = (
  sourceGrid: FloorplanGrid,
): FloorplanContentBounds | null => {
  let minX = sourceGrid.width;
  let minY = sourceGrid.height;
  let maxX = -1;
  let maxY = -1;

  const includePoint = (x: number, y: number) => {
    x = Math.floor(x);
    y = Math.floor(y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (let y = 0; y < sourceGrid.height; y += 1) {
    for (let x = 0; x < sourceGrid.width; x += 1) {
      const tile = sourceGrid.tiles[y]?.[x] ?? 'floor';
      if (tile !== 'floor' && tile !== 'empty') {
        includePoint(x, y);
      }
    }
  }

  for (const device of sourceGrid.devices) {
    includePoint(device.x, device.y);
  }

  for (const points of Object.values(sourceGrid.groups)) {
    for (const point of points) {
      includePoint(point.x, point.y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

export const cropGridState = (
  sourceGrid: FloorplanGrid,
): FloorplanGrid | null => {
  const bounds = getFloorplanContentBounds(sourceGrid);
  if (!bounds) {
    return null;
  }

  if (
    bounds.minX === 0 &&
    bounds.minY === 0 &&
    bounds.maxX === sourceGrid.width - 1 &&
    bounds.maxY === sourceGrid.height - 1
  ) {
    return null;
  }

  const nextWidth = bounds.maxX - bounds.minX + 1;
  const nextHeight = bounds.maxY - bounds.minY + 1;
  const nextTiles = Array.from({ length: nextHeight }, (_, rowIndex) =>
    Array.from({ length: nextWidth }, (_, columnIndex) => {
      return (
        sourceGrid.tiles[rowIndex + bounds.minY]?.[columnIndex + bounds.minX] ??
        'floor'
      );
    }),
  );
  const nextDevices = sourceGrid.devices
    .filter(
      (device) =>
        device.x >= bounds.minX &&
        device.x < bounds.maxX + 1 &&
        device.y >= bounds.minY &&
        device.y < bounds.maxY + 1,
    )
    .map((device) => ({
      ...device,
      x: device.x - bounds.minX,
      y: device.y - bounds.minY,
    }));
  const nextGroups = Object.fromEntries(
    Object.entries(sourceGrid.groups)
      .map(
        ([groupId, points]) =>
          [
            groupId,
            points
              .filter(
                (point) =>
                  point.x >= bounds.minX &&
                  point.x <= bounds.maxX &&
                  point.y >= bounds.minY &&
                  point.y <= bounds.maxY,
              )
              .map((point) => ({
                ...point,
                x: point.x - bounds.minX,
                y: point.y - bounds.minY,
              })),
          ] as const,
      )
      .filter(([, points]) => points.length > 0),
  );

  return {
    ...sourceGrid,
    width: nextWidth,
    height: nextHeight,
    tiles: nextTiles,
    devices: nextDevices,
    groups: nextGroups,
  };
};

export function createEmptyGrid(
  width: number = 64,
  height: number = 64,
  tileSize: number = 20,
): FloorplanGrid {
  return {
    width,
    height,
    tiles: buildEmptyTiles(width, height),
    tileSize,
    deviceScale: defaultFloorplanDeviceScale,
    devices: [],
    groups: {},
  };
}

// Serialize grid to JSON string
export function serializeGrid(grid: FloorplanGrid): string {
  return JSON.stringify(grid);
}

// Deserialize grid from JSON string
export function deserializeGrid(json: string): FloorplanGrid | null {
  try {
    const parsed = JSON.parse(json) as Partial<FloorplanGrid>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const width =
      typeof parsed.width === 'number' && parsed.width > 0 ? parsed.width : 64;
    const height =
      typeof parsed.height === 'number' && parsed.height > 0
        ? parsed.height
        : 64;
    const tileSize =
      typeof parsed.tileSize === 'number' && parsed.tileSize > 0
        ? parsed.tileSize
        : 20;
    const deviceScale = normalizeFloorplanDeviceScale(
      typeof parsed.deviceScale === 'number'
        ? parsed.deviceScale
        : defaultFloorplanDeviceScale,
    );

    const tiles = Array.isArray(parsed.tiles)
      ? buildEmptyTiles(width, height).map((row, rowIndex) =>
          row.map((_, columnIndex) => {
            const tile = parsed.tiles?.[rowIndex]?.[columnIndex];
            return tile === 'wall' ||
              tile === 'door' ||
              tile === 'window' ||
              tile === 'empty' ||
              tile === 'floor'
              ? tile
              : 'floor';
          }),
        )
      : buildEmptyTiles(width, height);

    const devices = Array.isArray(parsed.devices)
      ? parsed.devices.filter(
          (device): device is DevicePosition =>
            typeof device === 'object' &&
            device !== null &&
            typeof device.deviceKey === 'string' &&
            typeof device.deviceName === 'string' &&
            typeof device.x === 'number' &&
            typeof device.y === 'number',
        )
      : [];

    return {
      width,
      height,
      tiles,
      tileSize,
      deviceScale,
      devices,
      groups: normalizeGroupMasks(parsed.groups, width, height),
      ...(validFloorplanLayers(parsed.labelVisibility)
        ? { labelVisibility: parsed.labelVisibility }
        : {}),
      labelMode: ['none', 'sensors', 'lights', 'all'].includes(
        parsed.labelMode ?? '',
      )
        ? parsed.labelMode
        : 'sensors',
    };
  } catch {
    return null;
  }
}

export type GroupPaintMode = 'paint' | 'erase';
