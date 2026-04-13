import { DeviceData } from '@/bindings/DeviceData';
import Color from 'color';

export const black = Color('black');
export const white = Color('white');

type StatefulColorPayload = {
  power: boolean;
  brightness: number | null;
  color:
    | { h: number; s: number }
    | { x: number; y: number }
    | { r: number; g: number; b: number }
    | { ct: number }
    | null;
};

export type ResolvedDeviceColorState = {
  brightness: number;
  color: Color;
  power: boolean;
};

function isStatefulColorPayload(value: unknown): value is StatefulColorPayload {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'power' in value &&
      typeof value.power === 'boolean' &&
      'brightness' in value &&
      'color' in value,
  );
}

function getStatefulColorPayload(data: DeviceData): StatefulColorPayload | null {
  if ('Controllable' in data) {
    return data.Controllable.state;
  }

  if ('Sensor' in data && isStatefulColorPayload(data.Sensor)) {
    return data.Sensor;
  }

  return null;
}

function getColorFromPayload(
  color: StatefulColorPayload['color'],
): Color | null {
  if (!color) {
    return null;
  }

  if ('h' in color && 's' in color) {
    return Color({
      h: color.h,
      s: color.s * 100,
      v: 100,
    });
  }

  if ('r' in color && 'g' in color && 'b' in color) {
    return Color.rgb(color.r, color.g, color.b);
  }

  if ('ct' in color) {
    const normalized = Math.max(0, Math.min(1, (color.ct - 153) / (500 - 153)));
    return Color.rgb(
      Math.round(255 - normalized * 55),
      Math.round(240 - normalized * 30),
      Math.round(200 + normalized * 55),
    );
  }

  if ('x' in color && 'y' in color) {
    const safeY = color.y === 0 ? 0.0001 : color.y;
    const z = 1 - color.x - color.y;
    const linearX = (1 / safeY) * color.x;
    const linearZ = (1 / safeY) * z;

    let red = linearX * 1.656492 - 0.354851 - linearZ * 0.255038;
    let green = -linearX * 0.707196 + 1.655397 + linearZ * 0.036152;
    let blue = linearX * 0.051713 - 0.121364 + linearZ * 1.01153;

    red = red <= 0.0031308 ? 12.92 * red : 1.055 * Math.pow(red, 1 / 2.4) - 0.055;
    green = green <= 0.0031308 ? 12.92 * green : 1.055 * Math.pow(green, 1 / 2.4) - 0.055;
    blue = blue <= 0.0031308 ? 12.92 * blue : 1.055 * Math.pow(blue, 1 / 2.4) - 0.055;

    const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));

    return Color.rgb(clamp(red), clamp(green), clamp(blue));
  }

  return null;
}

export const getResolvedDeviceColorState = (
  data: DeviceData,
): ResolvedDeviceColorState | null => {
  const payload = getStatefulColorPayload(data);
  if (!payload) {
    return null;
  }

  const brightness = payload.brightness ?? (payload.power ? 1 : 0);

  return {
    brightness,
    color: getColorFromPayload(payload.color) ?? (payload.power || brightness > 0 ? white : black),
    power: payload.power,
  };
};

export const getColor = (data: DeviceData): Color =>
  getResolvedDeviceColorState(data)?.color ?? black;

export const getBrightness = (data: DeviceData): number =>
  getResolvedDeviceColorState(data)?.brightness ?? 0;

export const getPower = (data: DeviceData): boolean =>
  getResolvedDeviceColorState(data)?.power ?? false;
