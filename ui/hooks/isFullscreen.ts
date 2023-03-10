
'use client';

import { atom, useAtom } from 'jotai';
import Color from 'color';

const fullscreenAtom = atom<boolean>(document.fullscreenElement !== null);

export const useIsFullscreen = () => {
  const [state, setState] = useAtom(fullscreenAtom);
  return [state, setState] as const;
};
