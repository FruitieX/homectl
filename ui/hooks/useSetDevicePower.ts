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
        if ('Light' in draft.state) {
          draft.state.Light.power = power;
          draft.scene = null;
        }
      });

      const msg: WebSocketRequest = {
        Message: { SetDeviceState: { device, set_scene: true } },
      };
      ws?.send(JSON.stringify(msg));
    },
    [ws],
  );

  return setDevicePower;
};
