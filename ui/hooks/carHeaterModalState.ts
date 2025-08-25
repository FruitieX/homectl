'use client';

import { atom, useAtom } from 'jotai';
import { useUiState, useWebsocket } from './websocket';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useCallback, useMemo } from 'react';
import { produce } from 'immer';

const carHeaterModalOpenAtom = atom<boolean>(false);

export const useCarHeaterModalOpenState = () => {
  const [open, setOpen] = useAtom(carHeaterModalOpenAtom);
  return { open, setOpen } as const;
};

const uiStateKey = 'carHeaterTimer';

export type CarHeaterTimer = {
  enabled: boolean;
  name: string;
  repeat: 'once' | 'weekday' | 'daily';
  hour: number;
  minute: number;
};

export type CarHeaterModalState = {
  timers: CarHeaterTimer[];
};

export const carModalDefaultState: CarHeaterModalState = {
  timers: [],
};

export const defaultHeaterTimer = {
  enabled: false,
  name: 'Timer',
  repeat: 'once' as CarHeaterTimer['repeat'],
  hour: 12,
  minute: 0,
};

export const useCarHeaterModalState = () => {
  const ws = useWebsocket();
  let state =
    useUiState<CarHeaterModalState>(uiStateKey) ?? carModalDefaultState;

  if (!state.timers) {
    state = { timers: [] };
  }

  const storeState = useCallback(
    (state: CarHeaterModalState) => {
      const msg: WebSocketRequest = {
        EventMessage: {
          Action: {
            action: 'Ui',
            StoreUIState: { key: uiStateKey, value: state },
          },
        },
      };
      ws?.send(JSON.stringify(msg));
    },
    [ws],
  );

  const storeTimer = useCallback(
    (index: number, timer: CarHeaterTimer) => {
      const value = produce(state, (draft) => {
        draft.timers[index] = timer;
      });
      storeState(value);
    },
    [state, storeState],
  );

  const ensureTimer = (timer: CarHeaterTimer | undefined, index: number) => {
    if (!timer) {
      return {
        ...defaultHeaterTimer,
        name: `Timer ${index + 1}`,
      };
    }

    return timer;
  };

  const toggleEnabled = useCallback(
    (index: number, enabled?: boolean) => {
      const value = produce(state, (draft) => {
        let timer = ensureTimer(draft.timers[index], index);
        timer.enabled = enabled ?? !timer.enabled;
      });
      storeState(value);
    },
    [state, storeState],
  );

  const setTime = useCallback(
    (index: number, hour: number, minute: number) => {
      const value = produce(state, (draft) => {
        let timer = ensureTimer(draft.timers[index], index);
        timer.hour = Math.max(0, Math.min(23, hour));
        timer.minute = Math.max(0, Math.min(59, minute));
      });
      storeState(value);
    },
    [state, storeState],
  );

  return { state, storeState, toggleEnabled, setTime };
};
