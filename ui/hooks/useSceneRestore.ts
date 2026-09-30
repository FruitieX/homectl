import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Device } from '@/bindings/Device';
import { useScenesState, useWebsocket } from '@/hooks/websocket';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import {
  MANUAL_TRANSITION_SECONDS,
  sendSceneCommand,
} from '@/lib/deviceCommands';
import { createUuid } from '@/lib/uuid';

/** Restore each paused device's own scene, for both full and quick controls. */
export function useSceneRestore(devices: Device[]) {
  const scenes = useScenesState();
  const ws = useWebsocket();
  const [restoring, setRestoring] = useState(false);
  const inFlight = useRef(false);
  const targets = new Map<string, string[]>();
  for (const device of devices) {
    if (isDeviceReadOnly(device) || !('Controllable' in device.data)) continue;
    const { scene_id, scene_paused } = device.data.Controllable;
    const key = getDeviceKey(device);
    if (!scene_paused || !scene_id || !scenes?.[scene_id]?.devices[key])
      continue;
    targets.set(scene_id, [...(targets.get(scene_id) ?? []), key]);
  }
  const restore = async () => {
    if (!ws || !targets.size || inFlight.current) return false;
    inFlight.current = true;
    setRestoring(true);
    try {
      await Promise.all(
        [...targets].map(([scene_id, device_keys]) =>
          sendSceneCommand(ws, {
            request_id: createUuid(),
            scene_id,
            device_keys,
            group_keys: null,
            use_scene_transition: false,
            transition: MANUAL_TRANSITION_SECONDS,
          }),
        ),
      );
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not restore scenes.',
      );
      return false;
    } finally {
      inFlight.current = false;
      setRestoring(false);
    }
  };
  return {
    canRestore: targets.size > 0,
    restoreLabel: targets.size > 1 ? 'Restore scenes' : 'Restore scene',
    restoring,
    restore,
  };
}
