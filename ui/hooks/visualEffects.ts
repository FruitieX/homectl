import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useEffect } from 'react';

const backdropBlurEffectsAtom = atomWithStorage<boolean>(
  'homectl-backdrop-blur-effects',
  true,
);

const noBackdropBlurClassName = 'homectl-disable-backdrop-blur';

const applyBackdropBlurEffects = (enabled: boolean) => {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.toggle(
    noBackdropBlurClassName,
    !enabled,
  );
};

export const useBackdropBlurEffects = () => {
  return useAtom(backdropBlurEffectsAtom);
};

export const useApplyBackdropBlurEffects = () => {
  const [enabled] = useAtom(backdropBlurEffectsAtom);

  useEffect(() => {
    applyBackdropBlurEffects(enabled);
  }, [enabled]);
};
