import {
  getFloorplanGroupFill,
  getFloorplanGroupStroke,
} from '@/lib/floorplanGroupColor';
import {
  getFloorplanCellBounds,
  getFloorplanCellIndex,
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/lib/floorplan-metrics';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useImageState } from '@/hooks/useImageState';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  FloorplanBackgroundControls,
  FloorplanDeviceScaleControl,
  FloorplanLegend,
  FloorplanModeBar,
} from '@/ui/floorplan/FloorplanEditorControls';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export type TileType = 'empty' | 'floor' | 'wall' | 'door' | 'window';

export interface DevicePosition {
  deviceKey: string;
  deviceName: string;
  x: number;
  y: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

type HorizontalResizeDirection = 'left' | 'right';

type VerticalResizeDirection = 'top' | 'bottom';

type DrawShape = 'freehand' | 'line' | 'rectangle';

type ResizeOffsets = {
  x: number;
  y: number;
};

type FloorplanDeviceType = 'controllable' | 'sensor' | 'other';

interface AvailableFloorplanDevice {
  key: string;
  name: string;
  type: FloorplanDeviceType;
  groupIds: string[];
}

export interface FloorplanGrid {
  width: number;
  height: number;
  tiles: TileType[][];
  tileSize: number;
  deviceScale: number;
  devices: DevicePosition[];
  groups: Record<string, GridPoint[]>;
}

interface FloorplanGridEditorProps {
  grid: FloorplanGrid;
  onChange: (grid: FloorplanGrid) => void;
  availableDevices?: AvailableFloorplanDevice[];
  availableGroups?: { id: string; name: string; hidden?: boolean | null }[];
  backgroundImageUrl?: string;
}

const tileColors: Record<TileType, string> = {
  empty: 'rgba(15, 23, 42, 0.08)',
  floor: '#e5e7eb', // gray-200
  wall: '#374151', // gray-700
  door: '#92400e', // amber-800
  window: '#60a5fa', // blue-400
};

const tileLabels: Record<TileType, string> = {
  empty: 'Empty',
  floor: 'Floor',
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
};

const drawShapeLabels: Record<DrawShape, string> = {
  freehand: 'Freehand',
  line: 'Straight',
  rectangle: 'Rectangle',
};

const defaultFloorplanDeviceScale = 1;
const minFloorplanDeviceScale = 0.5;
const maxFloorplanDeviceScale = 3;

const getCellKey = (x: number, y: number) => `${x},${y}`;

const areGridPointsEqual = (left: GridPoint | null, right: GridPoint | null) =>
  left?.x === right?.x && left?.y === right?.y;

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
    normalized.push({ x, y });
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

const cloneGrid = (grid: FloorplanGrid): FloorplanGrid => ({
  width: grid.width,
  height: grid.height,
  tileSize: grid.tileSize,
  deviceScale: grid.deviceScale,
  tiles: grid.tiles.map((row) => [...row]),
  devices: grid.devices.map((device) => ({ ...device })),
  groups: Object.fromEntries(
    Object.entries(grid.groups).map(([groupId, points]) => [
      groupId,
      points.map((point) => ({ ...point })),
    ]),
  ),
});

const getLinePoints = (start: GridPoint, end: GridPoint): GridPoint[] => {
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

const getRectanglePoints = (start: GridPoint, end: GridPoint): GridPoint[] => {
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

const getDragShapePoints = (
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

const applyTilePoints = (
  sourceGrid: FloorplanGrid,
  points: GridPoint[],
  tile: TileType,
): FloorplanGrid | null => {
  const targetPoints = new Set(
    points.map((point) => getCellKey(point.x, point.y)),
  );
  let changed = false;

  const nextTiles = sourceGrid.tiles.map((row, rowIndex) =>
    row.map((currentTile, columnIndex) => {
      if (
        !targetPoints.has(getCellKey(columnIndex, rowIndex)) ||
        currentTile === tile
      ) {
        return currentTile;
      }

      changed = true;
      return tile;
    }),
  );

  if (!changed) {
    return null;
  }

  return { ...sourceGrid, tiles: nextTiles };
};

const applyGroupPoints = (
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

const moveDeviceOnGrid = (
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

const placeSelectedDeviceOnGrid = (
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

const removeDeviceFromGrid = (
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

const resizeGridState = (
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
                return translatedPoint ? [translatedPoint] : [];
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

const getFloorplanContentBounds = (
  sourceGrid: FloorplanGrid,
): FloorplanContentBounds | null => {
  let minX = sourceGrid.width;
  let minY = sourceGrid.height;
  let maxX = -1;
  let maxY = -1;

  const includePoint = (x: number, y: number) => {
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

const cropGridState = (sourceGrid: FloorplanGrid): FloorplanGrid | null => {
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
        device.x <= bounds.maxX &&
        device.y >= bounds.minY &&
        device.y <= bounds.maxY,
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

type ActiveOperation =
  | {
      kind: 'tiles';
      baseGrid: FloorplanGrid;
      startCell: GridPoint;
      lastCell: GridPoint;
      tile: TileType;
      drawShape: DrawShape;
      historyRecorded: boolean;
      lastCellKey: string;
    }
  | {
      kind: 'groups';
      baseGrid: FloorplanGrid;
      startCell: GridPoint;
      lastCell: GridPoint;
      groupId: string;
      paintMode: GroupPaintMode;
      drawShape: DrawShape;
      historyRecorded: boolean;
      lastCellKey: string;
    }
  | {
      kind: 'devices';
      baseGrid: FloorplanGrid;
      deviceKey: string;
      lastCellKey: string;
      historyRecorded: boolean;
    };

type GroupPaintMode = 'paint' | 'erase';

type EditorMode = 'tiles' | 'devices' | 'groups';

type PaintLineAnchor = {
  mode: 'tiles' | 'groups';
  cell: GridPoint;
};

export function FloorplanGridEditor({
  grid,
  onChange,
  availableDevices = [],
  availableGroups = [],
  backgroundImageUrl,
}: FloorplanGridEditorProps) {
  const [selectedTool, setSelectedTool] = useState<TileType>('wall');
  const [mode, setMode] = useState<EditorMode>('tiles');
  const [horizontalResizeDirection, setHorizontalResizeDirection] =
    useState<HorizontalResizeDirection>('right');
  const [verticalResizeDirection, setVerticalResizeDirection] =
    useState<VerticalResizeDirection>('bottom');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupPaintMode, setGroupPaintMode] = useState<GroupPaintMode>('paint');
  const [isPainting, setIsPainting] = useState(false);
  const [draggingDevice, setDraggingDevice] = useState<string | null>(null);
  const [drawShape, setDrawShape] = useState<DrawShape>('freehand');
  const [undoStack, setUndoStack] = useState<FloorplanGrid[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [gridOpacity, setGridOpacity] = useState(0.5);
  const [lineAnchor, setLineAnchor] = useState<PaintLineAnchor | null>(null);
  const [hoveredCell, setHoveredCell] = useState<GridPoint | null>(null);
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<
    'all' | FloorplanDeviceType
  >('all');
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('all');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef(grid);
  const undoStackRef = useRef<FloorplanGrid[]>([]);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const lineAnchorRef = useRef<PaintLineAnchor | null>(null);
  const backgroundImage = useImageState(backgroundImageUrl);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftHeld(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftHeld(false);
      }
    };

    const handleBlur = () => {
      setIsShiftHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const updateLineAnchor = useCallback((nextAnchor: PaintLineAnchor | null) => {
    lineAnchorRef.current = nextAnchor;
    setLineAnchor(nextAnchor);
  }, []);

  const { width, height, tiles, devices, groups } = grid;
  const { deviceScale } = grid;

  useEffect(() => {
    if (mode === 'devices') {
      updateLineAnchor(null);
    }
  }, [mode, updateLineAnchor]);

  useEffect(() => {
    const currentLineAnchor = lineAnchorRef.current;
    if (
      currentLineAnchor &&
      (currentLineAnchor.cell.x >= width || currentLineAnchor.cell.y >= height)
    ) {
      updateLineAnchor(null);
    }
  }, [height, updateLineAnchor, width]);
  const renderMetrics = useMemo(
    () => getFloorplanRenderMetrics(grid, backgroundImage),
    [grid, backgroundImage],
  );
  const canvasWidth = Math.round(renderMetrics.width);
  const canvasHeight = Math.round(renderMetrics.height);
  const columnBounds = useMemo(
    () =>
      Array.from({ length: width }, (_, columnIndex) =>
        getFloorplanCellBounds(columnIndex, width, canvasWidth),
      ),
    [canvasWidth, width],
  );
  const rowBounds = useMemo(
    () =>
      Array.from({ length: height }, (_, rowIndex) =>
        getFloorplanCellBounds(rowIndex, height, canvasHeight),
      ),
    [canvasHeight, height],
  );
  const devicePositions = useMemo(
    () => getFloorplanDevicePositions(grid, renderMetrics),
    [grid, renderMetrics],
  );
  const previewLinePoints = useMemo(() => {
    if (
      isPainting ||
      mode === 'devices' ||
      !isShiftHeld ||
      !hoveredCell ||
      !lineAnchor ||
      lineAnchor.mode !== mode
    ) {
      return [];
    }

    if (mode === 'groups' && !selectedGroup) {
      return [];
    }

    if (areGridPointsEqual(lineAnchor.cell, hoveredCell)) {
      return [];
    }

    return getLinePoints(lineAnchor.cell, hoveredCell);
  }, [hoveredCell, isPainting, isShiftHeld, lineAnchor, mode, selectedGroup]);
  const sortedGroups = [...availableGroups].sort((left, right) => {
    const hiddenDelta =
      Number(Boolean(left.hidden)) - Number(Boolean(right.hidden));
    if (hiddenDelta !== 0) {
      return hiddenDelta;
    }
    return left.name.localeCompare(right.name);
  });

  useEffect(() => {
    if (!selectedGroup && sortedGroups[0]) {
      setSelectedGroup(sortedGroups[0].id);
    }
  }, [selectedGroup, sortedGroups]);

  const pushUndoSnapshot = useCallback((snapshot: FloorplanGrid) => {
    setUndoStack((previousStack) => {
      const nextStack = [...previousStack, cloneGrid(snapshot)];
      return nextStack.slice(-50);
    });
  }, []);

  const updateGrid = useCallback(
    (nextGrid: FloorplanGrid) => {
      gridRef.current = nextGrid;
      onChange(nextGrid);
    },
    [onChange],
  );

  const applyDiscreteChange = useCallback(
    (nextGrid: FloorplanGrid | null, sourceGrid: FloorplanGrid) => {
      if (!nextGrid) {
        return false;
      }

      pushUndoSnapshot(sourceGrid);
      updateGrid(nextGrid);
      return true;
    },
    [pushUndoSnapshot, updateGrid],
  );

  const resetInteractionState = useCallback(() => {
    activeOperationRef.current = null;
    setIsPainting(false);
    setDraggingDevice(null);
  }, []);

  const handleUndo = useCallback(() => {
    const previousGrid = undoStackRef.current.at(-1);
    if (!previousGrid) {
      return;
    }

    setUndoStack((previousStack) => previousStack.slice(0, -1));
    resetInteractionState();
    updateGrid(cloneGrid(previousGrid));
  }, [resetInteractionState, updateGrid]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'z' ||
        event.shiftKey
      ) {
        return;
      }

      if (undoStackRef.current.length === 0) {
        return;
      }

      event.preventDefault();
      handleUndo();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndo]);

  // Draw the grid
  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const overlayMode = Boolean(backgroundImage);

    if (backgroundImage) {
      ctx.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight);
    }

    const shouldDrawTiles = !overlayMode || showGrid;
    if (shouldDrawTiles) {
      ctx.globalAlpha = overlayMode ? gridOpacity : 1;
      for (let y = 0; y < height; y++) {
        const row = rowBounds[y];
        for (let x = 0; x < width; x++) {
          const tile = tiles[y]?.[x] || 'floor';
          if (tile === 'empty') {
            continue;
          }

          if (overlayMode && tile === 'floor') {
            continue;
          }

          const column = columnBounds[x];
          ctx.fillStyle = tileColors[tile];
          ctx.fillRect(column.start, row.start, column.size, row.size);
        }
      }
      ctx.globalAlpha = 1;
    }

    if (mode === 'groups') {
      for (const [groupId, points] of Object.entries(groups)) {
        const isSelected = groupId === selectedGroup;
        const fill = getFloorplanGroupFill(groupId, isSelected ? 0.45 : 0.2);
        const stroke = getFloorplanGroupStroke(
          groupId,
          isSelected ? 0.95 : 0.35,
        );

        for (const point of points) {
          const column = columnBounds[point.x];
          const row = rowBounds[point.y];
          if (!column || !row) {
            continue;
          }

          ctx.fillStyle = fill;
          ctx.fillRect(column.start, row.start, column.size, row.size);

          if (isSelected) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.strokeRect(
              column.start + 0.5,
              row.start + 0.5,
              Math.max(column.size - 1, 0),
              Math.max(row.size - 1, 0),
            );
          }
        }
      }
    }

    // Draw grid lines
    ctx.strokeStyle = overlayMode ? 'rgba(156, 163, 175, 0.3)' : '#9ca3af';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < height; y++) {
      const row = rowBounds[y];
      for (let x = 0; x < width; x++) {
        const column = columnBounds[x];
        ctx.strokeRect(column.start, row.start, column.size, row.size);
      }
    }

    if (previewLinePoints.length > 0) {
      const previewFill =
        mode === 'tiles'
          ? tileColors[selectedTool]
          : selectedGroup
            ? getFloorplanGroupFill(selectedGroup, 0.4)
            : null;
      const previewStroke =
        mode === 'tiles'
          ? '#111827'
          : selectedGroup
            ? getFloorplanGroupStroke(selectedGroup, 0.95)
            : null;

      if (previewFill && previewStroke) {
        ctx.save();
        ctx.setLineDash([4, 2]);
        ctx.lineWidth = 1.5;

        for (const point of previewLinePoints) {
          const column = columnBounds[point.x];
          const row = rowBounds[point.y];
          if (!column || !row) {
            continue;
          }

          ctx.globalAlpha = 0.6;
          ctx.fillStyle = previewFill;
          ctx.fillRect(column.start, row.start, column.size, row.size);

          ctx.globalAlpha = 1;
          ctx.strokeStyle = previewStroke;
          ctx.strokeRect(
            column.start + 0.75,
            row.start + 0.75,
            Math.max(column.size - 1.5, 0),
            Math.max(row.size - 1.5, 0),
          );
        }

        ctx.restore();
      }
    }

    // Draw devices
    devices.forEach((device) => {
      const isSelected =
        selectedDevice === device.deviceKey ||
        draggingDevice === device.deviceKey;
      const position = devicePositions[device.deviceKey];
      const column = columnBounds[device.x];
      const row = rowBounds[device.y];
      if (!position || !column || !row) {
        return;
      }

      const deviceRadius = Math.max(4, Math.min(column.size, row.size) / 3);
      const scaledRadius = deviceRadius * deviceScale;
      const labelFontSize = 10 * deviceScale;

      ctx.beginPath();
      ctx.arc(position.x, position.y, scaledRadius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#f59e0b' : '#10b981';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#d97706' : '#059669';
      ctx.lineWidth = Math.max(1, 2 * deviceScale);
      ctx.stroke();

      ctx.font = `${labelFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      const labelY = position.y + scaledRadius + 12 * deviceScale;
      if (labelY < canvasHeight) {
        const deviceLabel = device.deviceName.slice(0, 10);
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(2, 3 * deviceScale);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeText(deviceLabel, position.x, labelY);
        ctx.fillStyle = '#000';
        ctx.fillText(deviceLabel, position.x, labelY);
      }
    });
  }, [
    width,
    height,
    tiles,
    canvasWidth,
    canvasHeight,
    devices,
    groups,
    columnBounds,
    rowBounds,
    backgroundImage,
    devicePositions,
    selectedDevice,
    draggingDevice,
    selectedGroup,
    previewLinePoints,
    mode,
    showGrid,
    gridOpacity,
    selectedTool,
    deviceScale,
  ]);

  // Use a layout effect so the canvas is repainted before the browser
  // paints, preventing a flash of empty canvas on Firefox. React's commit
  // phase sets the `width`/`height` attributes on the canvas (which clears
  // the bitmap); drawing in useEffect happens after paint, so Firefox shows
  // a blank frame first. useLayoutEffect fires synchronously after DOM
  // mutations but before paint, eliminating the flash.
  useLayoutEffect(() => {
    drawGrid();
  }, [drawGrid]);

  // Get tile coordinates from mouse event
  const getTileCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pixelX = (e.clientX - rect.left) * scaleX;
    const pixelY = (e.clientY - rect.top) * scaleY;

    const x = getFloorplanCellIndex(pixelX, width, canvas.width);
    const y = getFloorplanCellIndex(pixelY, height, canvas.height);

    if (x !== null && y !== null) {
      return { x, y };
    }
    return null;
  };

  // Find device at coordinates
  const findDeviceAt = (x: number, y: number) => {
    return devices.find((d) => d.x === x && d.y === y);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) {
      return;
    }

    e.preventDefault();
    const coords = getTileCoords(e);
    if (!coords) return;

    setHoveredCell((previousCell) =>
      areGridPointsEqual(previousCell, coords) ? previousCell : coords,
    );

    const currentGrid = cloneGrid(gridRef.current);
    const currentDrawShape = drawShape;
    const currentLineAnchor = lineAnchorRef.current;

    if (mode === 'tiles') {
      const tile = e.button === 2 ? 'floor' : selectedTool;
      if (e.shiftKey && currentLineAnchor?.mode === 'tiles') {
        applyDiscreteChange(
          applyTilePoints(
            currentGrid,
            getLinePoints(currentLineAnchor.cell, coords),
            tile,
          ),
          currentGrid,
        );
        updateLineAnchor({ mode: 'tiles', cell: coords });
        return;
      }

      const nextGrid = applyTilePoints(currentGrid, [coords], tile);

      activeOperationRef.current = {
        kind: 'tiles',
        baseGrid: currentGrid,
        startCell: coords,
        lastCell: coords,
        tile,
        drawShape: currentDrawShape,
        historyRecorded: nextGrid !== null,
        lastCellKey: getCellKey(coords.x, coords.y),
      };
      setIsPainting(true);
      if (nextGrid) {
        pushUndoSnapshot(currentGrid);
        updateGrid(nextGrid);
      }
    } else if (mode === 'groups') {
      if (!selectedGroup) {
        return;
      }

      const paintMode = e.button === 2 ? 'erase' : groupPaintMode;
      if (e.shiftKey && currentLineAnchor?.mode === 'groups') {
        applyDiscreteChange(
          applyGroupPoints(
            currentGrid,
            selectedGroup,
            getLinePoints(currentLineAnchor.cell, coords),
            paintMode,
          ),
          currentGrid,
        );
        updateLineAnchor({ mode: 'groups', cell: coords });
        return;
      }

      const nextGrid = applyGroupPoints(
        currentGrid,
        selectedGroup,
        [coords],
        paintMode,
      );

      activeOperationRef.current = {
        kind: 'groups',
        baseGrid: currentGrid,
        startCell: coords,
        lastCell: coords,
        groupId: selectedGroup,
        paintMode,
        drawShape: currentDrawShape,
        historyRecorded: nextGrid !== null,
        lastCellKey: getCellKey(coords.x, coords.y),
      };
      setIsPainting(true);
      if (nextGrid) {
        pushUndoSnapshot(currentGrid);
        updateGrid(nextGrid);
      }
    } else {
      const deviceAtPos = findDeviceAt(coords.x, coords.y);
      if (e.button === 2) {
        if (!deviceAtPos) {
          return;
        }

        applyDiscreteChange(
          removeDeviceFromGrid(currentGrid, deviceAtPos.deviceKey),
          currentGrid,
        );
        if (selectedDevice === deviceAtPos.deviceKey) {
          setSelectedDevice(null);
        }
        return;
      }

      if (deviceAtPos) {
        setDraggingDevice(deviceAtPos.deviceKey);
        setSelectedDevice(deviceAtPos.deviceKey);
        activeOperationRef.current = {
          kind: 'devices',
          baseGrid: currentGrid,
          deviceKey: deviceAtPos.deviceKey,
          lastCellKey: getCellKey(coords.x, coords.y),
          historyRecorded: false,
        };
      } else if (selectedDevice) {
        applyDiscreteChange(
          placeSelectedDeviceOnGrid(
            currentGrid,
            selectedDevice,
            availableDevices,
            coords.x,
            coords.y,
          ),
          currentGrid,
        );
      }
      return;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getTileCoords(e);
    if (!coords) return;

    setHoveredCell((previousCell) =>
      areGridPointsEqual(previousCell, coords) ? previousCell : coords,
    );

    const pointKey = getCellKey(coords.x, coords.y);
    const activeOperation = activeOperationRef.current;
    if (!activeOperation || activeOperation.lastCellKey === pointKey) {
      return;
    }

    if (activeOperation.kind === 'tiles' && isPainting) {
      const points = getDragShapePoints(
        activeOperation.drawShape,
        activeOperation.startCell,
        coords,
      );
      const sourceGrid =
        activeOperation.drawShape === 'freehand'
          ? gridRef.current
          : activeOperation.baseGrid;
      const nextGrid = applyTilePoints(
        sourceGrid,
        points,
        activeOperation.tile,
      );
      const nextOperation = {
        ...activeOperation,
        lastCell: coords,
        lastCellKey: pointKey,
      };
      if (!nextGrid) {
        activeOperationRef.current = nextOperation;
        return;
      }

      if (!activeOperation.historyRecorded) {
        pushUndoSnapshot(activeOperation.baseGrid);
      }

      activeOperationRef.current = {
        ...nextOperation,
        historyRecorded: true,
      };
      updateGrid(nextGrid);
    } else if (activeOperation.kind === 'groups' && isPainting) {
      const points = getDragShapePoints(
        activeOperation.drawShape,
        activeOperation.startCell,
        coords,
      );
      const sourceGrid =
        activeOperation.drawShape === 'freehand'
          ? gridRef.current
          : activeOperation.baseGrid;
      const nextGrid = applyGroupPoints(
        sourceGrid,
        activeOperation.groupId,
        points,
        activeOperation.paintMode,
      );
      const nextOperation = {
        ...activeOperation,
        lastCell: coords,
        lastCellKey: pointKey,
      };
      if (!nextGrid) {
        activeOperationRef.current = nextOperation;
        return;
      }

      if (!activeOperation.historyRecorded) {
        pushUndoSnapshot(activeOperation.baseGrid);
      }

      activeOperationRef.current = {
        ...nextOperation,
        historyRecorded: true,
      };
      updateGrid(nextGrid);
    } else if (
      activeOperation.kind === 'devices' &&
      mode === 'devices' &&
      draggingDevice
    ) {
      const nextGrid = moveDeviceOnGrid(
        activeOperation.baseGrid,
        activeOperation.deviceKey,
        coords.x,
        coords.y,
      );
      if (!nextGrid) {
        return;
      }

      if (!activeOperation.historyRecorded) {
        pushUndoSnapshot(activeOperation.baseGrid);
      }

      activeOperationRef.current = {
        ...activeOperation,
        historyRecorded: true,
        lastCellKey: pointKey,
      };
      updateGrid(nextGrid);
    }
  };

  const handleMouseUp = () => {
    const activeOperation = activeOperationRef.current;

    if (activeOperation?.kind === 'tiles') {
      updateLineAnchor({ mode: 'tiles', cell: activeOperation.lastCell });
    } else if (activeOperation?.kind === 'groups') {
      updateLineAnchor({ mode: 'groups', cell: activeOperation.lastCell });
    }

    resetInteractionState();
  };

  const handleMouseLeave = () => {
    setHoveredCell(null);
    resetInteractionState();
  };

  // Fill all tiles with selected type
  const fillAll = (type: TileType) => {
    const currentGrid = cloneGrid(gridRef.current);
    applyDiscreteChange(
      {
        ...currentGrid,
        tiles: currentGrid.tiles.map((row) => row.map(() => type)),
      },
      currentGrid,
    );
  };

  // Resize grid
  const resizeGrid = (newWidth: number, newHeight: number) => {
    const currentGrid = cloneGrid(gridRef.current);
    const offsets = getResizeOffsets(
      currentGrid,
      newWidth,
      newHeight,
      horizontalResizeDirection,
      verticalResizeDirection,
    );

    if (
      !applyDiscreteChange(
        resizeGridState(
          currentGrid,
          newWidth,
          newHeight,
          horizontalResizeDirection,
          verticalResizeDirection,
        ),
        currentGrid,
      )
    ) {
      return;
    }

    setHoveredCell(null);

    const currentLineAnchor = lineAnchorRef.current;
    if (!currentLineAnchor) {
      return;
    }

    const nextAnchorCell = translateGridPoint(
      currentLineAnchor.cell,
      offsets,
      newWidth,
      newHeight,
    );
    updateLineAnchor(
      nextAnchorCell ? { ...currentLineAnchor, cell: nextAnchorCell } : null,
    );
  };

  const updateDeviceScale = (nextScale: number) => {
    const normalizedScale = normalizeFloorplanDeviceScale(nextScale);
    const currentGrid = cloneGrid(gridRef.current);

    if (currentGrid.deviceScale === normalizedScale) {
      return;
    }

    applyDiscreteChange(
      { ...currentGrid, deviceScale: normalizedScale },
      currentGrid,
    );
  };

  const contentBounds = useMemo(() => getFloorplanContentBounds(grid), [grid]);
  const canAutoCrop =
    contentBounds !== null &&
    (contentBounds.minX > 0 ||
      contentBounds.minY > 0 ||
      contentBounds.maxX < width - 1 ||
      contentBounds.maxY < height - 1);

  const autoCrop = () => {
    const currentGrid = cloneGrid(gridRef.current);
    if (applyDiscreteChange(cropGridState(currentGrid), currentGrid)) {
      updateLineAnchor(null);
    }
  };

  // Devices not yet placed
  const normalizedDeviceSearch = deviceSearch.trim().toLowerCase();
  const availableDeviceByKey = Object.fromEntries(
    availableDevices.map((device) => [device.key, device]),
  );
  const matchesDeviceFilters = (device: AvailableFloorplanDevice) => {
    if (deviceTypeFilter !== 'all' && device.type !== deviceTypeFilter) {
      return false;
    }

    if (
      deviceGroupFilter !== 'all' &&
      !device.groupIds.includes(deviceGroupFilter)
    ) {
      return false;
    }

    if (!normalizedDeviceSearch) {
      return true;
    }

    const haystack = `${device.name} ${device.key}`.toLowerCase();
    return haystack.includes(normalizedDeviceSearch);
  };
  const filteredAvailableDevices =
    availableDevices.filter(matchesDeviceFilters);
  const unplacedDevices = filteredAvailableDevices.filter(
    (device) => !devices.find((placed) => placed.deviceKey === device.key),
  );
  const placedDevices = devices
    .filter((device) => {
      const info = availableDeviceByKey[device.deviceKey];
      if (info) {
        return matchesDeviceFilters(info);
      }

      return normalizedDeviceSearch.length === 0 && deviceGroupFilter === 'all';
    })
    .sort((left, right) => left.deviceName.localeCompare(right.deviceName));
  const drawShapeControl = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">Drag shape</span>
      <div className="flex rounded-xl bg-muted p-1">
        {(Object.keys(drawShapeLabels) as DrawShape[]).map((shape) => (
          <Button
            key={shape}
            variant={drawShape === shape ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setDrawShape(shape)}
            type="button"
          >
            {drawShapeLabels[shape]}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <FloorplanModeBar
        mode={mode}
        canUndo={undoStack.length > 0}
        canAutoCrop={canAutoCrop}
        onModeChange={setMode}
        onUndo={handleUndo}
        onAutoCrop={autoCrop}
      />

      <FloorplanDeviceScaleControl
        value={grid.deviceScale}
        min={minFloorplanDeviceScale}
        max={maxFloorplanDeviceScale}
        onChange={updateDeviceScale}
      />

      {backgroundImageUrl && (
        <FloorplanBackgroundControls
          mode={mode}
          showGrid={showGrid}
          gridOpacity={gridOpacity}
          onShowGridChange={setShowGrid}
          onGridOpacityChange={setGridOpacity}
        />
      )}

      {/* Tile toolbar */}
      {mode === 'tiles' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex flex-wrap rounded-2xl bg-muted p-1">
              {(Object.keys(tileColors) as TileType[]).map((type) => (
                <Button
                  key={type}
                  variant={selectedTool === type ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSelectedTool(type)}
                >
                  <span
                    className="w-4 h-4 rounded border border-border"
                    style={{ backgroundColor: tileColors[type] }}
                  />
                  {tileLabels[type]}
                </Button>
              ))}
            </div>

            <div className="h-8 w-px bg-border" />

            <div className="flex gap-2 items-center">
              <span className="text-sm">Size:</span>
              <Input
                type="number"
                className="h-9 w-16"
                value={width}
                onChange={(e) =>
                  resizeGrid(parseInt(e.target.value) || 10, height)
                }
                min={5}
                max={100}
              />
              <span>×</span>
              <Input
                type="number"
                className="h-9 w-16"
                value={height}
                onChange={(e) =>
                  resizeGrid(width, parseInt(e.target.value) || 10)
                }
                min={5}
                max={100}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Expand:</span>
              <div className="flex rounded-xl bg-muted p-1">
                <Button
                  variant={
                    horizontalResizeDirection === 'left' ? 'default' : 'ghost'
                  }
                  size="sm"
                  onClick={() => setHorizontalResizeDirection('left')}
                  type="button"
                >
                  Left
                </Button>
                <Button
                  variant={
                    horizontalResizeDirection === 'right' ? 'default' : 'ghost'
                  }
                  size="sm"
                  onClick={() => setHorizontalResizeDirection('right')}
                  type="button"
                >
                  Right
                </Button>
              </div>
              <div className="flex rounded-xl bg-muted p-1">
                <Button
                  variant={
                    verticalResizeDirection === 'top' ? 'default' : 'ghost'
                  }
                  size="sm"
                  onClick={() => setVerticalResizeDirection('top')}
                  type="button"
                >
                  Top
                </Button>
                <Button
                  variant={
                    verticalResizeDirection === 'bottom' ? 'default' : 'ghost'
                  }
                  size="sm"
                  onClick={() => setVerticalResizeDirection('bottom')}
                  type="button"
                >
                  Bottom
                </Button>
              </div>
            </div>

            {drawShapeControl}

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-sm text-muted-foreground">Fill all:</span>
              {(Object.keys(tileColors) as TileType[]).map((type) => (
                <Button
                  key={type}
                  variant="ghost"
                  size="sm"
                  onClick={() => fillAll(type)}
                >
                  {tileLabels[type]}
                </Button>
              ))}
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Left click paints, right click temporarily erases back to floor, and
            drag shape controls whether dragging draws freehand, straight lines,
            or filled rectangles. Shift previews a line from the last clicked
            cell to the cursor.
            {lineAnchor?.mode === 'tiles'
              ? ` Hold Shift to preview from ${lineAnchor.cell.x + 1}, ${lineAnchor.cell.y + 1}, then Shift-click to draw the line.`
              : ' Click a cell to set the anchor, then hold Shift and click another cell to connect them.'}
          </div>
        </div>
      )}

      {mode === 'groups' && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Select a group, then click and drag to paint its area. Choose
            Rectangle drag shape to fill room-like areas quickly. Right click
            temporarily erases, and holding Shift previews a line from the last
            clicked cell.
            {lineAnchor?.mode === 'groups'
              ? ` Hold Shift to preview from ${lineAnchor.cell.x + 1}, ${lineAnchor.cell.y + 1}, then Shift-click to draw the line.`
              : ' Click a cell to set the anchor, then hold Shift and click another cell to connect them.'}
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="space-y-2 w-full max-w-sm">
              <span className="text-sm font-medium">Group</span>
              <select
                className={selectClassName}
                value={selectedGroup ?? ''}
                onChange={(e) => setSelectedGroup(e.target.value || null)}
              >
                <option value="">Select group...</option>
                {sortedGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.hidden ? ' (hidden)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex rounded-2xl bg-muted p-1">
              <Button
                variant={groupPaintMode === 'paint' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setGroupPaintMode('paint')}
              >
                Paint
              </Button>
              <Button
                variant={groupPaintMode === 'erase' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setGroupPaintMode('erase')}
              >
                Erase
              </Button>
            </div>

            {drawShapeControl}

            <Button
              variant="ghost"
              size="sm"
              disabled={!selectedGroup || !groups[selectedGroup]?.length}
              onClick={() => {
                if (!selectedGroup) {
                  return;
                }

                const currentGrid = cloneGrid(gridRef.current);
                const nextGroups = { ...currentGrid.groups };
                delete nextGroups[selectedGroup];
                applyDiscreteChange(
                  { ...currentGrid, groups: nextGroups },
                  currentGrid,
                );
              }}
            >
              Clear Group
            </Button>
          </div>

          {Object.keys(groups).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              {Object.entries(groups).map(([groupId, points]) => {
                const info = sortedGroups.find((group) => group.id === groupId);
                return (
                  <Button
                    key={groupId}
                    variant={selectedGroup === groupId ? 'default' : 'outline'}
                    size="sm"
                    className="gap-2 rounded-full"
                    onClick={() => setSelectedGroup(groupId)}
                  >
                    <span
                      className="w-3 h-3 rounded-sm border"
                      style={{
                        backgroundColor: getFloorplanGroupFill(groupId, 0.45),
                        borderColor: getFloorplanGroupStroke(groupId),
                      }}
                    />
                    {info?.name ?? groupId}
                    <span className="text-muted-foreground">
                      {points.length}
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Device toolbar */}
      {mode === 'devices' && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Select a device below, then click on the grid to place it. Drag
            placed devices to move them.
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="space-y-2 w-full max-w-xs">
              <span className="text-sm font-medium">Search</span>
              <Input
                type="text"
                className="h-9"
                placeholder="Search by name or id"
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
              />
            </label>

            <label className="w-full max-w-48 space-y-2">
              <span className="text-sm font-medium">Type</span>
              <select
                className={selectClassName}
                value={deviceTypeFilter}
                onChange={(e) =>
                  setDeviceTypeFilter(
                    e.target.value as 'all' | FloorplanDeviceType,
                  )
                }
              >
                <option value="all">All devices</option>
                <option value="controllable">Lights / devices</option>
                <option value="sensor">Sensors</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="space-y-2 w-full max-w-xs">
              <span className="text-sm font-medium">Group</span>
              <select
                className={selectClassName}
                value={deviceGroupFilter}
                onChange={(e) => setDeviceGroupFilter(e.target.value)}
              >
                <option value="all">All groups</option>
                {sortedGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.hidden ? ' (hidden)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {(deviceSearch ||
              deviceTypeFilter !== 'all' ||
              deviceGroupFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            Matching devices: {filteredAvailableDevices.length} total ·{' '}
            {unplacedDevices.length} unplaced · {placedDevices.length} placed
          </div>

          <div className="max-h-56 overflow-y-auto rounded-2xl border border-border bg-muted/30 p-2">
            <div className="flex flex-wrap gap-2">
              {unplacedDevices.map((device) => (
                <Button
                  key={device.key}
                  variant={
                    selectedDevice === device.key ? 'default' : 'outline'
                  }
                  size="sm"
                  onClick={() => setSelectedDevice(device.key)}
                >
                  {device.name}
                </Button>
              ))}
              {unplacedDevices.length === 0 && availableDevices.length > 0 && (
                <span className="px-1 py-2 text-sm text-muted-foreground">
                  {filteredAvailableDevices.length === 0
                    ? 'No devices match the current filters.'
                    : 'All matching devices are already placed.'}
                </span>
              )}
              {availableDevices.length === 0 && (
                <span className="px-1 py-2 text-sm text-muted-foreground">
                  No devices available.
                </span>
              )}
            </div>
          </div>
          {devices.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">Placed:</span>
              {placedDevices.map((d) => (
                <Button
                  key={d.deviceKey}
                  variant={
                    selectedDevice === d.deviceKey ? 'default' : 'outline'
                  }
                  size="sm"
                  className="gap-1 rounded-full"
                  onClick={() => setSelectedDevice(d.deviceKey)}
                >
                  {d.deviceName}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 inline-flex size-5 items-center justify-center rounded-full hover:bg-background/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentGrid = cloneGrid(gridRef.current);
                      const nextGrid = removeDeviceFromGrid(
                        currentGrid,
                        d.deviceKey,
                      );
                      if (
                        applyDiscreteChange(nextGrid, currentGrid) &&
                        selectedDevice === d.deviceKey
                      ) {
                        setSelectedDevice(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        const currentGrid = cloneGrid(gridRef.current);
                        const nextGrid = removeDeviceFromGrid(
                          currentGrid,
                          d.deviceKey,
                        );
                        if (
                          applyDiscreteChange(nextGrid, currentGrid) &&
                          selectedDevice === d.deviceKey
                        ) {
                          setSelectedDevice(null);
                        }
                      }
                    }}
                  >
                    ✕
                  </span>
                </Button>
              ))}
              {placedDevices.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  No placed devices match the current filters.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Canvas */}
      <div className="overflow-auto rounded-2xl border border-border bg-muted/40 p-2">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="cursor-crosshair"
          style={{ maxWidth: '100%', height: 'auto' }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
      </div>

      <FloorplanLegend tileColors={tileColors} tileLabels={tileLabels} />
    </div>
  );
}

// Create an empty grid
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
    };
  } catch {
    return null;
  }
}
