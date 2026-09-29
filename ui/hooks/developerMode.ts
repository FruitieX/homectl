import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

const developerModeAtom = atomWithStorage<boolean>(
  'homectl-developer-mode',
  false,
  undefined,
  { getOnInit: true },
);

export const useDeveloperMode = () => useAtom(developerModeAtom);
