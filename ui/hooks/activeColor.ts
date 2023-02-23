'use client';

import { atom, useAtom } from 'jotai';
import Color from 'color';

const activeColorAtom = atom<Color | null>(null);

export const useActiveColor = () => {
  const [state, setState] = useAtom(activeColorAtom);
  return [state, setState] as const;
};
