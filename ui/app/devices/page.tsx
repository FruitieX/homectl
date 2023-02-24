'use client';

import { useDeviceModalState } from '@/hooks/deviceModalState';
import { black, getColor } from '@/lib/colors';
import dynamicImport from 'next/dynamic';
import { useCallback } from 'react';
import { ColorPickerModal } from './ColorPickerModal';
import { ColorPickerTray } from './ColorPickerTray';
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
  const deviceModalTitle = `Set ${deviceModalState?.name} color`;
  const deviceModalColor =
    deviceModalState !== null ? getColor(deviceModalState.state) : null;

  const setDeviceColor = useSetDeviceColor();
  const partialSetDeviceColor = useCallback(
    (color: Color) => {
      if (deviceModalState !== null) {
        setDeviceColor(deviceModalState, color);
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
        onChange={throttledSetDeviceColor}
        onChangeComplete={throttledSetDeviceColor}
      />
      <NoSSRViewport />
      {/* <ColorPickerTray /> */}
    </>
  );
}
