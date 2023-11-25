import { Device } from '@/bindings/Device';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket } from '@/hooks/websocket';
import { produce } from 'immer';
import { useCallback } from 'react';

export const useSetDevicePower = () => {
  const ws = useWebsocket();
  const setDevicePower = useCallback(
    (clickedDevice: Device, power: boolean) => {
      const device = produce(clickedDevice, (draft) => {
        if ('Controllable' in draft.data) {
          draft.data.Controllable.state.power = power;
          draft.data.Controllable.scene = null;
        }
      });

      const msg: WebSocketRequest = {
        Message: {
          SetExpectedState: { device, set_scene: true, skip_send: false },
        },
      };
      ws?.send(JSON.stringify(msg));
    },
    [ws],
  );

  return setDevicePower;
};
