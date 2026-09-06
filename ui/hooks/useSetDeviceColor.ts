import { toast } from 'sonner';
import type { Device } from '@/bindings/Device';
import { useWebsocket } from '@/hooks/websocket';
import Color from 'color';
import { useCallback } from 'react';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { sendDeviceCommand } from '@/lib/deviceCommands';

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
    ) => {
      if (isDeviceReadOnly(device)) {
        toast.error('This device is read-only.');
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast.error('Not connected. Try again when the connection returns.');
        return;
      }
      const hsv = color?.hsv();
      void sendDeviceCommand(ws, {
        request_id: crypto.randomUUID(),
        device_key: getDeviceKey(device),
        power,
        preserve_scene: preserveScene,
        brightness: brightness ?? null,
        transition: transition ?? null,
        color: hsv
          ? { h: Math.round(hsv.hue()), s: hsv.saturationv() / 100 }
          : null,
      }).catch((error: Error) =>
        toast.error(error.message, { id: 'device-command-error' }),
      );
    },
    [ws],
  );
};
