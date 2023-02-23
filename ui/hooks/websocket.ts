'use client';

import { StateUpdate } from '@/bindings/StateUpdate';
import { WebSocketResponse } from '@/bindings/WebSocketResponse';
import { useEffect } from 'react';
import { atom, useAtom } from 'jotai';

const websocketStateAtom = atom<StateUpdate | null>(null);
const websocketAtom = atom<WebSocket | null>(null);

export const useProvideWebsocketState = () => {
  const [, setState] = useAtom(websocketStateAtom);
  const [, setWebsocket] = useAtom(websocketAtom);

  useEffect(() => {
    // const ws = new WebSocket('ws://localhost:3000/ws');
    const ws = new WebSocket('ws://satsuma:45289/ws');

    ws.onmessage = function incoming(data) {
      const msg: WebSocketResponse = JSON.parse(data.data as string);
      setState(msg.State);
    };

    setWebsocket(ws);
  }, [setState, setWebsocket]);
};

export const useWebsocketState = (): StateUpdate | null => {
  const [state] = useAtom(websocketStateAtom);
  return state;
};

export const useWebsocket = (): WebSocket | null => {
  const [state] = useAtom(websocketAtom);
  return state;
};
