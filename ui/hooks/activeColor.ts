import { atom, useAtom } from 'jotai';
import Color, { type ColorInstance } from 'color';

type Color = ColorInstance;

const activeColorAtom = atom<Color | null>(null);

export const useActiveColor = () => {
  const [state, setState] = useAtom(activeColorAtom);
  return [state, setState] as const;
};
