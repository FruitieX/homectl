import { toast } from 'sonner';
import { createUuid } from '@/lib/uuid';
import type { Device } from '@/bindings/Device';
import { useWebsocket } from '@/hooks/websocket';
import Color from 'color';
import { useCallback } from 'react';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { sendDeviceCommand } from '@/lib/deviceCommands';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { atom, useSetAtom } from 'jotai';

// Session history for returning manually adjusted devices to their last scene.
export const previousDeviceScenesAtom = atom<Record<string, string>>({});

export const useSetDeviceState = () => {
  const ws = useWebsocket();
  const rememberScenes = useSetAtom(previousDeviceScenesAtom);
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
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast.error('Not connected. Try again when the connection returns.');
        return;
      }
      const hsv = color?.hsv();
      if (
        !preserveScene &&
        'Controllable' in device.data &&
        device.data.Controllable.scene_id
      ) {
        const sceneId = device.data.Controllable.scene_id;
        rememberScenes((previous) => ({
          ...previous,
          [getDeviceKey(device)]: sceneId,
        }));
      }
      void sendDeviceCommand(ws, {
        request_id: createUuid(),
        device_key: getDeviceKey(device),
        power,
        preserve_scene: preserveScene,
        brightness: brightness ?? null,
        transition: transition ?? null,
        color:
          nativeColor ??
          (hsv
            ? { h: Math.round(hsv.hue()), s: hsv.saturationv() / 100 }
            : null),
      }).catch((error: Error) =>
        toast.error(error.message, { id: 'device-command-error' }),
      );
    },
    [ws, rememberScenes],
  );
};
