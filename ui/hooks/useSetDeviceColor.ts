import { toast } from 'sonner';
import { createUuid } from '@/lib/uuid';
import type { Device } from '@/bindings/Device';
import { useWebsocket } from '@/hooks/websocket';
import Color, { type ColorInstance } from 'color';

type Color = ColorInstance;
import { useCallback } from 'react';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import {
  MANUAL_TRANSITION_SECONDS,
  sendDeviceCommand,
} from '@/lib/deviceCommands';
import type { DeviceColor } from '@/bindings/DeviceColor';
export const useSetDeviceState = () => {
  const ws = useWebsocket();
  return useCallback(
    (
      device: Device,
      preserveScene: boolean,
      power: boolean,
      color?: Color,
      brightness?: number,
      transition?: number,
      nativeColor?: DeviceColor,
    ) => {
      if (isDeviceReadOnly(device)) {
        toast.error('This device is read-only.');
        return Promise.resolve(false);
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast.error('Not connected. Try again when the connection returns.');
        return Promise.resolve(false);
      }
      const hsv = color?.hsv();
      return sendDeviceCommand(ws, {
        request_id: createUuid(),
        device_key: getDeviceKey(device),
        power,
        preserve_scene: preserveScene,
        brightness: brightness ?? null,
        transition: transition ?? MANUAL_TRANSITION_SECONDS,
        color:
          nativeColor ??
          (hsv
            ? { h: Math.round(hsv.hue()), s: hsv.saturationv() / 100 }
            : null),
      })
        .then(() => true)
        .catch((error: Error) => {
          toast.error(error.message, { id: 'device-command-error' });
          return false;
        });
    },
    [ws],
  );
};
