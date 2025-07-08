type CachedItem<T> = {
  item: T;
  validUntil: Date;
};

// In-memory cache for server-side caching
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, CachedItem<any>>();

export const serverCache = {
  async get<T>(
    key: string,
    cacheTimeMinutes: number,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const cached = cache.get(key);

    if (cached && cached.validUntil > new Date()) {
      // console.log('using server cache for', key);
      return cached.item as T;
    } else {
      // console.log('not using server cache for', key);
      const item = await fetchFn();
      const validUntil = new Date(
        new Date().getTime() + cacheTimeMinutes * 60 * 1000,
      );

      cache.set(key, {
        item,
        validUntil,
      });

      return item;
    }
  },

  clear(key?: string) {
    if (key) {
      cache.delete(key);
    } else {
      cache.clear();
    }
  },

  // Clean up expired entries
  cleanup() {
    const now = new Date();
    for (const [key, item] of cache.entries()) {
      if (item.validUntil <= now) {
        cache.delete(key);
      }
    }
  },
};

// Clean up expired entries every 10 minutes
setInterval(
  () => {
    serverCache.cleanup();
  },
  10 * 60 * 1000,
);
