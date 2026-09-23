import {
  disconnectDeviceCommands,
  receiveDeviceCommandResult,
  receiveSceneCommandResult,
} from '@/lib/deviceCommands';
import { DevicesPatch } from '@/bindings/DevicesPatch';
import { DevicesState } from '@/bindings/DevicesState';
import { Device } from '@/bindings/Device';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { FlattenedScenesConfig } from '@/bindings/FlattenedScenesConfig';
import { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import { RoutineStatuses } from '@/bindings/RoutineStatuses';
import { StateUpdate } from '@/bindings/StateUpdate';
import { TimerRuntimeStatus } from '@/bindings/TimerRuntimeStatus';
import { WebSocketResponse } from '@/bindings/WebSocketResponse';
import { JsonValue } from '@/bindings/serde_json/JsonValue';
import { useEffect, useMemo, useRef } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useAppConfig } from './appConfig';
import { selectAtom } from 'jotai/utils';
import { decidePatchAction } from '@/lib/websocketRevision';
import {
  RESUME_PROBE_TIMEOUT_MS,
  decideResumeAction,
  reconnectDelayMs,
  socketReadiness,
} from '@/lib/websocketReconnect';

type UiState = { [key in string]?: JsonValue };

const devicesAtom = atom<DevicesState | null>(null);
const scenesAtom = atom<FlattenedScenesConfig | null>(null);
const groupsAtom = atom<FlattenedGroupsConfig | null>(null);
const routineStatusesStateAtom = atom<RoutineStatuses | null>(null);
const timersStateAtom = atom<TimerRuntimeStatus[] | null>(null);
const helperStatusesStateAtom = atom<HelperRuntimeStatus[] | null>(null);
const websocketUiStateAtom = atom<UiState | null>(null);
const websocketRevisionAtom = atom<number | null>(null);
const websocketStateAtom = atom<StateUpdate | null>((get) => {
  const revision = get(websocketRevisionAtom);
  const devices = get(devicesAtom);
  const scenes = get(scenesAtom);
  const groups = get(groupsAtom);
  const routineStatuses = get(routineStatusesStateAtom);
  const timers = get(timersStateAtom);
  const helperStatuses = get(helperStatusesStateAtom);
  const uiState = get(websocketUiStateAtom);

  if (
    revision === null ||
    devices === null ||
    scenes === null ||
    groups === null ||
    routineStatuses === null ||
    timers === null ||
    helperStatuses === null ||
    uiState === null
  ) {
    return null;
  }

  return {
    revision,
    devices,
    scenes,
    groups,
    routine_statuses: routineStatuses,
    timers,
    helper_statuses: helperStatuses,
    ui_state: uiState,
  };
});
const websocketAtom = atom<WebSocket | null>(null);
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';
const connectionStatusAtom = atom<ConnectionStatus>('connecting');

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
  const setTimers = useSetAtom(timersStateAtom);
  const setHelperStatuses = useSetAtom(helperStatusesStateAtom);
  const setUiState = useSetAtom(websocketUiStateAtom);
  const setRevision = useSetAtom(websocketRevisionAtom);
  const setWebsocket = useSetAtom(websocketAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const revisionRef = useRef<number | null>(null);
  // Foregrounding the app must be able to reach the live socket, which only
  // exists inside the effect below.
  const resumeRef = useRef<() => void>(() => {});

  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    let probeTimeout: NodeJS.Timeout | null = null;
    // Set when we close a socket ourselves because the app came back to the
    // foreground, so its close handler reconnects at once instead of waiting
    // out a backoff.
    let reconnectOnClose = false;

    const clearReconnectTimeout = () => {
      if (reconnectTimeout.current !== null) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
    };

    const clearProbeTimeout = () => {
      if (probeTimeout !== null) {
        clearTimeout(probeTimeout);
        probeTimeout = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) {
        return;
      }

      const delayMs = reconnectDelayMs(reconnectAttempts.current);
      reconnectAttempts.current += 1;
      setConnectionStatus('reconnecting');

      clearReconnectTimeout();
      reconnectTimeout.current = setTimeout(connect, delayMs);
    };

    /** Reconnect without waiting out the remaining backoff. */
    const connectNow = () => {
      if (disposed) {
        return;
      }

      reconnectAttempts.current = 0;
      clearReconnectTimeout();
      connect();
    };

    /**
     * Runs when the app is foregrounded or the network comes back. Phones
     * suspend the page and hand back a socket that the browser still reports
     * as open even though it no longer carries traffic, while a pending
     * reconnect timer may still be waiting out a long backoff.
     */
    const resume = () => {
      if (disposed) {
        return;
      }

      const readiness = ws === null ? 'none' : socketReadiness(ws.readyState);
      switch (decideResumeAction(readiness)) {
        case 'reconnect':
          console.log('Reconnecting ws after the app was foregrounded');
          connectNow();
          return;
        case 'wait':
          return;
        case 'probe': {
          const probed = ws;
          clearProbeTimeout();
          probeTimeout = setTimeout(() => {
            probeTimeout = null;
            if (disposed || ws === null || ws !== probed) {
              return;
            }
            if (ws.readyState !== WebSocket.OPEN) {
              return;
            }
            console.log('ws did not answer after resume, reconnecting');
            reconnectOnClose = true;
            ws.close();
          }, RESUME_PROBE_TIMEOUT_MS);
          // Doubles as a state refresh for whatever changed while suspended.
          probed?.send(JSON.stringify({ Resync: {} }));
          return;
        }
      }
    };

    resumeRef.current = resume;

    function connect() {
      if (disposed) {
        return;
      }

      clearProbeTimeout();
      setConnectionStatus(
        reconnectAttempts.current > 0 ? 'reconnecting' : 'connecting',
      );
      console.log('Opening ws connection...');

      ws = new WebSocket(wsEndpoint);
      const socket = ws;

      socket.onopen = () => {
        if (ws !== socket) {
          return;
        }
        reconnectAttempts.current = 0;
        revisionRef.current = null;
        setConnectionStatus('connected');
      };

      socket.onmessage = function incoming(data) {
        if (ws !== socket) {
          return;
        }
        clearProbeTimeout();
        let msg: WebSocketResponse;
        try {
          msg = JSON.parse(data.data as string) as WebSocketResponse;
        } catch (error) {
          console.warn('Ignoring invalid WebSocket message', error);
          return;
        }

        if ('DeviceCommandResult' in msg) {
          receiveDeviceCommandResult(socket, msg.DeviceCommandResult);
        } else if ('SceneCommandResult' in msg) {
          receiveSceneCommandResult(socket, msg.SceneCommandResult);
        } else if ('Command' in msg && msg.Command === 'reload') {
          window.location.reload();
        } else if ('State' in msg) {
          revisionRef.current = msg.State.revision ?? null;
          setRevision(msg.State.revision ?? null);
          setDevices(msg.State.devices);
          setScenes(msg.State.scenes);
          setGroups(msg.State.groups);
          setRoutineStatuses(msg.State.routine_statuses);
          setTimers(msg.State.timers);
          setHelperStatuses(msg.State.helper_statuses);
          setUiState(msg.State.ui_state);
        } else if ('Patch' in msg) {
          const patch = msg.Patch;
          const decision = decidePatchAction(
            revisionRef.current,
            patch.revision ?? -1,
          );
          if (decision === 'ignore') {
            return;
          }
          if (decision === 'resync') {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ Resync: {} }));
            }
            return;
          }
          revisionRef.current = patch.revision ?? null;
          setRevision(patch.revision ?? null);
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
            const { upserted, removed } = patch.routine_statuses;
            setRoutineStatuses((current) => {
              const next: RoutineStatuses = { ...(current ?? {}) };
              for (const routineId of removed) {
                delete next[routineId];
              }
              return { ...next, ...upserted };
            });
          }
          if (patch.timers) {
            setTimers(patch.timers);
          }
          if (patch.helper_statuses) {
            setHelperStatuses(patch.helper_statuses);
          }
          if (patch.ui_state) {
            setUiState(patch.ui_state);
          }
        }
      };

      socket.onclose = () => {
        if (ws !== socket) {
          return;
        }
        disconnectDeviceCommands(socket);
        setWebsocket(null);
        clearProbeTimeout();
        if (reconnectOnClose) {
          reconnectOnClose = false;
          connectNow();
          return;
        }
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (ws !== socket) {
          return;
        }
        setConnectionStatus('reconnecting');
      };

      setWebsocket(socket);
    }

    connect();

    return () => {
      disposed = true;
      clearReconnectTimeout();
      clearProbeTimeout();
      resumeRef.current = () => {};
      setWebsocket(null);
      setConnectionStatus('disconnected');

      if (ws !== null) {
        console.log('Closing ws connection');
        disconnectDeviceCommands(ws);
        ws.onclose = null;
        ws.close();
      }
    };
  }, [
    setDevices,
    setGroups,
    setRoutineStatuses,
    setScenes,
    setTimers,
    setHelperStatuses,
    setUiState,
    setRevision,
    setWebsocket,
    setConnectionStatus,
    wsEndpoint,
  ]);

  // Foregrounding a suspended phone hands back a dead socket while a pending
  // reconnect timer may still be waiting out a long backoff, so react to the
  // app becoming visible (or the network returning) instead of only to
  // onclose.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      resumeRef.current();
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('online', onResume);
    window.addEventListener('pageshow', onResume);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('online', onResume);
      window.removeEventListener('pageshow', onResume);
    };
  }, []);
};

export const useWebsocketState = (): StateUpdate | null => {
  const state = useAtomValue(websocketStateAtom);
  return state;
};

export const useWebsocket = (): WebSocket | null => {
  const state = useAtomValue(websocketAtom);
  return state;
};

export const useConnectionStatus = (): ConnectionStatus =>
  useAtomValue(connectionStatusAtom);

export const useDevicesState = (): DevicesState | null =>
  useAtomValue(devicesAtom);

function areDeviceSelectionsEqual(
  left: DevicesState | null,
  right: DevicesState | null,
) {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

export const useDevicesByKeysState = (
  deviceKeys: readonly string[],
): DevicesState | null => {
  const deviceKeysKey = deviceKeys.join('\0');
  const selectedDevicesAtom = useMemo(() => {
    const selectedKeys = deviceKeysKey ? deviceKeysKey.split('\0') : [];
    return selectAtom(
      devicesAtom,
      (devices) => {
        if (devices === null) {
          return null;
        }

        const selectedDevices: DevicesState = {};
        for (const deviceKey of selectedKeys) {
          const device = devices[deviceKey];
          if (device !== undefined) {
            selectedDevices[deviceKey] = device;
          }
        }

        return selectedDevices;
      },
      areDeviceSelectionsEqual,
    );
  }, [deviceKeysKey]);

  return useAtomValue(selectedDevicesAtom);
};

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

export const timersAtom = timersStateAtom;

export const useTimers = (): TimerRuntimeStatus[] | undefined => {
  return useAtomValue(timersAtom) ?? undefined;
};

export const helperStatusesAtom = helperStatusesStateAtom;

export const useHelperStatuses = (): HelperRuntimeStatus[] | undefined => {
  return useAtomValue(helperStatusesAtom) ?? undefined;
};
