'use client';

import { useDeviceModalState } from '@/hooks/deviceModalState';
import { black, getBrightness, getColor } from '@/lib/colors';
import dynamicImport from 'next/dynamic';
import { useCallback } from 'react';
import { ColorPickerModal } from './ColorPickerModal';
import Color from 'color';
import { useThrottleCallback } from '@react-hook/throttle';
import { useSetDeviceColor } from '@/hooks/useSetDeviceColor';

const NoSSRViewport = dynamicImport(() => import('./Viewport'), { ssr: false });

export default function Page() {
  const {
    state: deviceModalState,
    open: deviceModalOpen,
    setOpen: setDeviceModalOpen,
  } = useDeviceModalState();
  const deviceModalTitle =
    deviceModalState.length === 1
      ? `Set ${deviceModalState[0]?.name} color`
      : `Set color of ${deviceModalState.length} devices`;
  const deviceModalColor =
    deviceModalState[0] === undefined
      ? null
      : getColor(deviceModalState[0].state);
  const deviceModalBrightness =
    deviceModalState[0] === undefined
      ? null
      : getBrightness(deviceModalState[0].state);

  console.log(deviceModalState);

  const setDeviceColor = useSetDeviceColor();
  const partialSetDeviceColor = useCallback(
    (color: Color, brightness: number) => {
      if (deviceModalState !== null) {
        deviceModalState.forEach((device) =>
          setDeviceColor(device, color, brightness),
        );
      }
    },
    [deviceModalState, setDeviceColor],
  );

  const throttledSetDeviceColor = useThrottleCallback(
    partialSetDeviceColor,
    3,
    true,
  );

  const closeDeviceModal = useCallback(() => {
    setDeviceModalOpen(false);
  }, [setDeviceModalOpen]);

  return (
    <>
      <ColorPickerModal
        visible={deviceModalOpen}
        close={closeDeviceModal}
        title={deviceModalTitle}
        color={deviceModalColor ?? black}
        brightness={deviceModalBrightness ?? 1}
        onChange={throttledSetDeviceColor}
        onChangeComplete={throttledSetDeviceColor}
      />
      <NoSSRViewport />
      {/* <ColorPickerTray /> */}
    </>
  );
}
