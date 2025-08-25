'use client';

import { atom, useAtom } from 'jotai';

const saveSceneModalOpenAtom = atom<boolean>(false);

export const useSaveSceneModalState = () => {
  const [open, setOpen] = useAtom(saveSceneModalOpenAtom);
  return { open, setOpen } as const;
};
