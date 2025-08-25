'use client';

import { atom, useAtom } from 'jotai';

const activeColorModalAtom = atom<string | null>(null);

export const useActiveColorModalState = () => {
  const [state, setState] = useAtom(activeColorModalAtom);
  return [state, setState] as const;
};
