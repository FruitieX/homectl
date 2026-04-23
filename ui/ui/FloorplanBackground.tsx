import { Group, Image as KonvaImage, Path } from 'react-konva';
import type { ReactElement } from 'react';
import type { FloorplanGrid, TileType } from '@/ui/FloorplanGridEditor';

type DrawableTileType = Exclude<TileType, 'floor'>;

const tileColors: Record<DrawableTileType, string> = {
  wall: '#374151',
  door: '#92400e',
  window: '#60a5fa',
};

const drawableTileTypes = ['wall', 'door', 'window'] as const satisfies readonly DrawableTileType[];

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

  const clampedPosition = Math.min(Math.max(position, 0), Math.max(totalSize - 1, 0));

  for (let index = 0; index < totalCells; index += 1) {
    const { start, size } = getFloorplanCellBounds(index, totalCells, totalSize);
    if (clampedPosition >= start && clampedPosition < start + size) {
      return index;
    }
  }

  return totalCells - 1;
};

type Props = {
  grid: FloorplanGrid | null;
  image?: HTMLImageElement;
};

export const FloorplanBackground = ({ grid, image }: Props) => {
  const metrics = getFloorplanRenderMetrics(grid, image);
  const surfaceWidth = Math.round(metrics.width);
  const surfaceHeight = Math.round(metrics.height);

  if (surfaceWidth <= 0 || surfaceHeight <= 0) {
    return null;
  }

  // Previously this component built an offscreen HTMLCanvasElement and
  // handed it to a Konva Image node. That round-trip proved unreliable in
  // Firefox: the first Layer.batchDraw after mount could sample the
  // offscreen bitmap before it was ready on the compositor side, leaving
  // the floorplan invisible until an unrelated re-render forced another
  // redraw. Rendering tiles as native Konva primitives avoids the
  // HTMLCanvasElement → Konva image bridge entirely.
  const tilePathData: Record<DrawableTileType, string[]> = {
    wall: [],
    door: [],
    window: [],
  };
  if (grid) {
    for (let rowIndex = 0; rowIndex < grid.height; rowIndex += 1) {
      const { start: startY, size: height } = getFloorplanCellBounds(
        rowIndex,
        grid.height,
        surfaceHeight,
      );

      for (let columnIndex = 0; columnIndex < grid.width; columnIndex += 1) {
        const tile = grid.tiles[rowIndex]?.[columnIndex] ?? 'floor';
        if (tile === 'floor') {
          continue;
        }

        const { start: startX, size: width } = getFloorplanCellBounds(
          columnIndex,
          grid.width,
          surfaceWidth,
        );

        tilePathData[tile].push(
          `M ${startX} ${startY} H ${startX + width} V ${startY + height} H ${startX} Z`,
        );
      }
    }
  }

  const tilePaths: ReactElement[] = drawableTileTypes.flatMap((tileType) => {
    const pathData = tilePathData[tileType].join(' ');
    if (pathData === '') {
      return [];
    }

    return [
      <Path
        key={tileType}
        data={pathData}
        fill={tileColors[tileType]}
        listening={false}
        strokeEnabled={false}
        perfectDrawEnabled={false}
      />,
    ];
  });

  return (
    <Group listening={false}>
      {image && (
        <KonvaImage
          image={image}
          width={surfaceWidth}
          height={surfaceHeight}
          listening={false}
        />
      )}
      {tilePaths}
    </Group>
  );
};