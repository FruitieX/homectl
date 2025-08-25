'use client';

import { atom, useAtom } from 'jotai';

const baseAtom = atom<string[]>([]);
const toggleSelectedDeviceAtom = atom(
  null,
  (_get, set, deviceKey: string, selected?: boolean) => {
    set(baseAtom, (prev) => {
      const result = [...prev];
      const existingIndex = result.findIndex((d) => {
        return d === deviceKey;
      });

      if (existingIndex !== -1 && selected !== false) {
        result.splice(existingIndex, 1);
      } else if (selected !== true) {
        result.push(deviceKey);
      }
      return result;
    });
  },
);

export const useSelectedDevices = () => {
  const [state, setState] = useAtom(baseAtom);
  return [state, setState] as const;
};

export const useToggleSelectedDevice = () => {
  const [, toggle] = useAtom(toggleSelectedDeviceAtom);
  return toggle;
};
