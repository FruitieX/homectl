import { Device } from '@/bindings/Device';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket } from '@/hooks/websocket';
import Color from 'color';
import { produce } from 'immer';
import { useCallback } from 'react';

export const useSetDeviceColor = () => {
  const ws = useWebsocket();
  const setDeviceColor = useCallback(
    (clickedDevice: Device, color: Color, brightness: number) => {
      const device = produce(clickedDevice, (draft) => {
        if ('Managed' in draft.data) {
          const hsv = color.hsv();
          draft.data.Managed.state.color = {
            h: Math.round(hsv.hue()),
            s: hsv.saturationv() / 100,
          };
          draft.data.Managed.state.brightness = brightness;
          draft.data.Managed.scene = null;
        }
      });

      const msg: WebSocketRequest = {
        Message: { SetDeviceState: { device, set_scene: true } },
      };
      ws?.send(JSON.stringify(msg));
    },
    [ws],
  );

  return setDeviceColor;
};
