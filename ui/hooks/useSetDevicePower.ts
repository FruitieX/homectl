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
          draft.data.Controllable.scene_id = null;
        }
      });

      const msg: WebSocketRequest = {
        Message: {
          SetInternalState: { device, skip_external_update: false },
        },
      };
      ws?.send(JSON.stringify(msg));
    },
    [ws],
  );

  return setDevicePower;
};
