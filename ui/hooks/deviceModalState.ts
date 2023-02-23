'use client';

import { Device } from '@/bindings/Device';
import { atom, useAtom } from 'jotai';

const deviceModalAtom = atom<Device | null>(null);
const deviceModalOpenAtom = atom<boolean>(false);

export const useDeviceModalState = () => {
  const [state, setState] = useAtom(deviceModalAtom);
  const [open, setOpen] = useAtom(deviceModalOpenAtom);
  return { state, setState, open, setOpen } as const;
};
