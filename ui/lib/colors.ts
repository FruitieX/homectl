import { DeviceData } from '@/bindings/DeviceData';
import Color from 'color';

export const black = Color('black');
export const white = Color('white');
export const getColor = (data: DeviceData): Color => {
  let color = black;

  if ('Managed' in data) {
    if (
      data.Managed.state.color !== null &&
      'h' in data.Managed.state.color &&
      's' in data.Managed.state.color
    ) {
      color = Color({
        h: data.Managed.state.color.h,
        s: data.Managed.state.color.s * 100,
        v: 100,
      });
    } else {
      if (data.Managed.state.power) {
        return white;
      } else {
        return black;
      }
    }
  }

  return color;
};

export const getBrightness = (data: DeviceData): number => {
  if ('Managed' in data) {
    if (data.Managed.state.brightness !== null) {
      return data.Managed.state.brightness;
    } else {
      if (data.Managed.state.power) {
        return 1;
      } else {
        return 0;
      }
    }
  }

  return 0;
};

export const getPower = (data: DeviceData): boolean => {
  if ('Managed' in data) {
    return data.Managed.state.power;
  }

  return false;
};
