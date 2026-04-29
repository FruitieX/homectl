import { type Device } from '@/bindings/Device';
import { useImageState } from '@/hooks/useImageState';
import { type StoredFloorplan, useAllFloorplans } from '@/hooks/useStoredFloorplan';
import { getResolvedDeviceColorState } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import {
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/lib/floorplan-metrics';
import { type FloorplanGrid, type TileType } from '@/ui/FloorplanGridEditor';
import Color from 'color';
import { useEffect, useMemo, useRef } from 'react';

const stageWidth = 112;
const stageHeight = 96;
const previewPaddingFactor = 0.9;
const fallbackFloorplanWidth = 1500;
const fallbackFloorplanHeight = 1200;
const maxBasePreviewCacheEntries = 32;

const tileColors: Record<TileType, string> = {
  empty: 'rgba(0, 0, 0, 0)',
  floor: '#e2e8f0',
  wall: '#334155',
  door: '#92400e',
  window: '#60a5fa',
};

const basePreviewCache = new Map<string, HTMLCanvasElement>();
const gridIdentityCache = new WeakMap<FloorplanGrid, number>();
let nextGridIdentity = 1;

type Props = {
  devices: Device[];
  overrideColor?: Color;
};

type PreviewTransform = {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function getGridIdentity(grid: FloorplanGrid) {
  const cachedIdentity = gridIdentityCache.get(grid);
  if (cachedIdentity !== undefined) {
    return cachedIdentity;
  }

  const identity = nextGridIdentity;
  nextGridIdentity += 1;
  gridIdentityCache.set(grid, identity);
  return identity;
}

function setBasePreviewCache(cacheKey: string, canvas: HTMLCanvasElement) {
  if (!basePreviewCache.has(cacheKey)) {
    while (basePreviewCache.size >= maxBasePreviewCacheEntries) {
      const oldestCacheKey = basePreviewCache.keys().next().value;
      if (oldestCacheKey === undefined) {
        break;
      }
      basePreviewCache.delete(oldestCacheKey);
    }
  }

  basePreviewCache.set(cacheKey, canvas);
}

function getPreviewTransform(width: number, height: number): PreviewTransform {
  const floorplanWidth = width || fallbackFloorplanWidth;
  const floorplanHeight = height || fallbackFloorplanHeight;
  const scale =
    previewPaddingFactor *
    Math.min(stageWidth / floorplanWidth, stageHeight / floorplanHeight);

  return {
    scale,
    x: (stageWidth - floorplanWidth * scale) / 2,
    y: (stageHeight - floorplanHeight * scale) / 2,
    width: floorplanWidth,
    height: floorplanHeight,
  };
}

function getBasePreviewCacheKey(
  floorplan: StoredFloorplan,
  image: HTMLImageElement | undefined,
) {
  const gridKey = floorplan.grid ? getGridIdentity(floorplan.grid) : 'no-grid';
  const imageKey = image
    ? `${image.currentSrc || image.src}:${image.naturalWidth}x${image.naturalHeight}`
    : 'no-image';
  return `${floorplan.id}:${gridKey}:${imageKey}:${stageWidth}x${stageHeight}`;
}

function drawFloorplanBase(
  floorplan: StoredFloorplan,
  image: HTMLImageElement | undefined,
) {
  const cachedCanvas = basePreviewCache.get(
    getBasePreviewCacheKey(floorplan, image),
  );
  if (cachedCanvas) {
    return cachedCanvas;
  }

  const grid = floorplan.grid;
  const metrics = getFloorplanRenderMetrics(grid, image);
  const transform = getPreviewTransform(metrics.width, metrics.height);
  const canvas = document.createElement('canvas');
  canvas.width = stageWidth;
  canvas.height = stageHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }

  context.clearRect(0, 0, stageWidth, stageHeight);

  if (image) {
    context.drawImage(
      image,
      transform.x,
      transform.y,
      transform.width * transform.scale,
      transform.height * transform.scale,
    );
  }

  if (grid && metrics.tileWidth > 0 && metrics.tileHeight > 0) {
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const tile = grid.tiles[y]?.[x] ?? 'floor';
        if (tile === 'empty') {
          continue;
        }

        if (tile === 'floor' && image) {
          continue;
        }

        context.fillStyle = tileColors[tile];
        context.globalAlpha = tile === 'floor' ? 0.18 : 0.9;
        context.fillRect(
          transform.x + x * metrics.tileWidth * transform.scale,
          transform.y + y * metrics.tileHeight * transform.scale,
          Math.max(1, metrics.tileWidth * transform.scale),
          Math.max(1, metrics.tileHeight * transform.scale),
        );
      }
    }
  }

  context.globalAlpha = 1;
  setBasePreviewCache(getBasePreviewCacheKey(floorplan, image), canvas);
  return canvas;
}

function getDeviceColor(device: Device, overrideColor?: Color) {
  if (overrideColor) {
    return { brightness: 1, color: overrideColor, power: true };
  }

  const resolved = getResolvedDeviceColorState(device.data);
  return {
    brightness: resolved?.brightness ?? 0,
    color: resolved?.color ?? Color('black'),
    power: resolved?.power ?? false,
  };
}

function drawControllableDevice(
  context: CanvasRenderingContext2D,
  device: Device,
  x: number,
  y: number,
  scale: number,
  deviceScale: number,
  overrideColor?: Color,
) {
  const { brightness, color, power } = getDeviceColor(device, overrideColor);
  const gradientRadius = (100 + 200 * brightness) * deviceScale * scale;

  if (power && brightness > 0 && gradientRadius > 0) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, gradientRadius);
    gradient.addColorStop(0, color.alpha(0.2).rgb().string());
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, gradientRadius, 0, Math.PI * 2);
    context.fill();
  }

  const markerColor = power ? color : Color('black');
  const radius = Math.max(2, 20 * deviceScale * scale);
  context.fillStyle = markerColor
    .desaturate(0.4)
    .darken(0.5 - brightness / 2)
    .rgb()
    .string();
  context.strokeStyle = '#111827';
  context.lineWidth = Math.max(1, 4 * deviceScale * scale);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawSensorDevice(
  context: CanvasRenderingContext2D,
  device: Device,
  x: number,
  y: number,
  scale: number,
  deviceScale: number,
  overrideColor?: Color,
) {
  const radius = Math.max(2, 16 * deviceScale * scale);
  const sensor = 'Sensor' in device.data ? device.data.Sensor : null;
  const active = Boolean(sensor && 'value' in sensor && sensor.value === true);

  context.fillStyle = overrideColor?.rgb().string() ?? (active ? '#22c55e' : '#38bdf8');
  context.strokeStyle = '#0f172a';
  context.lineWidth = Math.max(1, 2 * deviceScale * scale);
  context.beginPath();
  context.moveTo(x, y - radius);
  context.lineTo(x + radius, y + radius);
  context.lineTo(x - radius, y + radius);
  context.closePath();
  context.fill();
  context.stroke();
}

function drawPreviewDevices(
  context: CanvasRenderingContext2D,
  floorplan: StoredFloorplan,
  image: HTMLImageElement | undefined,
  devices: Device[],
  overrideColor?: Color,
) {
  const grid = floorplan.grid;
  if (!grid) {
    return;
  }

  const metrics = getFloorplanRenderMetrics(grid, image);
  const transform = getPreviewTransform(metrics.width, metrics.height);
  const positions = getFloorplanDevicePositions(grid, metrics);
  const deviceScale = grid.deviceScale ?? 1;

  for (const device of devices) {
    const position = positions[getDeviceKey(device)];
    if (!position) {
      continue;
    }

    const x = transform.x + position.x * transform.scale;
    const y = transform.y + position.y * transform.scale;

    if ('Controllable' in device.data) {
      drawControllableDevice(
        context,
        device,
        x,
        y,
        transform.scale,
        deviceScale,
        overrideColor,
      );
      continue;
    }

    drawSensorDevice(
      context,
      device,
      x,
      y,
      transform.scale,
      deviceScale,
      overrideColor,
    );
  }
}

export const Preview = (props: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { floorplans } = useAllFloorplans();

  // Pick the floorplan that places the most of this group's devices. Falls
  // back to the first floorplan if no floorplan has any of these devices
  // (e.g. brand-new group).
  const deviceKeys = useMemo(
    () => new Set(props.devices.map((device) => getDeviceKey(device))),
    [props.devices],
  );
  const selectedFloorplan = useMemo(() => {
    if (floorplans.length === 0) {
      return null;
    }

    let best = floorplans[0];
    let bestScore = -1;
    for (const floorplan of floorplans) {
      const score =
        floorplan.grid?.devices.filter((device) =>
          deviceKeys.has(device.deviceKey),
        ).length ?? 0;
      if (score > bestScore) {
        best = floorplan;
        bestScore = score;
      }
    }

    return best;
  }, [deviceKeys, floorplans]);

  const floorplanImage = useImageState(selectedFloorplan?.imageUrl);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedFloorplan) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const baseCanvas = drawFloorplanBase(selectedFloorplan, floorplanImage);
    context.clearRect(0, 0, stageWidth, stageHeight);
    context.drawImage(baseCanvas, 0, 0);
    drawPreviewDevices(
      context,
      selectedFloorplan,
      floorplanImage,
      props.devices,
      props.overrideColor,
    );
  }, [floorplanImage, props.devices, props.overrideColor, selectedFloorplan]);

  if (!selectedFloorplan) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      width={stageWidth}
      height={stageHeight}
      className="h-full w-full"
    />
  );
};

export default Preview;
