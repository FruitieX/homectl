'use client';

import { getFloorplanGroupFill, getFloorplanGroupStroke } from '@/lib/floorplanGroupColor';
import { useCallback, useState, useRef, useEffect } from 'react';

export type TileType = 'floor' | 'wall' | 'door' | 'window';

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
  floor: '#e5e7eb',    // gray-200
  wall: '#374151',     // gray-700
  door: '#92400e',     // amber-800
  window: '#60a5fa',   // blue-400
};

const tileLabels: Record<TileType, string> = {
  floor: 'Floor',
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
};

const getCellKey = (x: number, y: number) => `${x},${y}`;

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
    .map(([groupId, points]) => [groupId, normalizeGroupPoints(points, width, height)] as const)
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

const cloneGrid = (grid: FloorplanGrid): FloorplanGrid => ({
  width: grid.width,
  height: grid.height,
  tileSize: grid.tileSize,
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

const applyTilePoints = (
  sourceGrid: FloorplanGrid,
  points: GridPoint[],
  tile: TileType,
): FloorplanGrid | null => {
  const targetPoints = new Set(points.map((point) => getCellKey(point.x, point.y)));
  let changed = false;

  const nextTiles = sourceGrid.tiles.map((row, rowIndex) =>
    row.map((currentTile, columnIndex) => {
      if (!targetPoints.has(getCellKey(columnIndex, rowIndex)) || currentTile === tile) {
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
  const device = sourceGrid.devices.find((candidate) => candidate.deviceKey === deviceKey);
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

  const deviceInfo = availableDevices.find((device) => device.key === selectedDevice);
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
    devices: sourceGrid.devices.filter((device) => device.deviceKey !== deviceKey),
  };
};

const resizeGridState = (
  sourceGrid: FloorplanGrid,
  newWidth: number,
  newHeight: number,
): FloorplanGrid | null => {
  if (newWidth === sourceGrid.width && newHeight === sourceGrid.height) {
    return null;
  }

  const newTiles: TileType[][] = [];
  for (let y = 0; y < newHeight; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < newWidth; x++) {
      row.push(sourceGrid.tiles[y]?.[x] || 'floor');
    }
    newTiles.push(row);
  }

  const newDevices = sourceGrid.devices.filter(
    (device) => device.x < newWidth && device.y < newHeight,
  );
  const newGroups = Object.fromEntries(
    Object.entries(sourceGrid.groups)
      .map(([groupId, points]) => [
        groupId,
        normalizeGroupPoints(points, newWidth, newHeight),
      ] as const)
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

type ActiveOperation =
  | {
      kind: 'tiles';
      baseGrid: FloorplanGrid;
      startCell: GridPoint;
      tile: TileType;
      straightLine: boolean;
      lastCellKey: string;
    }
  | {
      kind: 'groups';
      baseGrid: FloorplanGrid;
      startCell: GridPoint;
      groupId: string;
      paintMode: GroupPaintMode;
      straightLine: boolean;
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

type EditorMode = 'tiles' | 'devices' | 'groups' | 'image';

export function FloorplanGridEditor({
  grid,
  onChange,
  availableDevices = [],
  availableGroups = [],
  backgroundImageUrl,
}: FloorplanGridEditorProps) {
  const [selectedTool, setSelectedTool] = useState<TileType>('wall');
  const [mode, setMode] = useState<EditorMode>(backgroundImageUrl ? 'image' : 'tiles');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupPaintMode, setGroupPaintMode] = useState<GroupPaintMode>('paint');
  const [isPainting, setIsPainting] = useState(false);
  const [draggingDevice, setDraggingDevice] = useState<string | null>(null);
  const [straightLineMode, setStraightLineMode] = useState(false);
  const [undoStack, setUndoStack] = useState<FloorplanGrid[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [gridOpacity, setGridOpacity] = useState(0.3);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<'all' | FloorplanDeviceType>('all');
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('all');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const gridRef = useRef(grid);
  const undoStackRef = useRef<FloorplanGrid[]>([]);
  const activeOperationRef = useRef<ActiveOperation | null>(null);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  // Load background image
  useEffect(() => {
    if (backgroundImageUrl) {
      const img = new Image();
      img.src = backgroundImageUrl;
      img.onload = () => {
        imageRef.current = img;
        drawGrid();
      };
    } else {
      imageRef.current = null;
    }
  }, [backgroundImageUrl]);

  const { width, height, tiles, tileSize, devices, groups } = grid;
  const canvasWidth = width * tileSize;
  const canvasHeight = height * tileSize;
  const sortedGroups = [...availableGroups].sort((left, right) => {
    const hiddenDelta = Number(Boolean(left.hidden)) - Number(Boolean(right.hidden));
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

      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) {
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

    const overlayMode = Boolean(imageRef.current) && (mode === 'image' || mode === 'groups');

    // Draw background image if available in an overlay-based mode.
    if (imageRef.current && overlayMode) {
      ctx.drawImage(imageRef.current, 0, 0, canvasWidth, canvasHeight);
    }

    // Draw tiles (with opacity in overlay-based modes)
    const shouldDrawTiles = !overlayMode || showGrid;
    if (shouldDrawTiles) {
      ctx.globalAlpha = overlayMode ? gridOpacity : 1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[y]?.[x] || 'floor';
          if (overlayMode && tile === 'floor') {
            // In image mode, only draw non-floor tiles
            continue;
          }
          ctx.fillStyle = tileColors[tile];
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
      ctx.globalAlpha = 1;
    }

    if (mode === 'groups') {
      for (const [groupId, points] of Object.entries(groups)) {
        const isSelected = groupId === selectedGroup;
        const fill = getFloorplanGroupFill(groupId, isSelected ? 0.45 : 0.2);
        const stroke = getFloorplanGroupStroke(groupId, isSelected ? 0.95 : 0.35);

        for (const point of points) {
          const drawX = point.x * tileSize;
          const drawY = point.y * tileSize;
          ctx.fillStyle = fill;
          ctx.fillRect(drawX, drawY, tileSize, tileSize);

          if (isSelected) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.strokeRect(drawX + 0.5, drawY + 0.5, tileSize - 1, tileSize - 1);
          }
        }
      }
    }

    // Draw grid lines
    ctx.strokeStyle = overlayMode ? 'rgba(156, 163, 175, 0.3)' : '#9ca3af';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }

    // Draw devices
    devices.forEach((device) => {
      const isSelected = selectedDevice === device.deviceKey || draggingDevice === device.deviceKey;
      
      // Device circle
      ctx.beginPath();
      ctx.arc(
        device.x * tileSize + tileSize / 2,
        device.y * tileSize + tileSize / 2,
        tileSize / 3,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = isSelected ? '#f59e0b' : '#10b981';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#d97706' : '#059669';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Device label
      ctx.fillStyle = '#000';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const labelY = device.y * tileSize + tileSize + 12;
      if (labelY < canvasHeight) {
        ctx.fillText(
          device.deviceName.slice(0, 10),
          device.x * tileSize + tileSize / 2,
          labelY,
        );
      }
    });
  }, [
    width,
    height,
    tiles,
    tileSize,
    canvasWidth,
    canvasHeight,
    devices,
    groups,
    selectedDevice,
    draggingDevice,
    selectedGroup,
    mode,
    showGrid,
    gridOpacity,
  ]);

  useEffect(() => {
    drawGrid();
  }, [drawGrid]);

  // Get tile coordinates from mouse event
  const getTileCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor(((e.clientX - rect.left) * scaleX) / tileSize);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / tileSize);

    if (x >= 0 && x < width && y >= 0 && y < height) {
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

    const currentGrid = cloneGrid(gridRef.current);
    const straightLine = straightLineMode || e.shiftKey;

    if (mode === 'tiles') {
      const tile = e.button === 2 ? 'floor' : selectedTool;
      const nextGrid = applyTilePoints(currentGrid, [coords], tile);
      if (!nextGrid) {
        return;
      }

      pushUndoSnapshot(currentGrid);
      activeOperationRef.current = {
        kind: 'tiles',
        baseGrid: currentGrid,
        startCell: coords,
        tile,
        straightLine,
        lastCellKey: getCellKey(coords.x, coords.y),
      };
      setIsPainting(true);
      updateGrid(nextGrid);
    } else if (mode === 'groups') {
      if (!selectedGroup) {
        return;
      }

      const paintMode = e.button === 2 ? 'erase' : groupPaintMode;
      const nextGrid = applyGroupPoints(currentGrid, selectedGroup, [coords], paintMode);
      if (!nextGrid) {
        return;
      }

      pushUndoSnapshot(currentGrid);
      activeOperationRef.current = {
        kind: 'groups',
        baseGrid: currentGrid,
        startCell: coords,
        groupId: selectedGroup,
        paintMode,
        straightLine,
        lastCellKey: getCellKey(coords.x, coords.y),
      };
      setIsPainting(true);
      updateGrid(nextGrid);
    } else {
      const deviceAtPos = findDeviceAt(coords.x, coords.y);
      if (e.button === 2) {
        if (!deviceAtPos) {
          return;
        }

        applyDiscreteChange(removeDeviceFromGrid(currentGrid, deviceAtPos.deviceKey), currentGrid);
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

    const pointKey = getCellKey(coords.x, coords.y);
    const activeOperation = activeOperationRef.current;
    if (!activeOperation || activeOperation.lastCellKey === pointKey) {
      return;
    }

    if (activeOperation.kind === 'tiles' && isPainting) {
      const points = activeOperation.straightLine
        ? getLinePoints(activeOperation.startCell, coords)
        : [coords];
      const sourceGrid = activeOperation.straightLine
        ? activeOperation.baseGrid
        : gridRef.current;
      const nextGrid = applyTilePoints(sourceGrid, points, activeOperation.tile);
      if (!nextGrid) {
        return;
      }

      activeOperationRef.current = { ...activeOperation, lastCellKey: pointKey };
      updateGrid(nextGrid);
    } else if (activeOperation.kind === 'groups' && isPainting) {
      const points = activeOperation.straightLine
        ? getLinePoints(activeOperation.startCell, coords)
        : [coords];
      const sourceGrid = activeOperation.straightLine
        ? activeOperation.baseGrid
        : gridRef.current;
      const nextGrid = applyGroupPoints(
        sourceGrid,
        activeOperation.groupId,
        points,
        activeOperation.paintMode,
      );
      if (!nextGrid) {
        return;
      }

      activeOperationRef.current = { ...activeOperation, lastCellKey: pointKey };
      updateGrid(nextGrid);
    } else if (
      activeOperation.kind === 'devices' &&
      (mode === 'devices' || mode === 'image') &&
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
    resetInteractionState();
  };

  const handleMouseLeave = () => {
    resetInteractionState();
  };

  // Fill all tiles with selected type
  const fillAll = (type: TileType) => {
    const currentGrid = cloneGrid(gridRef.current);
    applyDiscreteChange(
      { ...currentGrid, tiles: currentGrid.tiles.map((row) => row.map(() => type)) },
      currentGrid,
    );
  };

  // Resize grid
  const resizeGrid = (newWidth: number, newHeight: number) => {
    const currentGrid = cloneGrid(gridRef.current);
    applyDiscreteChange(resizeGridState(currentGrid, newWidth, newHeight), currentGrid);
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

    if (deviceGroupFilter !== 'all' && !device.groupIds.includes(deviceGroupFilter)) {
      return false;
    }

    if (!normalizedDeviceSearch) {
      return true;
    }

    const haystack = `${device.name} ${device.key}`.toLowerCase();
    return haystack.includes(normalizedDeviceSearch);
  };
  const filteredAvailableDevices = availableDevices.filter(matchesDeviceFilters);
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

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs tabs-boxed w-fit">
          <button
            className={`tab ${mode === 'tiles' ? 'tab-active' : ''}`}
            onClick={() => setMode('tiles')}
          >
            Draw Walls
          </button>
          <button
            className={`tab ${mode === 'devices' ? 'tab-active' : ''}`}
            onClick={() => setMode('devices')}
          >
            Place Devices
          </button>
          <button
            className={`tab ${mode === 'groups' ? 'tab-active' : ''}`}
            onClick={() => setMode('groups')}
          >
            Paint Groups
          </button>
          {backgroundImageUrl && (
            <button
              className={`tab ${mode === 'image' ? 'tab-active' : ''}`}
              onClick={() => setMode('image')}
            >
              Image + Devices
            </button>
          )}
        </div>

        <button
          className="btn btn-sm btn-outline"
          disabled={undoStack.length === 0}
          onClick={handleUndo}
        >
          Undo
          <span className="text-xs opacity-70">Ctrl/Cmd+Z</span>
        </button>
      </div>

      {/* Image mode controls */}
      {backgroundImageUrl && (mode === 'image' || mode === 'groups') && (
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
            />
            <span className="text-sm">Show walls overlay</span>
          </label>
          {showGrid && (
            <label className="flex items-center gap-2">
              <span className="text-sm">Opacity:</span>
              <input
                type="range"
                className="range range-sm w-24"
                min={0.1}
                max={1}
                step={0.1}
                value={gridOpacity}
                onChange={(e) => setGridOpacity(parseFloat(e.target.value))}
              />
            </label>
          )}
          <div className="text-sm opacity-70">
            {mode === 'groups'
              ? 'Paint group areas directly on the grid overlay'
              : 'Click to place devices on your floorplan image'}
          </div>
        </div>
      )}

      {/* Tile toolbar */}
      {mode === 'tiles' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="join">
              {(Object.keys(tileColors) as TileType[]).map((type) => (
                <button
                  key={type}
                  className={`btn btn-sm join-item ${selectedTool === type ? 'btn-primary' : ''}`}
                  onClick={() => setSelectedTool(type)}
                >
                  <span
                    className="w-4 h-4 rounded border border-base-300"
                    style={{ backgroundColor: tileColors[type] }}
                  />
                  {tileLabels[type]}
                </button>
              ))}
            </div>

            <div className="divider divider-horizontal m-0"></div>

            <div className="flex gap-2 items-center">
              <span className="text-sm">Size:</span>
              <input
                type="number"
                className="input input-sm input-bordered w-16"
                value={width}
                onChange={(e) => resizeGrid(parseInt(e.target.value) || 10, height)}
                min={5}
                max={100}
              />
              <span>×</span>
              <input
                type="number"
                className="input input-sm input-bordered w-16"
                value={height}
                onChange={(e) => resizeGrid(width, parseInt(e.target.value) || 10)}
                min={5}
                max={100}
              />
            </div>

            <label className="label cursor-pointer gap-2">
              <span className="label-text text-sm">Straight lines (Shift)</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={straightLineMode}
                onChange={(e) => setStraightLineMode(e.target.checked)}
              />
            </label>

            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-sm btn-ghost">
                Fill All
              </div>
              <ul
                tabIndex={0}
                className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-32"
              >
                {(Object.keys(tileColors) as TileType[]).map((type) => (
                  <li key={type}>
                    <button onClick={() => fillAll(type)}>{tileLabels[type]}</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="text-sm opacity-70">
            Left click paints, right click temporarily erases back to floor, and straight-line mode also works by holding Shift.
          </div>
        </div>
      )}

      {mode === 'groups' && (
        <div className="space-y-3">
          <div className="text-sm opacity-70">
            Select a group, then click and drag to paint its area. Right click temporarily erases, and straight lines also work by holding Shift.
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="form-control w-full max-w-sm">
              <span className="label-text text-sm">Group</span>
              <select
                className="select select-bordered select-sm"
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

            <div className="join">
              <button
                className={`btn btn-sm join-item ${groupPaintMode === 'paint' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setGroupPaintMode('paint')}
              >
                Paint
              </button>
              <button
                className={`btn btn-sm join-item ${groupPaintMode === 'erase' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setGroupPaintMode('erase')}
              >
                Erase
              </button>
            </div>

            <label className="label cursor-pointer gap-2">
              <span className="label-text text-sm">Straight lines (Shift)</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={straightLineMode}
                onChange={(e) => setStraightLineMode(e.target.checked)}
              />
            </label>

            <button
              className="btn btn-sm btn-ghost"
              disabled={!selectedGroup || !(groups[selectedGroup]?.length)}
              onClick={() => {
                if (!selectedGroup) {
                  return;
                }

                const currentGrid = cloneGrid(gridRef.current);
                const nextGroups = { ...currentGrid.groups };
                delete nextGroups[selectedGroup];
                applyDiscreteChange({ ...currentGrid, groups: nextGroups }, currentGrid);
              }}
            >
              Clear Group
            </button>
          </div>

          {Object.keys(groups).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-base-300">
              {Object.entries(groups).map(([groupId, points]) => {
                const info = sortedGroups.find((group) => group.id === groupId);
                return (
                  <button
                    key={groupId}
                    className={`badge badge-lg gap-2 px-3 py-3 border ${selectedGroup === groupId ? 'badge-primary' : 'badge-outline'}`}
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
                    <span className="opacity-70">{points.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Device toolbar */}
      {(mode === 'devices' || mode === 'image') && (
        <div className="space-y-3">
          {mode === 'devices' && (
            <div className="text-sm opacity-70">
              Select a device below, then click on the grid to place it. Drag placed devices to move them.
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-end">
            <label className="form-control w-full max-w-xs">
              <span className="label-text text-sm">Search</span>
              <input
                type="text"
                className="input input-bordered input-sm"
                placeholder="Search by name or id"
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
              />
            </label>

            <label className="form-control w-full max-w-[12rem]">
              <span className="label-text text-sm">Type</span>
              <select
                className="select select-bordered select-sm"
                value={deviceTypeFilter}
                onChange={(e) =>
                  setDeviceTypeFilter(e.target.value as 'all' | FloorplanDeviceType)
                }
              >
                <option value="all">All devices</option>
                <option value="controllable">Lights / devices</option>
                <option value="sensor">Sensors</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="form-control w-full max-w-xs">
              <span className="label-text text-sm">Group</span>
              <select
                className="select select-bordered select-sm"
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

            {(deviceSearch || deviceTypeFilter !== 'all' || deviceGroupFilter !== 'all') && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="text-sm opacity-70">
            Matching devices: {filteredAvailableDevices.length} total · {unplacedDevices.length} unplaced · {placedDevices.length} placed
          </div>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-base-300 bg-base-100/40 p-2">
            <div className="flex flex-wrap gap-2">
              {unplacedDevices.map((device) => (
                <button
                  key={device.key}
                  className={`btn btn-sm ${selectedDevice === device.key ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setSelectedDevice(device.key)}
                >
                  {device.name}
                </button>
              ))}
              {unplacedDevices.length === 0 && availableDevices.length > 0 && (
                <span className="text-sm opacity-70 px-1 py-2">
                  {filteredAvailableDevices.length === 0
                    ? 'No devices match the current filters.'
                    : 'All matching devices are already placed.'}
                </span>
              )}
              {availableDevices.length === 0 && (
                <span className="text-sm opacity-70 px-1 py-2">No devices available.</span>
              )}
            </div>
          </div>
          {devices.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-base-300">
              <span className="text-sm opacity-70">Placed:</span>
              {placedDevices.map((d) => (
                <div
                  key={d.deviceKey}
                  className={`badge badge-lg gap-1 cursor-pointer ${selectedDevice === d.deviceKey ? 'badge-primary' : ''}`}
                  onClick={() => setSelectedDevice(d.deviceKey)}
                >
                  {d.deviceName}
                  <button
                    className="btn btn-xs btn-ghost btn-circle"
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentGrid = cloneGrid(gridRef.current);
                      const nextGrid = removeDeviceFromGrid(currentGrid, d.deviceKey);
                      if (applyDiscreteChange(nextGrid, currentGrid) && selectedDevice === d.deviceKey) {
                        setSelectedDevice(null);
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {placedDevices.length === 0 && (
                <span className="text-sm opacity-70">No placed devices match the current filters.</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Canvas */}
      <div className="overflow-auto border border-base-300 rounded-lg bg-base-300 p-2">
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

      {/* Legend */}
      <div className="flex gap-4 text-sm flex-wrap">
        {(Object.keys(tileColors) as TileType[]).map((type) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="w-4 h-4 rounded border border-base-300"
              style={{ backgroundColor: tileColors[type] }}
            />
            <span className="opacity-70">{tileLabels[type]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 rounded-full bg-emerald-500"></span>
          <span className="opacity-70">Device</span>
        </div>
      </div>
    </div>
  );
}

// Create an empty grid
export function createEmptyGrid(
  width: number = 20,
  height: number = 15,
  tileSize: number = 24,
): FloorplanGrid {
  return { width, height, tiles: buildEmptyTiles(width, height), tileSize, devices: [], groups: {} };
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

    const width = typeof parsed.width === 'number' && parsed.width > 0 ? parsed.width : 20;
    const height = typeof parsed.height === 'number' && parsed.height > 0 ? parsed.height : 15;
    const tileSize =
      typeof parsed.tileSize === 'number' && parsed.tileSize > 0 ? parsed.tileSize : 24;

    const tiles = Array.isArray(parsed.tiles)
      ? buildEmptyTiles(width, height).map((row, rowIndex) =>
          row.map((_, columnIndex) => {
            const tile = parsed.tiles?.[rowIndex]?.[columnIndex];
            return tile === 'wall' || tile === 'door' || tile === 'window' || tile === 'floor'
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
      devices,
      groups: normalizeGroupMasks(parsed.groups, width, height),
    };
  } catch {
    return null;
  }
}
