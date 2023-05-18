'use client';

import { StateUpdate } from '@/bindings/StateUpdate';
import { WebSocketResponse } from '@/bindings/WebSocketResponse';
import { useEffect, useRef } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useAppConfig } from './appConfig';

const websocketStateAtom = atom<StateUpdate | null>(null);
const websocketAtom = atom<WebSocket | null>(null);

export const useProvideWebsocketState = () => {
  const wsEndpoint = useAppConfig().wsEndpoint;
  const setState = useSetAtom(websocketStateAtom);
  const setWebsocket = useSetAtom(websocketAtom);

  const reconnectTimeout = useRef<NodeJS.Timer | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;

    const connect = () => {
      console.log('Opening ws connection...');

      if (wsEndpoint === undefined) {
        throw new Error("WS_ENDPOINT isn't defined");
      }

      ws = new WebSocket(wsEndpoint);

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
  }, [setState, setWebsocket, wsEndpoint]);
};

export const useWebsocketState = (): StateUpdate | null => {
  const state = useAtomValue(websocketStateAtom);
  return state;
};

export const useWebsocket = (): WebSocket | null => {
  const state = useAtomValue(websocketAtom);
  return state;
};
