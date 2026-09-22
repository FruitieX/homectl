import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useCallback, useEffect } from 'react';

import {
  type Accent,
  type Density,
  isFavoriteKey,
  pushRecent,
  toggleFavoriteKey,
} from '@/lib/preferences';

export const densityAtom = atomWithStorage<Density>(
  'homectl-density',
  'comfortable',
);

export const accentAtom = atomWithStorage<Accent>('homectl-accent', 'emerald');

export const favoritesAtom = atomWithStorage<string[]>('homectl-favorites', []);

export const recentsAtom = atomWithStorage<string[]>('homectl-recents', []);

export const favoriteKeysAtom = atom((get) => new Set(get(favoritesAtom)));

export const useFavorites = () => {
  const [favorites, setFavorites] = useAtom(favoritesAtom);

  const toggleFavorite = useCallback(
    (key: string) => {
      setFavorites((current) => toggleFavoriteKey(current, key));
    },
    [setFavorites],
  );

  const isFavorite = useCallback(
    (key: string) => isFavoriteKey(favorites, key),
    [favorites],
  );

  return { favorites, toggleFavorite, isFavorite };
};

export const useRecents = () => {
  const [recents, setRecents] = useAtom(recentsAtom);

  const recordRecent = useCallback(
    (key: string) => {
      setRecents((current) => pushRecent(current, key));
    },
    [setRecents],
  );

  return { recents, recordRecent };
};

export const useRecordRecent = () => {
  const setRecents = useSetAtom(recentsAtom);
  return useCallback(
    (key: string) => {
      setRecents((current) => pushRecent(current, key));
    },
    [setRecents],
  );
};

export const useFavoriteKeys = () => useAtomValue(favoriteKeysAtom);

export const useApplyAppearance = () => {
  const density = useAtomValue(densityAtom);
  const accent = useAtomValue(accentAtom);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = density;
    root.dataset.accent = accent;
  }, [density, accent]);
};
