import type { FloorplanGrid } from '@/ui/FloorplanGridEditor';

export type FloorplanRenderMetrics = {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
};

export type FloorplanPoint = {
  x: number;
  y: number;
};

export const getFloorplanRenderMetrics = (
  grid: FloorplanGrid | null,
  image?: HTMLImageElement,
): FloorplanRenderMetrics => {
  const width = image?.width ?? (grid ? grid.width * grid.tileSize : 0);
  const height = image?.height ?? (grid ? grid.height * grid.tileSize : 0);

  return {
    width,
    height,
    tileWidth: grid && grid.width > 0 ? width / grid.width : 0,
    tileHeight: grid && grid.height > 0 ? height / grid.height : 0,
  };
};

export const getFloorplanDevicePositions = (
  grid: FloorplanGrid | null,
  metrics: FloorplanRenderMetrics,
): Record<string, FloorplanPoint> => {
  if (!grid || metrics.tileWidth <= 0 || metrics.tileHeight <= 0) {
    return {};
  }

  return Object.fromEntries(
    grid.devices.map((device) => [
      device.deviceKey,
      {
        x: (device.x + 0.5) * metrics.tileWidth,
        y: (device.y + 0.5) * metrics.tileHeight,
      },
    ]),
  );
};

export const getFloorplanCellBounds = (
  index: number,
  totalCells: number,
  totalSize: number,
) => {
  const start = Math.round((index * totalSize) / totalCells);
  const end = Math.round(((index + 1) * totalSize) / totalCells);
  return {
    start,
    size: Math.max(1, end - start),
  };
};

export const getFloorplanCellIndex = (
  position: number,
  totalCells: number,
  totalSize: number,
): number | null => {
  if (totalCells <= 0 || totalSize <= 0) {
    return null;
  }

  const clampedPosition = Math.min(
    Math.max(position, 0),
    Math.max(totalSize - 1, 0),
  );

  for (let index = 0; index < totalCells; index += 1) {
    const { start, size } = getFloorplanCellBounds(
      index,
      totalCells,
      totalSize,
    );
    if (clampedPosition >= start && clampedPosition < start + size) {
      return index;
    }
  }

  return totalCells - 1;
};
