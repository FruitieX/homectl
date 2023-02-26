'use client';

import { atom, useAtom } from 'jotai';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';

const baseAtom = atom<Device[]>([]);
const toggleSelectedDeviceAtom = atom(null, (_get, set, device: Device) => {
  set(baseAtom, (prev) => {
    const result = [...prev];
    const existingIndex = result.findIndex((d) => {
      return getDeviceKey(d) === getDeviceKey(device);
    });
    console.log(existingIndex);
    if (existingIndex !== -1) {
      result.splice(existingIndex, 1);
    } else {
      result.push(device);
    }
    return result;
  });
});

export const useSelectedDevices = () => {
  const [state, setState] = useAtom(baseAtom);
  return [state, setState] as const;
};

export const useToggleSelectedDevice = () => {
  const [, toggle] = useAtom(toggleSelectedDeviceAtom);
  return toggle;
};
