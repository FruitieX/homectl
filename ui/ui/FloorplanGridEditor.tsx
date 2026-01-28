'use client';

import { useCallback, useState, useRef, useEffect } from 'react';

export type TileType = 'floor' | 'wall' | 'door' | 'window';

export interface DevicePosition {
  deviceKey: string;
  deviceName: string;
  x: number;
  y: number;
}

export interface FloorplanGrid {
  width: number;
  height: number;
  tiles: TileType[][];
  tileSize: number;
  devices: DevicePosition[];
}

interface FloorplanGridEditorProps {
  grid: FloorplanGrid;
  onChange: (grid: FloorplanGrid) => void;
  availableDevices?: { key: string; name: string }[];
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

type EditorMode = 'tiles' | 'devices' | 'image';

export function FloorplanGridEditor({ grid, onChange, availableDevices = [], backgroundImageUrl }: FloorplanGridEditorProps) {
  const [selectedTool, setSelectedTool] = useState<TileType>('wall');
  const [mode, setMode] = useState<EditorMode>(backgroundImageUrl ? 'image' : 'tiles');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [draggingDevice, setDraggingDevice] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [gridOpacity, setGridOpacity] = useState(0.3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

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

  const { width, height, tiles, tileSize, devices } = grid;
  const canvasWidth = width * tileSize;
  const canvasHeight = height * tileSize;

  // Draw the grid
  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw background image if in image mode
    if (imageRef.current && mode === 'image') {
      ctx.drawImage(imageRef.current, 0, 0, canvasWidth, canvasHeight);
    }

    // Draw tiles (with opacity in image mode)
    const shouldDrawTiles = mode !== 'image' || showGrid;
    if (shouldDrawTiles) {
      ctx.globalAlpha = mode === 'image' ? gridOpacity : 1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[y]?.[x] || 'floor';
          if (mode === 'image' && tile === 'floor') {
            // In image mode, only draw non-floor tiles
            continue;
          }
          ctx.fillStyle = tileColors[tile];
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Draw grid lines
    ctx.strokeStyle = mode === 'image' ? 'rgba(156, 163, 175, 0.3)' : '#9ca3af';
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
  }, [width, height, tiles, tileSize, canvasWidth, canvasHeight, devices, selectedDevice, draggingDevice, mode, showGrid, gridOpacity]);

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

  // Paint a tile
  const paintTile = useCallback(
    (x: number, y: number) => {
      const newTiles = tiles.map((row, rowY) =>
        row.map((tile, colX) => (rowY === y && colX === x ? selectedTool : tile)),
      );
      onChange({ ...grid, tiles: newTiles });
    },
    [grid, tiles, selectedTool, onChange],
  );

  // Place or move device
  const placeDevice = useCallback(
    (x: number, y: number) => {
      if (draggingDevice) {
        // Move existing device
        const newDevices = devices.map((d) =>
          d.deviceKey === draggingDevice ? { ...d, x, y } : d,
        );
        onChange({ ...grid, devices: newDevices });
      } else if (selectedDevice) {
        // Check if device already placed
        const existing = devices.find((d) => d.deviceKey === selectedDevice);
        if (existing) {
          // Move it
          const newDevices = devices.map((d) =>
            d.deviceKey === selectedDevice ? { ...d, x, y } : d,
          );
          onChange({ ...grid, devices: newDevices });
        } else {
          // Place new device
          const deviceInfo = availableDevices.find((d) => d.key === selectedDevice);
          if (deviceInfo) {
            const newDevices = [
              ...devices,
              { deviceKey: deviceInfo.key, deviceName: deviceInfo.name, x, y },
            ];
            onChange({ ...grid, devices: newDevices });
          }
        }
      }
    },
    [grid, devices, selectedDevice, draggingDevice, availableDevices, onChange],
  );

  // Remove device
  const removeDevice = useCallback(
    (deviceKey: string) => {
      const newDevices = devices.filter((d) => d.deviceKey !== deviceKey);
      onChange({ ...grid, devices: newDevices });
    },
    [grid, devices, onChange],
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getTileCoords(e);
    if (!coords) return;

    if (mode === 'tiles') {
      setIsPainting(true);
      paintTile(coords.x, coords.y);
    } else {
      // Device or Image mode - check if clicking on existing device
      const deviceAtPos = findDeviceAt(coords.x, coords.y);
      if (deviceAtPos) {
        setDraggingDevice(deviceAtPos.deviceKey);
        setSelectedDevice(deviceAtPos.deviceKey);
      } else if (selectedDevice) {
        placeDevice(coords.x, coords.y);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getTileCoords(e);
    if (!coords) return;

    if (mode === 'tiles' && isPainting) {
      paintTile(coords.x, coords.y);
    } else if ((mode === 'devices' || mode === 'image') && draggingDevice) {
      placeDevice(coords.x, coords.y);
    }
  };

  const handleMouseUp = () => {
    setIsPainting(false);
    setDraggingDevice(null);
  };

  const handleMouseLeave = () => {
    setIsPainting(false);
    setDraggingDevice(null);
  };

  // Fill all tiles with selected type
  const fillAll = (type: TileType) => {
    const newTiles = tiles.map((row) => row.map(() => type));
    onChange({ ...grid, tiles: newTiles });
  };

  // Resize grid
  const resizeGrid = (newWidth: number, newHeight: number) => {
    const newTiles: TileType[][] = [];
    for (let y = 0; y < newHeight; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < newWidth; x++) {
        row.push(tiles[y]?.[x] || 'floor');
      }
      newTiles.push(row);
    }
    // Remove devices outside new bounds
    const newDevices = devices.filter((d) => d.x < newWidth && d.y < newHeight);
    onChange({ ...grid, width: newWidth, height: newHeight, tiles: newTiles, devices: newDevices });
  };

  // Devices not yet placed
  const unplacedDevices = availableDevices.filter(
    (d) => !devices.find((placed) => placed.deviceKey === d.key),
  );

  return (
    <div className="space-y-4">
      {/* Mode selector */}
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
        {backgroundImageUrl && (
          <button
            className={`tab ${mode === 'image' ? 'tab-active' : ''}`}
            onClick={() => setMode('image')}
          >
            Image + Devices
          </button>
        )}
      </div>

      {/* Image mode controls */}
      {mode === 'image' && (
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
            Click to place devices on your floorplan image
          </div>
        </div>
      )}

      {/* Tile toolbar */}
      {mode === 'tiles' && (
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
      )}

      {/* Device toolbar */}
      {(mode === 'devices' || mode === 'image') && (
        <div className="space-y-2">
          {mode === 'devices' && (
            <div className="text-sm opacity-70">
              Select a device below, then click on the grid to place it. Drag placed devices to move them.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {unplacedDevices.slice(0, 20).map((device) => (
              <button
                key={device.key}
                className={`btn btn-sm ${selectedDevice === device.key ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setSelectedDevice(device.key)}
              >
                {device.name}
              </button>
            ))}
            {unplacedDevices.length > 20 && (
              <span className="text-sm opacity-70">+{unplacedDevices.length - 20} more</span>
            )}
            {unplacedDevices.length === 0 && availableDevices.length > 0 && (
              <span className="text-sm opacity-70">All devices placed</span>
            )}
          </div>
          {devices.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-base-300">
              <span className="text-sm opacity-70">Placed:</span>
              {devices.map((d) => (
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
                      removeDevice(d.deviceKey);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
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
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      row.push('floor');
    }
    tiles.push(row);
  }
  return { width, height, tiles, tileSize, devices: [] };
}

// Serialize grid to JSON string
export function serializeGrid(grid: FloorplanGrid): string {
  return JSON.stringify(grid);
}

// Deserialize grid from JSON string
export function deserializeGrid(json: string): FloorplanGrid | null {
  try {
    return JSON.parse(json) as FloorplanGrid;
  } catch {
    return null;
  }
}
