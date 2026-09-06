import { atom, useAtom } from 'jotai';

const deviceModalAtom = atom<string[]>([]);
const deviceModalOpenAtom = atom<boolean>(false);
const deviceModalPresentationAtom = atom<'dialog' | 'sidepanel'>('dialog');

export const useDeviceModalState = () => {
  const [state, setState] = useAtom(deviceModalAtom);
  const [open, setOpen] = useAtom(deviceModalOpenAtom);
  const [presentation, setPresentation] = useAtom(deviceModalPresentationAtom);
  return { state, setState, open, setOpen, presentation, setPresentation } as const;
};
