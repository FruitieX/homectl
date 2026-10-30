import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { useSetDeviceState } from '@/hooks/useSetDeviceColor';
import { useScenesState, useWebsocket } from '@/hooks/websocket';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import {
  MANUAL_TRANSITION_SECONDS,
  sendDeviceCommand,
} from '@/lib/deviceCommands';
import { createUuid } from '@/lib/uuid';
import { toast } from 'sonner';

// Keep the explicit scene-autosave preference when changing live controls.
export function useLiveDeviceControls() {
  const setState = useSetDeviceState();
  const scenes = useScenesState();
  return (
    device: Device,
    power: boolean,
    brightness?: number,
    color?: DeviceColor,
  ) => {
    if (!('Controllable' in device.data) || isDeviceReadOnly(device))
      return Promise.resolve(false);
    const sceneId = device.data.Controllable.scene_id;
    const persist = Boolean(
      sceneId &&
      scenes?.[sceneId]?.active_overrides.includes(getDeviceKey(device)),
    );
    // Omitted color/brightness preserve each device's own state and color mode.
    return setState(
      device,
      persist,
      power,
      undefined,
      brightness,
      undefined,
      color,
    );
  };
}

/**
 * Pick an effect (preset) or set every color slot of a multi-color device.
 * Power and brightness are left as they are; the server clears the colors
 * when an effect is picked and the effect when colors are customised.
 */
export function useLiveDeviceLook() {
  const ws = useWebsocket();
  const scenes = useScenesState();
  return (
    device: Device,
    look: { effect: string } | { colors: DeviceColor[] },
  ) => {
    if (!('Controllable' in device.data) || isDeviceReadOnly(device))
      return Promise.resolve(false);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error('Not connected. Try again when the connection returns.');
      return Promise.resolve(false);
    }
    const sceneId = device.data.Controllable.scene_id;
    return sendDeviceCommand(ws, {
      request_id: createUuid(),
      device_key: getDeviceKey(device),
      power: null,
      brightness: null,
      color: null,
      transition: MANUAL_TRANSITION_SECONDS,
      preserve_scene: Boolean(
        sceneId &&
        scenes?.[sceneId]?.active_overrides.includes(getDeviceKey(device)),
      ),
      ...look,
    })
      .then(() => true)
      .catch((error: Error) => {
        toast.error(error.message, { id: 'device-command-error' });
        return false;
      });
  };
}
