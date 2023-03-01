'use client';

import { atom, useAtom } from 'jotai';

const baseAtom = atom<string[]>([]);
const toggleSelectedDeviceAtom = atom(null, (_get, set, deviceKey: string) => {
  set(baseAtom, (prev) => {
    const result = [...prev];
    const existingIndex = result.findIndex((d) => {
      return d === deviceKey;
    });

    if (existingIndex !== -1) {
      result.splice(existingIndex, 1);
    } else {
      result.push(deviceKey);
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
