'use client';

import { StateUpdate } from '@/bindings/StateUpdate';
import { WebSocketResponse } from '@/bindings/WebSocketResponse';
import { useEffect, useRef } from 'react';
import { atom, useAtom } from 'jotai';

const websocketStateAtom = atom<StateUpdate | null>(null);
const websocketAtom = atom<WebSocket | null>(null);

export const useProvideWebsocketState = () => {
  const [, setState] = useAtom(websocketStateAtom);
  const [, setWebsocket] = useAtom(websocketAtom);

  const reconnectTimeout = useRef<NodeJS.Timer | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;

    const connect = () => {
      console.log('Opening ws connection...');
      if (process.env.NEXT_PUBLIC_WS_ENDPOINT === undefined) {
        throw new Error("NEXT_PUBLIC_WS_ENDPOINT isn't defined");
      }

      ws = new WebSocket(process.env.NEXT_PUBLIC_WS_ENDPOINT);

      ws.onmessage = function incoming(data) {
        const msg: WebSocketResponse = JSON.parse(data.data as string);
        setState(msg.State);
      };

      ws.onclose = () => {
        reconnectTimeout.current = setTimeout(connect, 1000);
      };

      setWebsocket(ws);
    };

    connect();

    return () => {
      if (reconnectTimeout.current !== null) {
        clearTimeout(reconnectTimeout.current);
      }

      if (ws !== null) {
        console.log('Closing ws connection');
        ws.onclose = null;
        ws.close();
      }
    };
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
