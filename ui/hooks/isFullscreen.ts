'use client';

import { atom, useAtom } from 'jotai';

const getIsFullscreen = () => {
  if (typeof window !== 'undefined') {
    // iOS Safari fix
    if (document.fullscreenElement === undefined) {
      return false;
    }

    return document.fullscreenElement !== null;
  }

  return false;
};

const fullscreenAtom = atom<boolean>(getIsFullscreen());

export const useIsFullscreen = () => {
  const [state, setState] = useAtom(fullscreenAtom);
  return [state, setState] as const;
};
