'use client';

import { atom, useAtom } from 'jotai';

const getIsFullscreen = () => {
  if (typeof window !== 'undefined') {
    return document.fullscreenElement !== null;
  }

  return false;
};

const fullscreenAtom = atom<boolean>(getIsFullscreen());

export const useIsFullscreen = () => {
  const [state, setState] = useAtom(fullscreenAtom);
  return [state, setState] as const;
};
