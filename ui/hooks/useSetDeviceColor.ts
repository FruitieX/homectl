import { Device } from '@/bindings/Device';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket } from '@/hooks/websocket';
import Color from 'color';
import produce from 'immer';
import { useCallback } from 'react';

export const useSetDeviceColor = () => {
  const ws = useWebsocket();
  const setDeviceColor = useCallback(
    (clickedDevice: Device, color: Color, brightness: number) => {
      const device = produce(clickedDevice, (draft) => {
        if ('Light' in draft.state) {
          const hsv = color.hsv();
          draft.state.Light.color = {
            Hsv: {
              hue: hsv.hue(),
              saturation: hsv.saturationv() / 100,
              value: hsv.value() / 100,
            },
          };
          draft.state.Light.brightness = brightness;
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

  return setDeviceColor;
};
