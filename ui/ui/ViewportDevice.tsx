import { Circle, Text } from 'react-konva';
import { Device } from '@/bindings/Device';
import { Vector2d } from 'konva/lib/types';
import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { getBrightness, getColor, getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { Portal } from 'react-konva-utils';
import {
  useSelectedDevices,
  useToggleSelectedDevice,
} from '@/hooks/selectedDevices';
import Color from 'color';
import { KonvaEventObject } from 'konva/lib/Node';

const devicePositions: Record<string, Vector2d> = {
  'Kitchen lightstrip upper': { x: 537, y: 700 },
  'Kitchen lightstrip': { x: 537, y: 800 },
  'Living room downlight 3': { x: 450, y: 400 },
  'Living room downlight 2': { x: 175, y: 400 },
  'Living room downlight 1': { x: 175, y: 525 },
  'Living room downlight 4': { x: 450, y: 525 },
  'Kitchen table': { x: 250, y: 462 },
  'Living room': { x: 375, y: 462 },
  Bedroom: { x: 1100, y: 500 },
  'Iittala Lantern 1': { x: 960, y: 575 },
  'Iittala Lantern 2': { x: 960, y: 400 },
  'Lower bathroom lightstrip': { x: 125, y: 1015 },
  'Lower bathroom downlight 1': { x: 115, y: 960 },
  'Lower bathroom downlight 2': { x: 115, y: 885 },
  'Outdoor lightstrip': { x: 400, y: 0 },
  'Hue play L': { x: 520, y: 1015 },
  'Large outdoor spot': { x: 520, y: 1075 },
  'Hue play R': { x: 520, y: 1135 },
  'Upper bathroom lightstrip': { x: 1405, y: 680 },
  'Bathroom outdoor lightstrip': { x: 1300, y: 590 },
  'Upper bathroom downlight 1': { x: 1350, y: 525 },
  'Upper bathroom downlight 2': { x: 1350, y: 650 },
  'Upper bathroom downlight 3': { x: 1350, y: 775 },
  'Kitchen spot 1': { x: 390, y: 650 },
  'Kitchen spot 2': { x: 320, y: 650 },
  'Kitchen spot 3': { x: 355, y: 700 },
  'Left small bedroom': { x: 1300, y: 1050 },
  'Right small bedroom': { x: 1030, y: 1050 },
  'Kitchen downlight 1': { x: 460, y: 650 },
  'Kitchen downlight 2': { x: 460, y: 725 },
  'Kitchen downlight 3': { x: 460, y: 800 },
  'Kitchen downlight 4': { x: 390, y: 800 },
  'Entryway table': { x: 150, y: 1070 },
  'Entryway downlight 1': { x: 130, y: 1125 },
  'Entryway downlight 2': { x: 240, y: 1125 },
  'Entryway downlight 3': { x: 240, y: 950 },
  'Hue outdoor spot 1': { x: 575, y: 50 },
  'Hue outdoor spot 2': { x: 625, y: 100 },
  'Hue outdoor spot 3': { x: 575, y: 150 },
  'Hue outdoor spot 4': { x: 625, y: 200 },
  'Hue outdoor spot 5': { x: 575, y: 250 },
  Office: { x: 450, y: 1075 },
  Staircase: { x: 1000, y: 750 },
  'Baby changing table': { x: 1405, y: 800 },
};

type Props = {
  device: Device;
  touchRegistersAsTap?: MutableRefObject<boolean>;
  deviceTouchTimer?: MutableRefObject<NodeJS.Timeout | null>;
  selected: boolean;
  interactive: boolean;
  overrideColor?: Color;
};

export const ViewportDevice = (props: Props) => {
  const interactive = props.interactive;

  const device = props.device;
  const position = devicePositions[device.name];

  const brightness = props.overrideColor ? 1 : getBrightness(device.data);
  const power = props.overrideColor ? true : getPower(device.data);

  const color = props.overrideColor
    ? props.overrideColor
    : power
      ? getColor(device.data)
      : Color('black');

  const [selectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();

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
          toggleSelectedDevice(getDeviceKey(device));
        }
        deviceTouchTimer.current = null;
        touchRegistersAsTap.current = false;
      }, 500);
    },
    [device, toggleSelectedDevice, touchRegistersAsTap],
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
          setDeviceModalState([getDeviceKey(device)]);
          setDeviceModalOpen(true);
        } else {
          toggleSelectedDevice(getDeviceKey(device));
        }
      }
    },
    [
      device,
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

  if (!position) {
    return null;
  }

  const radialGradientRadius = 100 + 200 * brightness;
  return (
    <>
      {power && (
        <Portal selector=".bottom-layer" enabled>
          <Circle
            key={`${getDeviceKey(device)}-gradient`}
            x={position.x}
            y={position.y}
            radius={radialGradientRadius}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndRadius={radialGradientRadius}
            fillRadialGradientColorStops={[
              0,
              color.alpha(0.2).hsl().string(),
              1,
              'transparent',
            ]}
          />
        </Portal>
      )}
      <Circle
        key={getDeviceKey(device)}
        x={position.x}
        y={position.y}
        radius={20}
        fill={color
          .desaturate(0.4)
          .darken(0.5 - brightness / 2)
          .hsl()
          .string()}
        stroke={props.selected ? 'white' : '#111'}
        strokeWidth={4}
        {...(interactive
          ? {
              onMouseDown: onDeviceTouchStart,
              onTouchStart: onDeviceTouchStart,
              onMouseUp: onDeviceTouchEnd,
              onTouchEnd: onDeviceTouchEnd,
            }
          : {})}
      />
      {props.selected && (
        <Text
          text="✓"
          fontSize={24}
          x={position.x - 10}
          y={position.y - 10}
          fill="white"
          fontStyle="bold"
          {...(interactive
            ? {
                onMouseDown: onDeviceTouchStart,
                onTouchStart: onDeviceTouchStart,
                onMouseUp: onDeviceTouchEnd,
                onTouchEnd: onDeviceTouchEnd,
              }
            : {})}
        />
      )}
    </>
  );
};
