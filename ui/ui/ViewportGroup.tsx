import { Rect } from 'react-konva';
import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import {
  useSelectedDevices,
  useToggleSelectedDevice,
} from '@/hooks/selectedDevices';
import { GroupId } from '@/bindings/GroupId';
import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';

const groupRects: Record<
  string,
  { x: number; y: number; width: number; height: number }
> = {
  Kitchen: { x: 260, y: 596, width: 293, height: 250 },
  'Living room': { x: 63, y: 327, width: 490, height: 260 },
  Entryway: { x: 63, y: 1062, width: 224, height: 125 },
  'Downstairs bathroom': { x: 63, y: 852, width: 104, height: 187 },
  Office: { x: 317, y: 937, width: 235, height: 250 },
  'Outdoor lights': { x: 317, y: -70, width: 400, height: 375 },
  "Ada's room": { x: 930, y: 914, width: 220, height: 268 },
  Gym: { x: 1180, y: 882, width: 240, height: 300 },
  'Upstairs bathroom': { x: 1287, y: 337, width: 135, height: 480 },
  Bedroom: { x: 930, y: 337, width: 329, height: 308 },
  Staircase: { x: 930, y: 673, width: 329, height: 154 },
};

type Props = {
  groupId: GroupId;
  group: FlattenedGroupConfig;
  touchRegistersAsTap?: MutableRefObject<boolean>;
  deviceTouchTimer?: MutableRefObject<NodeJS.Timeout | null>;
};

export const ViewportGroup = (props: Props) => {
  const groupId = props.groupId;

  const group = props.group;
  const groupDeviceKeys = group.device_ids;
  const rect = groupRects[group.name];

  const [selectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();

  const selectedGroupDevices = selectedDevices.filter((deviceKey) =>
    groupDeviceKeys.includes(deviceKey),
  );
  const isSelected = selectedGroupDevices.length > 0;

  const {
    setState: setDeviceModalState,
    setOpen: setDeviceModalOpen,
  } = useDeviceModalState();

  const touchRegistersAsTap = props.touchRegistersAsTap;
  const deviceTouchTimer = useRef<NodeJS.Timeout | null>(null);

  const onDeviceTouchStart = useCallback(() => {
    if (touchRegistersAsTap === undefined) {
      return;
    }
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
  }, [groupDeviceKeys, isSelected, toggleSelectedDevice, touchRegistersAsTap]);

  const onDeviceTouchEnd = useCallback(() => {
    if (touchRegistersAsTap === undefined) {
      return;
    }
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
  }, [
    groupDeviceKeys,
    isSelected,
    selectedDevices.length,
    setDeviceModalOpen,
    setDeviceModalState,
    toggleSelectedDevice,
    touchRegistersAsTap,
  ]);

  useEffect(() => {
    return () => {
      if (deviceTouchTimer.current !== null) {
        clearTimeout(deviceTouchTimer.current);
      }
    };
  }, []);

  if (!rect) {
    return null;
  }

  return (
    <Rect
      key={groupId}
      width={rect.width}
      height={rect.height}
      x={rect.x}
      y={rect.y}
      fill={isSelected ? '#aaa' : undefined}
      opacity={isSelected ? 0.5 : 0.5}
      stroke={isSelected ? '#fff' : '#000'}
      strokeWidth={4}
      onMouseDown={onDeviceTouchStart}
      onTouchStart={onDeviceTouchStart}
      onMouseUp={onDeviceTouchEnd}
      onTouchEnd={onDeviceTouchEnd}
    />
  );
};
