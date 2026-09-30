import { SearchablePicker } from '@/ui/SearchablePicker';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import {
  getFloorplanGroupFill,
  getFloorplanGroupStroke,
} from '@/lib/floorplanGroupColor';
import { Lightbulb, MapPin, Radio, X } from 'lucide-react';
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

export type TileType = 'empty' | 'floor' | 'wall' | 'door' | 'window';

function GridDimensionInput({
  value,
  label,
  max,
  onCommit,
}: {
  value: number;
  label: string;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const next = Number(raw);
    if (!raw.trim() || !Number.isInteger(next) || next < 1 || next > max) {
      setText(String(value));
      setError(true);
      return;
    }
    setError(false);
    onCommit(next);
  };
  return (
    <div>
      <Input
        type="number"
        aria-label={label}
        className="h-9 w-20"
        value={text}
        min={1}
        max={max}
        onChange={(event) => {
          setText(event.target.value);
          setError(false);
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setText(String(value));
            setError(false);
          }
        }}
      />
      {error && (
        <p role="alert" className="max-w-48 text-xs text-destructive">
          Use a whole number from 1 to {max}. The canvas size was kept.
        </p>
      )}
    </div>
  );
}

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
  preview?: {
    color: string;
    brightness: number;
    power: boolean;
    disabled: boolean;
  };
}

export interface FloorplanGrid {
  labelMode?: 'none' | 'sensors' | 'lights' | 'all';
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

const cloneGrid = (grid: FloorplanGrid): FloorplanGrid => ({
  ...grid,
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
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('');
  const [viewZoom, setViewZoom] = useState(1);
  const [placementTab, setPlacementTab] = useState<'unplaced' | 'placed'>(
    'unplaced',
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 500 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() =>
      setViewportSize({
        width: Math.max(1, viewport.clientWidth - 16),
        height: Math.max(1, viewport.clientHeight - 16),
      }),
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const [panning, setPanning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panGesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const pointerGesture = useRef<{
    grid: FloorplanGrid;
    undoLength: number;
    pointerId: number;
  } | null>(null);
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
  const baseMetrics = getFloorplanRenderMetrics(grid, backgroundImage);
  const fitScale = Math.min(
    viewportSize.width / baseMetrics.width,
    viewportSize.height / baseMetrics.height,
  );
  const displayWidth = baseMetrics.width * fitScale * viewZoom;
  const displayHeight = baseMetrics.height * fitScale * viewZoom;
  const renderMetrics = useMemo(() => {
    const metrics = getFloorplanRenderMetrics(grid, backgroundImage);
    const scale = Math.min(
      Math.max(
        1,
        1280 / Math.max(metrics.width, metrics.height),
        fitScale * viewZoom * (window.devicePixelRatio || 1),
      ),
      4096 / Math.max(metrics.width, metrics.height),
      Math.sqrt(8_000_000 / (metrics.width * metrics.height)),
    );
    return {
      width: metrics.width * scale,
      height: metrics.height * scale,
      tileWidth: metrics.tileWidth * scale,
      tileHeight: metrics.tileHeight * scale,
    };
  }, [grid, backgroundImage, fitScale, viewZoom]);
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

      // Keep labels and markers readable in CSS pixels independently of the
      // high-resolution backing canvas. Geometry still uses exact grid cells.
      const pixelScale = canvasWidth / displayWidth;
      const scaledRadius =
        Math.max(
          7 * pixelScale,
          Math.min(14 * pixelScale, Math.min(column.size, row.size) / 3),
        ) * deviceScale;
      const labelFontSize = 12 * pixelScale;
      const info = availableDevices.find(
        (item) => item.key === device.deviceKey,
      );
      const preview = info?.preview;
      const color =
        preview?.disabled || (preview && !preview.power)
          ? '#94a3b8'
          : (preview?.color ?? '#10b981');
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        position.x,
        position.y,
        scaledRadius + 4 * pixelScale,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#d97706' : '#64748b';
      ctx.lineWidth = (isSelected ? 2 : 1) * pixelScale;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(position.x, position.y, scaledRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (preview?.power && !preview.disabled) {
        ctx.beginPath();
        ctx.arc(
          position.x,
          position.y,
          scaledRadius + 2 * pixelScale,
          -Math.PI / 2,
          -Math.PI / 2 +
            Math.max(0, Math.min(1, preview.brightness)) * Math.PI * 2,
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * pixelScale;
        ctx.stroke();
      }
      if (preview?.disabled) {
        ctx.beginPath();
        ctx.moveTo(position.x - scaledRadius, position.y + scaledRadius);
        ctx.lineTo(position.x + scaledRadius, position.y - scaledRadius);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2 * pixelScale;
        ctx.stroke();
      }

      ctx.font = `${labelFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      const name = info?.name ?? device.deviceName;
      const deviceLabel = name.length > 22 ? `${name.slice(0, 21)}…` : name;
      const textWidth = ctx.measureText(deviceLabel).width;
      const labelX = Math.max(
        textWidth / 2 + 4 * pixelScale,
        Math.min(canvasWidth - textWidth / 2 - 4 * pixelScale, position.x),
      );
      const labelY = Math.min(
        canvasHeight - 5 * pixelScale,
        position.y + scaledRadius + 19 * pixelScale,
      );
      ctx.fillStyle = isSelected ? '#fef3c7' : 'rgba(255,255,255,0.93)';
      ctx.beginPath();
      ctx.roundRect(
        labelX - textWidth / 2 - 4 * pixelScale,
        labelY - 13 * pixelScale,
        textWidth + 8 * pixelScale,
        17 * pixelScale,
        3 * pixelScale,
      );
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillText(deviceLabel, labelX, labelY);
      ctx.restore();
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
    displayWidth,
    availableDevices,
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
    if (
      !Number.isInteger(newWidth) ||
      !Number.isInteger(newHeight) ||
      newWidth < 1 ||
      newHeight < 1 ||
      newWidth > 1024 ||
      newHeight > 1024 ||
      newWidth * newHeight > 1_000_000
    )
      return;
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
      deviceGroupFilter !== '' &&
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

      return normalizedDeviceSearch.length === 0 && deviceGroupFilter === '';
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

            {drawShapeControl}

            <details className="rounded-xl border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                Bulk actions
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="text-sm text-muted-foreground">
                  Fill the whole canvas with:
                </span>
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
            </details>
          </div>

          <p className="text-sm text-muted-foreground">
            Drag to paint with the selected tile; hold Shift to draw a straight
            line.
            {lineAnchor?.mode === 'tiles'
              ? ` The line starts at ${lineAnchor.cell.x + 1}, ${lineAnchor.cell.y + 1}.`
              : ''}
          </p>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium">
              How drawing works
            </summary>
            <p className="mt-2">
              Left click paints, right click temporarily erases back to floor,
              and the drag shape controls whether dragging draws freehand,
              straight lines, or filled rectangles. Shift previews a line from
              the last clicked cell to the cursor.
              {lineAnchor?.mode === 'tiles'
                ? ' Shift-click to draw the previewed line.'
                : ' Click a cell to set the anchor, then hold Shift and click another cell to connect them.'}
            </p>
          </details>
        </div>
      )}

      {mode === 'groups' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pick the room, then drag to paint its area.
            {lineAnchor?.mode === 'groups'
              ? ` The line starts at ${lineAnchor.cell.x + 1}, ${lineAnchor.cell.y + 1}.`
              : ' Hold Shift to draw a straight line.'}
          </p>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium">
              How room painting works
            </summary>
            <p className="mt-2">
              Click and drag to paint the selected group's area. Choose the
              Rectangle drag shape to fill room-like areas quickly. Right click
              temporarily erases, and holding Shift previews a line from the
              last clicked cell.
              {lineAnchor?.mode === 'groups'
                ? ' Shift-click to draw the previewed line.'
                : ' Click a cell to set the anchor, then hold Shift and click another cell to connect them.'}
            </p>
          </details>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="space-y-2 w-full max-w-sm">
              <span className="text-sm font-medium">Group</span>
              <SearchablePicker
                ariaLabel="Room to paint"
                clearable={false}
                value={selectedGroup ?? ''}
                onChange={setSelectedGroup}
                placeholder="Choose a room or group"
                options={sortedGroups.map((group) => ({
                  value: group.id,
                  label: group.name + (group.hidden ? ' (hidden)' : ''),
                  detail: group.id,
                }))}
              />
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
              <SettingsSelect
                aria-label="Placement device type"
                value={deviceTypeFilter}
                onValueChange={(value) =>
                  setDeviceTypeFilter(value as 'all' | FloorplanDeviceType)
                }
                options={[
                  { value: 'all', label: 'All devices' },
                  { value: 'controllable', label: 'Lights / devices' },
                  { value: 'sensor', label: 'Sensors' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </label>

            <label className="space-y-2 w-full max-w-xs">
              <span className="text-sm font-medium">Group</span>
              <SearchablePicker
                ariaLabel="Placement room filter"
                value={deviceGroupFilter}
                onChange={setDeviceGroupFilter}
                placeholder="All rooms & groups"
                options={sortedGroups.map((group) => ({
                  value: group.id,
                  label: group.name + (group.hidden ? ' (hidden)' : ''),
                  detail: group.id,
                }))}
              />
            </label>

            {(deviceSearch ||
              deviceTypeFilter !== 'all' ||
              deviceGroupFilter !== '') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div
              className="flex gap-1 border-b border-border bg-muted/30 p-1"
              role="group"
              aria-label="Device placements"
            >
              <Button
                variant={placementTab === 'unplaced' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={placementTab === 'unplaced'}
                onClick={() => setPlacementTab('unplaced')}
              >
                To place{' '}
                <span className="text-muted-foreground">
                  {unplacedDevices.length}
                </span>
              </Button>
              <Button
                variant={placementTab === 'placed' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={placementTab === 'placed'}
                onClick={() => setPlacementTab('placed')}
              >
                Placed{' '}
                <span className="text-muted-foreground">
                  {placedDevices.length}
                </span>
              </Button>
            </div>
            <div className="grid max-h-48 gap-1 overflow-y-auto p-1 sm:grid-cols-2 lg:grid-cols-3">
              {(placementTab === 'unplaced'
                ? unplacedDevices.map((d) => ({
                    deviceKey: d.key,
                    deviceName: d.name,
                  }))
                : placedDevices
              ).map((d) => {
                const placement = devices.find(
                  (p) => p.deviceKey === d.deviceKey,
                );
                const info = availableDeviceByKey[d.deviceKey];
                return (
                  <div
                    key={d.deviceKey}
                    className={`flex min-w-0 items-center rounded-md border ${selectedDevice === d.deviceKey ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted/50'}`}
                  >
                    <button
                      type="button"
                      aria-pressed={selectedDevice === d.deviceKey}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => {
                        setSelectedDevice(d.deviceKey);
                        if (placement)
                          setHoveredCell({ x: placement.x, y: placement.y });
                      }}
                    >
                      {info?.type === 'sensor' ? (
                        <Radio className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Lightbulb className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {d.deviceName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {placement
                            ? `Column ${placement.x + 1} · Row ${placement.y + 1}`
                            : 'Select, then place on canvas'}
                        </span>
                      </span>
                    </button>
                    {placement && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 rounded-md"
                        aria-label={`Remove placement for ${d.deviceName}`}
                        onClick={() => {
                          const currentGrid = cloneGrid(gridRef.current);
                          if (
                            applyDiscreteChange(
                              removeDeviceFromGrid(currentGrid, d.deviceKey),
                              currentGrid,
                            ) &&
                            selectedDevice === d.deviceKey
                          )
                            setSelectedDevice(null);
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {!(placementTab === 'unplaced' ? unplacedDevices : placedDevices)
                .length && (
                <p className="p-3 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                  {deviceSearch
                    ? 'No matching devices.'
                    : placementTab === 'unplaced'
                      ? 'All available devices are placed.'
                      : 'No devices placed yet.'}
                </p>
              )}
            </div>
          </div>
          {selectedDevice && (
            <p className="flex items-center gap-2 text-sm" role="status">
              <MapPin className="size-4 text-primary" />
              <span>
                <strong>
                  {availableDeviceByKey[selectedDevice]?.name ?? selectedDevice}
                </strong>{' '}
                · Tap a position on the canvas, or use arrow keys and Enter.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDevice(null)}
              >
                Cancel
              </Button>
            </p>
          )}
        </div>
      )}

      {/* Canvas */}
      <div
        className="flex flex-wrap items-center gap-2"
        aria-label="Canvas view controls"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setViewZoom(1);
            viewportRef.current?.scrollTo({ left: 0, top: 0 });
          }}
        >
          Fit
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={viewZoom <= 0.5}
          onClick={() => setViewZoom((zoom) => Math.max(0.5, zoom - 0.25))}
        >
          Zoom out
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={viewZoom >= 4}
          onClick={() => setViewZoom((zoom) => Math.min(4, zoom + 0.5))}
        >
          Zoom in
        </Button>
        <span className="text-xs text-muted-foreground">
          {Math.round(viewZoom * 100)}%
        </span>
        <Button
          variant={panning ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={panning}
          onClick={() => setPanning(!panning)}
        >
          Pan canvas
        </Button>
      </div>
      <div
        ref={viewportRef}
        className="h-[clamp(280px,65dvh,760px)] overflow-auto rounded-lg border border-border bg-muted/40 p-2"
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className={`${panning ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'} focus-visible:outline-2 focus-visible:outline-ring`}
          tabIndex={0}
          role="application"
          aria-label="Floorplan drawing canvas"
          aria-describedby="floorplan-canvas-help"
          style={{
            maxWidth: 'none',
            width: displayWidth,
            height: displayHeight,
            marginInline: 'auto',
            touchAction: panning ? 'pan-x pan-y' : 'none',
          }}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(event) => {
            if (!event.isPrimary || pointerGesture.current) return;
            if (panning) {
              if (event.pointerType === 'touch' || event.button !== 0) return;
              const viewport = event.currentTarget.parentElement!;
              panGesture.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left: viewport.scrollLeft,
                top: viewport.scrollTop,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
              return;
            }
            pointerGesture.current = {
              grid: cloneGrid(gridRef.current),
              undoLength: undoStackRef.current.length,
              pointerId: event.pointerId,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            handleMouseDown(event);
          }}
          onPointerMove={(event) => {
            const pan = panGesture.current;
            if (pan?.pointerId === event.pointerId) {
              const viewport = event.currentTarget.parentElement!;
              viewport.scrollLeft = pan.left + pan.x - event.clientX;
              viewport.scrollTop = pan.top + pan.y - event.clientY;
              return;
            }
            if (!panning && event.isPrimary) handleMouseMove(event);
          }}
          onPointerUp={(event) => {
            if (panGesture.current?.pointerId === event.pointerId) {
              panGesture.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              return;
            }
            if (pointerGesture.current?.pointerId !== event.pointerId) return;
            handleMouseUp();
            pointerGesture.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            panGesture.current = null;
            const gesture = pointerGesture.current;
            if (!gesture) return;
            pointerGesture.current = null;
            resetInteractionState();
            setUndoStack((stack) => stack.slice(0, gesture.undoLength));
            updateGrid(gesture.grid);
          }}
          onPointerCancel={() => {
            panGesture.current = null;
            const gesture = pointerGesture.current;
            if (!gesture) return;
            pointerGesture.current = null;
            resetInteractionState();
            setUndoStack((stack) => stack.slice(0, gesture.undoLength));
            updateGrid(gesture.grid);
          }}
          onPointerLeave={() => {
            if (!pointerGesture.current) handleMouseLeave();
          }}
          onKeyDown={(event) => {
            if (panning || event.ctrlKey || event.metaKey || event.altKey)
              return;
            const cell = hoveredCell ?? { x: 0, y: 0 };
            if (
              ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              setHoveredCell({
                x: Math.max(
                  0,
                  Math.min(
                    width - 1,
                    cell.x +
                      (event.key === 'ArrowRight'
                        ? 1
                        : event.key === 'ArrowLeft'
                          ? -1
                          : 0),
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    height - 1,
                    cell.y +
                      (event.key === 'ArrowDown'
                        ? 1
                        : event.key === 'ArrowUp'
                          ? -1
                          : 0),
                  ),
                ),
              });
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              const current = cloneGrid(gridRef.current);
              const next =
                mode === 'tiles'
                  ? applyTilePoints(current, [cell], selectedTool)
                  : mode === 'groups' && selectedGroup
                    ? applyGroupPoints(
                        current,
                        selectedGroup,
                        [cell],
                        groupPaintMode,
                      )
                    : mode === 'devices' && selectedDevice
                      ? placeSelectedDeviceOnGrid(
                          current,
                          selectedDevice,
                          availableDevices,
                          cell.x,
                          cell.y,
                        )
                      : null;
              applyDiscreteChange(next, current);
            }
          }}
        />
      </div>
      <p id="floorplan-canvas-help" className="text-xs text-muted-foreground">
        Draw or place items with a mouse or touch. With the canvas focused, use
        arrow keys to move between tiles and Enter to apply the selected tool.
        {hoveredCell &&
          ` Selected tile: ${hoveredCell.x + 1}, ${hoveredCell.y + 1}.`}
      </p>

      <details open className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Display and layout
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            canvas size, labels, scale, background
          </span>
        </summary>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Canvas size</span>
            <GridDimensionInput
              label="Floorplan width in tiles"
              value={width}
              max={Math.min(1024, Math.floor(1_000_000 / height))}
              onCommit={(value) => resizeGrid(value, height)}
            />
            <span>×</span>
            <GridDimensionInput
              label="Floorplan height in tiles"
              value={height}
              max={Math.min(1024, Math.floor(1_000_000 / width))}
              onCommit={(value) => resizeGrid(width, value)}
            />
            <span className="text-xs text-muted-foreground">
              tiles wide and tall; existing content moves with the canvas.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Grow towards</span>
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
          <FloorplanDeviceScaleControl
            value={grid.deviceScale}
            min={minFloorplanDeviceScale}
            max={maxFloorplanDeviceScale}
            onChange={updateDeviceScale}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            Device labels
            <SettingsSelect
              aria-label="Device labels"
              className="w-48"
              value={grid.labelMode ?? 'sensors'}
              onValueChange={(value) =>
                onChange({
                  ...grid,
                  labelMode: value as FloorplanGrid['labelMode'],
                })
              }
              options={[
                { value: 'none', label: 'Hidden' },
                { value: 'sensors', label: 'Sensors' },
                { value: 'lights', label: 'Lights' },
                { value: 'all', label: 'All devices' },
              ]}
            />
          </label>

          {backgroundImageUrl ? (
            <FloorplanBackgroundControls
              mode={mode}
              showGrid={showGrid}
              gridOpacity={gridOpacity}
              onShowGridChange={setShowGrid}
              onGridOpacityChange={setGridOpacity}
            />
          ) : null}
        </div>
      </details>

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
