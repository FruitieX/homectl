import { DeviceData } from '@/bindings/DeviceData';
import Color from 'color';

export const black = Color('black');
export const white = Color('white');
export const getColor = (data: DeviceData): Color => {
  let color = black;

  if ('Controllable' in data) {
    if (
      data.Controllable.state.color !== null &&
      'h' in data.Controllable.state.color &&
      's' in data.Controllable.state.color
    ) {
      color = Color({
        h: data.Controllable.state.color.h,
        s: data.Controllable.state.color.s * 100,
        v: 100,
      });
    } else {
      if (data.Controllable.state.power) {
        return white;
      } else {
        return black;
      }
    }
  }

  return color;
};

export const getBrightness = (data: DeviceData): number => {
  if ('Controllable' in data) {
    if (data.Controllable.state.brightness !== null) {
      return data.Controllable.state.brightness;
    } else {
      if (data.Controllable.state.power) {
        return 1;
      } else {
        return 0;
      }
    }
  }

  return 0;
};

export const getPower = (data: DeviceData): boolean => {
  if ('Controllable' in data) {
    return data.Controllable.state.power;
  }

  return false;
};
