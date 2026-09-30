import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { useSetDeviceState } from '@/hooks/useSetDeviceColor';
import { useScenesState } from '@/hooks/websocket';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';

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
