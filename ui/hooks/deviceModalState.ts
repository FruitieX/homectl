import { atom, useAtom } from 'jotai';

const deviceModalAtom = atom<string[]>([]);
const deviceModalOpenAtom = atom<boolean>(false);
const deviceModalSelectingAtom = atom<boolean>(false);
const deviceModalPresentationAtom = atom<'dialog' | 'sidepanel' | 'floorplan'>(
  'dialog',
);

export const useDeviceModalState = () => {
  const [state, setState] = useAtom(deviceModalAtom);
  const [open, setOpen] = useAtom(deviceModalOpenAtom);
  const [selecting, setSelecting] = useAtom(deviceModalSelectingAtom);
  const [presentation, setPresentation] = useAtom(deviceModalPresentationAtom);
  return {
    state,
    setState,
    open,
    setOpen,
    selecting,
    setSelecting,
    presentation,
    setPresentation,
  } as const;
};
