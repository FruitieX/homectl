import { Device } from '@/bindings/Device';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket } from '@/hooks/websocket';
import Color from 'color';
import { produce } from 'immer';
import { useCallback } from 'react';

export const useSetDeviceColor = () => {
  const ws = useWebsocket();
  const setDeviceColor = useCallback(
    (
      clickedDevice: Device,
      color: Color,
      brightness?: number,
      transitionMs?: number,
    ) => {
      const device = produce(clickedDevice, (draft) => {
        if ('Controllable' in draft.data) {
          const hsv = color.hsv();
          draft.data.Controllable.state.color = {
            h: Math.round(hsv.hue()),
            s: hsv.saturationv() / 100,
          };

          draft.data.Controllable.scene_id = null;

          if (brightness !== undefined) {
            draft.data.Controllable.state.brightness = brightness;
          }

          if (transitionMs !== undefined) {
            draft.data.Controllable.state.transition_ms = transitionMs;
          }
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

  return setDeviceColor;
};
