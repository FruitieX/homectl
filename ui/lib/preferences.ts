export type Density = 'comfortable' | 'compact';

export type Accent = 'emerald' | 'indigo' | 'sky' | 'amber' | 'rose';

export const densities: Density[] = ['comfortable', 'compact'];

export const accents: { id: Accent; label: string; swatch: string }[] = [
  { id: 'emerald', label: 'Emerald', swatch: 'hsl(159 52% 28%)' },
  { id: 'indigo', label: 'Indigo', swatch: 'hsl(243 58% 45%)' },
  { id: 'sky', label: 'Sky', swatch: 'hsl(199 80% 38%)' },
  { id: 'amber', label: 'Amber', swatch: 'hsl(32 85% 40%)' },
  { id: 'rose', label: 'Rose', swatch: 'hsl(343 65% 45%)' },
];

export function pushRecent(list: string[], key: string, max = 8): string[] {
  const next = [key, ...list.filter((entry) => entry !== key)];
  return next.slice(0, max);
}

export function toggleFavoriteKey(list: string[], key: string): string[] {
  return list.includes(key)
    ? list.filter((entry) => entry !== key)
    : [key, ...list];
}

export function isFavoriteKey(list: string[], key: string): boolean {
  return list.includes(key);
}

/**
 * Ranks items by favorites first, then recents, then the original order.
 * Keys are compared through `keyOf` so callers can rank entities by id.
 */
export function rankByPreference<T>(
  items: T[],
  keyOf: (item: T) => string,
  favorites: string[],
  recents: string[],
): T[] {
  const favoriteRank = new Map(
    favorites.map((key, index) => [key, index] as const),
  );
  const recentRank = new Map(
    recents.map((key, index) => [key, index] as const),
  );

  return items
    .map((item, index) => ({ item, index, key: keyOf(item) }))
    .sort((a, b) => {
      const aFavorite = favoriteRank.get(a.key);
      const bFavorite = favoriteRank.get(b.key);
      if (aFavorite !== undefined || bFavorite !== undefined) {
        if (aFavorite === undefined) return 1;
        if (bFavorite === undefined) return -1;
        return aFavorite - bFavorite;
      }

      const aRecent = recentRank.get(a.key);
      const bRecent = recentRank.get(b.key);
      if (aRecent !== undefined || bRecent !== undefined) {
        if (aRecent === undefined) return 1;
        if (bRecent === undefined) return -1;
        return aRecent - bRecent;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
