'use client';

import { atom, useAtom } from 'jotai';

const sceneModalOpenAtom = atom<boolean>(false);

export const useSceneModalState = () => {
  const [open, setOpen] = useAtom(sceneModalOpenAtom);
  return { open, setOpen } as const;
};
