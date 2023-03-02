'use client';

import { SceneId } from '@/bindings/SceneId';
import { atom, useAtom } from 'jotai';

const sceneModalOpenAtom = atom<boolean>(false);
const sceneModalStateAtom = atom<SceneId | null>(null);

export const useSceneModalState = () => {
  const [open, setOpen] = useAtom(sceneModalOpenAtom);
  const [state, setState] = useAtom(sceneModalStateAtom);
  return { open, setOpen, state, setState } as const;
};
