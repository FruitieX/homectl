import { Device } from '@/bindings/Device';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket } from '@/hooks/websocket';
import Color from 'color';
import { produce } from 'immer';
import { useCallback } from 'react';

export const useSetDeviceState = () => {
  const ws = useWebsocket();
  const setDeviceColor = useCallback(
    (
      clickedDevice: Device,
      power: boolean,
      color?: Color,
      brightness?: number,
      transition?: number,
    ) => {
      const device = produce(clickedDevice, (draft) => {
        if ('Controllable' in draft.data) {
          draft.data.Controllable.scene_id = null;
          draft.data.Controllable.state.power = power;

          if (color !== undefined) {
            const hsv = color.hsv();
            draft.data.Controllable.state.color = {
              h: Math.round(hsv.hue()),
              s: hsv.saturationv() / 100,
            };
          }

          if (brightness !== undefined) {
            draft.data.Controllable.state.brightness = brightness;
          }

          if (transition !== undefined) {
            draft.data.Controllable.state.transition = transition;
          }
        }
      });

      const msg: WebSocketRequest = {
        EventMessage: {
          SetInternalState: { device, skip_external_update: false },
        },
      };
      ws?.send(JSON.stringify(msg));
    },
    [ws],
  );

  return setDeviceColor;
};
