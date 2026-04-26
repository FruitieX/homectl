import { DevicesPatch } from '@/bindings/DevicesPatch';
import { DevicesState } from '@/bindings/DevicesState';
import { Device } from '@/bindings/Device';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { FlattenedScenesConfig } from '@/bindings/FlattenedScenesConfig';
import { RoutineStatuses } from '@/bindings/RoutineStatuses';
import { StateUpdate } from '@/bindings/StateUpdate';
import { WebSocketResponse } from '@/bindings/WebSocketResponse';
import { JsonValue } from '@/bindings/serde_json/JsonValue';
import { useEffect, useMemo, useRef } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useAppConfig } from './appConfig';
import { selectAtom } from 'jotai/utils';

type UiState = { [key in string]?: JsonValue };

const devicesAtom = atom<DevicesState | null>(null);
const scenesAtom = atom<FlattenedScenesConfig | null>(null);
const groupsAtom = atom<FlattenedGroupsConfig | null>(null);
const routineStatusesStateAtom = atom<RoutineStatuses | null>(null);
const websocketUiStateAtom = atom<UiState | null>(null);
const websocketStateAtom = atom<StateUpdate | null>((get) => {
  const devices = get(devicesAtom);
  const scenes = get(scenesAtom);
  const groups = get(groupsAtom);
  const routineStatuses = get(routineStatusesStateAtom);
  const uiState = get(websocketUiStateAtom);

  if (
    devices === null ||
    scenes === null ||
    groups === null ||
    routineStatuses === null ||
    uiState === null
  ) {
    return null;
  }

  return {
    devices,
    scenes,
    groups,
    routine_statuses: routineStatuses,
    ui_state: uiState,
  };
});
const websocketAtom = atom<WebSocket | null>(null);

function applyDevicesPatch(
  current: DevicesState | null,
  patch: DevicesPatch,
): DevicesState {
  const next: DevicesState = { ...(current ?? {}) };

  for (const deviceKey of patch.removed) {
    delete next[deviceKey];
  }

  for (const [deviceKey, device] of Object.entries(patch.upserted)) {
    if (device === undefined) {
      delete next[deviceKey];
    } else {
      next[deviceKey] = device;
    }
  }

  return next;
}

export const useProvideWebsocketState = () => {
  const wsEndpoint = useAppConfig().wsEndpoint;
  const setDevices = useSetAtom(devicesAtom);
  const setScenes = useSetAtom(scenesAtom);
  const setGroups = useSetAtom(groupsAtom);
  const setRoutineStatuses = useSetAtom(routineStatusesStateAtom);
  const setUiState = useSetAtom(websocketUiStateAtom);
  const setWebsocket = useSetAtom(websocketAtom);

  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;

    const clearReconnectTimeout = () => {
      if (reconnectTimeout.current !== null) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) {
        return;
      }

      const baseDelayMs = 1_000;
      const maxDelayMs = 30_000;
      const delayMs = Math.min(
        baseDelayMs * 2 ** reconnectAttempts.current,
        maxDelayMs,
      );
      reconnectAttempts.current += 1;

      clearReconnectTimeout();
      reconnectTimeout.current = setTimeout(connect, delayMs);
    };

    function connect() {
      if (disposed) {
        return;
      }

      console.log('Opening ws connection...');

      ws = new WebSocket(wsEndpoint);

      ws.onopen = () => {
        reconnectAttempts.current = 0;
      };

      ws.onmessage = function incoming(data) {
        let msg: WebSocketResponse;
        try {
          msg = JSON.parse(data.data as string) as WebSocketResponse;
        } catch (error) {
          console.warn('Ignoring invalid WebSocket message', error);
          return;
        }

        if ('Command' in msg && msg.Command === 'reload') {
          window.location.reload();
        } else if ('State' in msg) {
          setDevices(msg.State.devices);
          setScenes(msg.State.scenes);
          setGroups(msg.State.groups);
          setRoutineStatuses(msg.State.routine_statuses);
          setUiState(msg.State.ui_state);
        } else if ('Patch' in msg) {
          const patch = msg.Patch;
          const devicesPatch = patch.devices;
          if (devicesPatch) {
            setDevices((current) => applyDevicesPatch(current, devicesPatch));
          }
          if (patch.scenes) {
            setScenes(patch.scenes);
          }
          if (patch.groups) {
            setGroups(patch.groups);
          }
          if (patch.routine_statuses) {
            setRoutineStatuses(patch.routine_statuses);
          }
          if (patch.ui_state) {
            setUiState(patch.ui_state);
          }
        }
      };

      ws.onclose = () => {
        setWebsocket(null);
        scheduleReconnect();
      };

      setWebsocket(ws);
    }

    connect();

    return () => {
      disposed = true;
      clearReconnectTimeout();
      setWebsocket(null);

      if (ws !== null) {
        console.log('Closing ws connection');
        ws.onclose = null;
        ws.close();
      }
    };
  }, [
    setDevices,
    setGroups,
    setRoutineStatuses,
    setScenes,
    setUiState,
    setWebsocket,
    wsEndpoint,
  ]);
};

export const useWebsocketState = (): StateUpdate | null => {
  const state = useAtomValue(websocketStateAtom);
  return state;
};

export const useWebsocket = (): WebSocket | null => {
  const state = useAtomValue(websocketAtom);
  return state;
};

export const useDevicesState = (): DevicesState | null =>
  useAtomValue(devicesAtom);

export const useDeviceState = (
  deviceKey: string | undefined,
): Device | undefined => {
  const deviceAtom = useMemo(
    () =>
      selectAtom(devicesAtom, (devices) =>
        deviceKey && devices ? devices[deviceKey] : undefined,
      ),
    [deviceKey],
  );

  return useAtomValue(deviceAtom);
};

export const useScenesState = (): FlattenedScenesConfig | null =>
  useAtomValue(scenesAtom);

export const useGroupsState = (): FlattenedGroupsConfig | null =>
  useAtomValue(groupsAtom);

export const uiStateAtom = websocketUiStateAtom;

export const routineStatusesAtom = routineStatusesStateAtom;

export const useUiState = <T>(key: string): T | undefined => {
  const state = useAtomValue(uiStateAtom);
  return state ? (state[key] as T) : undefined;
};

export const useRoutineStatuses = (): RoutineStatuses | undefined => {
  return useAtomValue(routineStatusesAtom) ?? undefined;
};
