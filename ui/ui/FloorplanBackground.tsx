'use client';

import { Image as KonvaImage } from 'react-konva';
import { useMemo } from 'react';
import type { FloorplanGrid, TileType } from '@/ui/FloorplanGridEditor';

const tileColors: Record<TileType, string> = {
  floor: 'transparent',
  wall: '#374151',
  door: '#92400e',
  window: '#60a5fa',
};

export type FloorplanRenderMetrics = {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
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

type ViewportPoint = {
  x: number;
  y: number;
};

export const getFloorplanDevicePositions = (
  grid: FloorplanGrid | null,
  metrics: FloorplanRenderMetrics,
): Record<string, ViewportPoint> => {
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

const getCellBounds = (index: number, totalCells: number, totalSize: number) => {
  const start = Math.round((index * totalSize) / totalCells);
  const end = Math.round(((index + 1) * totalSize) / totalCells);
  return {
    start,
    size: Math.max(1, end - start),
  };
};

const renderFloorplanSurface = (
  grid: FloorplanGrid | null,
  image?: HTMLImageElement,
): HTMLCanvasElement | undefined => {
  const metrics = getFloorplanRenderMetrics(grid, image);
  const surfaceWidth = Math.round(metrics.width);
  const surfaceHeight = Math.round(metrics.height);
  const hasVisibleTiles = grid?.tiles.some((row) => row.some((tile) => tile !== 'floor')) ?? false;

  if (surfaceWidth <= 0 || surfaceHeight <= 0 || (!image && !hasVisibleTiles)) {
    return undefined;
  }

  const canvas = document.createElement('canvas');
  canvas.width = surfaceWidth;
  canvas.height = surfaceHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  context.clearRect(0, 0, surfaceWidth, surfaceHeight);

  if (image) {
    context.drawImage(image, 0, 0, surfaceWidth, surfaceHeight);
  }

  if (grid) {
    for (let rowIndex = 0; rowIndex < grid.height; rowIndex += 1) {
      const { start: startY, size: height } = getCellBounds(
        rowIndex,
        grid.height,
        surfaceHeight,
      );

      for (let columnIndex = 0; columnIndex < grid.width; columnIndex += 1) {
        const tile = grid.tiles[rowIndex]?.[columnIndex] ?? 'floor';
        if (tile === 'floor') {
          continue;
        }

        const { start: startX, size: width } = getCellBounds(
          columnIndex,
          grid.width,
          surfaceWidth,
        );

        context.fillStyle = tileColors[tile];
        context.fillRect(startX, startY, width, height);
      }
    }
  }

  return canvas;
};

type Props = {
  grid: FloorplanGrid | null;
  image?: HTMLImageElement;
};

export const FloorplanBackground = ({ grid, image }: Props) => {
  const surface = useMemo(() => renderFloorplanSurface(grid, image), [grid, image]);

  if (!surface) {
    return null;
  }

  return <KonvaImage image={surface} listening={false} />;
};