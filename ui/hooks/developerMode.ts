import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

const developerModeAtom = atomWithStorage<boolean>(
  'homectl-developer-mode',
  false,
);

export const useDeveloperMode = () => useAtom(developerModeAtom);
