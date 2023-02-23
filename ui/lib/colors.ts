import { DeviceState } from '@/bindings/DeviceState';
import Color from 'color';

export const black = Color("black");
export const white = Color("white");
export const getColor = (deviceState: DeviceState): Color => {
  let color = black;

  if ('Light' in deviceState) {
    if (deviceState.Light.color !== null && 'Hsv' in deviceState.Light.color) {
      const hsv = deviceState.Light.color.Hsv;
      color = Color({
        h: hsv.hue,
        s: hsv.saturation * 100,
        v: hsv.value * 100,
      });
    } else {
      if (deviceState.Light.power) {
        return white;
      } else {
        return black;
      }
    }
  }

  return color;
};
