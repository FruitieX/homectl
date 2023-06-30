'use client';

import { atom, useAtom } from 'jotai';

const pastedImageAtom = atom<HTMLImageElement | null>(null);

export const usePastedImage = () => {
  const [state, setState] = useAtom(pastedImageAtom);
  return [state, setState] as const;
};
