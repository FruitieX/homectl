'use client';

import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

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

const fullscreenAtom = atomWithStorage<boolean>(
  'fullscreen',
  getIsFullscreen(),
);

export const useIsFullscreen = () => {
  const [state, setState] = useAtom(fullscreenAtom);
  return [state, setState] as const;
};
