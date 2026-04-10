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

type Props = {
  device: Device;
  position: Vector2d;
  touchRegistersAsTap?: MutableRefObject<boolean>;
  deviceTouchTimer?: MutableRefObject<NodeJS.Timeout | null>;
  selected: boolean;
  interactive: boolean;
  overrideColor?: Color;
};

export const ViewportDevice = (props: Props) => {
  const interactive = props.interactive;

  const device = props.device;
  const position = props.position;

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
