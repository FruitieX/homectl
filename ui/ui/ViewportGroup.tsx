import { Group as KonvaGroup, Image as KonvaImage } from 'react-konva';
import { getFloorplanGroupFill, getFloorplanGroupStroke } from '@/lib/floorplanGroupColor';
import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import {
  useSelectedDevices,
  useToggleSelectedDevice,
} from '@/hooks/selectedDevices';
import { GroupId } from '@/bindings/GroupId';
import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { KonvaEventObject } from 'konva/lib/Node';

export interface GroupMaskCell {
  x: number;
  y: number;
}

type GroupSurface = {
  image: HTMLCanvasElement;
  x: number;
  y: number;
};

const getGroupCellKey = (x: number, y: number) => `${x},${y}`;

const renderGroupSurface = (
  cells: GroupMaskCell[],
  tileWidth: number,
  tileHeight: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
): GroupSurface | null => {
  if (cells.length === 0 || tileWidth <= 0 || tileHeight <= 0) {
    return null;
  }

  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));

  const offsetX = Math.round(minX * tileWidth);
  const offsetY = Math.round(minY * tileHeight);
  const surfaceWidth = Math.max(1, Math.round((maxX + 1) * tileWidth) - offsetX);
  const surfaceHeight = Math.max(1, Math.round((maxY + 1) * tileHeight) - offsetY);

  const canvas = document.createElement('canvas');
  canvas.width = surfaceWidth;
  canvas.height = surfaceHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.clearRect(0, 0, surfaceWidth, surfaceHeight);

  const cellKeys = new Set(cells.map((cell) => getGroupCellKey(cell.x, cell.y)));
  context.fillStyle = fill;

  for (const cell of cells) {
    const startX = Math.round(cell.x * tileWidth) - offsetX;
    const startY = Math.round(cell.y * tileHeight) - offsetY;
    const endX = Math.round((cell.x + 1) * tileWidth) - offsetX;
    const endY = Math.round((cell.y + 1) * tileHeight) - offsetY;

    context.fillRect(startX, startY, Math.max(1, endX - startX), Math.max(1, endY - startY));
  }

  if (strokeWidth > 0) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.lineCap = 'square';

    for (const cell of cells) {
      const startX = Math.round(cell.x * tileWidth) - offsetX;
      const startY = Math.round(cell.y * tileHeight) - offsetY;
      const endX = Math.round((cell.x + 1) * tileWidth) - offsetX;
      const endY = Math.round((cell.y + 1) * tileHeight) - offsetY;

      if (!cellKeys.has(getGroupCellKey(cell.x, cell.y - 1))) {
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, startY);
        context.stroke();
      }

      if (!cellKeys.has(getGroupCellKey(cell.x + 1, cell.y))) {
        context.beginPath();
        context.moveTo(endX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      }

      if (!cellKeys.has(getGroupCellKey(cell.x, cell.y + 1))) {
        context.beginPath();
        context.moveTo(startX, endY);
        context.lineTo(endX, endY);
        context.stroke();
      }

      if (!cellKeys.has(getGroupCellKey(cell.x - 1, cell.y))) {
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(startX, endY);
        context.stroke();
      }
    }
  }

  return {
    image: canvas,
    x: offsetX,
    y: offsetY,
  };
};

type Props = {
  groupId: GroupId;
  group: FlattenedGroupConfig;
  cells: GroupMaskCell[];
  tileWidth: number;
  tileHeight: number;
  touchRegistersAsTap?: MutableRefObject<boolean>;
  deviceTouchTimer?: MutableRefObject<NodeJS.Timeout | null>;
};

export const ViewportGroup = (props: Props) => {
  const groupId = props.groupId;

  const group = props.group;
  const groupDeviceKeys = group.device_keys;
  const cells = props.cells;
  const tileWidth = props.tileWidth;
  const tileHeight = props.tileHeight;

  const [selectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();

  const selectedGroupDevices = selectedDevices.filter((deviceKey) =>
    groupDeviceKeys.includes(deviceKey),
  );
  const isSelected = selectedGroupDevices.length > 0;

  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();

  const touchRegistersAsTap = props.touchRegistersAsTap;
  const deviceTouchTimer = useRef<NodeJS.Timeout | null>(null);

  const onDeviceTouchStart = useCallback(
    (e: KonvaEventObject<TouchEvent | MouseEvent>) => {
      if (touchRegistersAsTap === undefined) {
        return;
      }

      if (e.evt.cancelable) e.evt.preventDefault();

      touchRegistersAsTap.current = true;
      deviceTouchTimer.current = setTimeout(() => {
        if (touchRegistersAsTap.current === true) {
          for (const deviceKey of groupDeviceKeys) {
            toggleSelectedDevice(deviceKey, isSelected);
          }
        }
        deviceTouchTimer.current = null;
        touchRegistersAsTap.current = false;
      }, 500);
    },
    [groupDeviceKeys, isSelected, toggleSelectedDevice, touchRegistersAsTap],
  );

  const onDeviceTouchEnd = useCallback(
    (e: KonvaEventObject<TouchEvent | MouseEvent>) => {
      if (touchRegistersAsTap === undefined) {
        return;
      }

      if (e.evt.cancelable) e.evt.preventDefault();

      if (deviceTouchTimer.current !== null) {
        clearTimeout(deviceTouchTimer.current);
        deviceTouchTimer.current = null;
      }

      if (touchRegistersAsTap.current === true) {
        if (selectedDevices.length === 0) {
          setDeviceModalState(groupDeviceKeys);
          setDeviceModalOpen(true);
        } else {
          for (const deviceKey of groupDeviceKeys) {
            toggleSelectedDevice(deviceKey, isSelected);
          }
        }
      }
    },
    [
      groupDeviceKeys,
      isSelected,
      selectedDevices.length,
      setDeviceModalOpen,
      setDeviceModalState,
      toggleSelectedDevice,
      touchRegistersAsTap,
    ],
  );

  useEffect(() => {
    return () => {
      if (deviceTouchTimer.current !== null) {
        clearTimeout(deviceTouchTimer.current);
      }
    };
  }, []);

  const fill = getFloorplanGroupFill(groupId, isSelected ? 0.4 : 0.18);
  const stroke = getFloorplanGroupStroke(groupId, isSelected ? 1 : 0.45);
  const strokeWidth = isSelected ? 1.6 : 0.8;
  const [surface, setSurface] = useState<GroupSurface | null>(null);

  useEffect(() => {
    setSurface(renderGroupSurface(cells, tileWidth, tileHeight, fill, stroke, strokeWidth));
  }, [cells, fill, stroke, strokeWidth, tileHeight, tileWidth]);

  return (
    <KonvaGroup
      key={groupId}
      onMouseDown={onDeviceTouchStart}
      onTouchStart={onDeviceTouchStart}
      onMouseUp={onDeviceTouchEnd}
      onTouchEnd={onDeviceTouchEnd}
    >
      {surface && <KonvaImage image={surface.image} x={surface.x} y={surface.y} />}
    </KonvaGroup>
  );
};
