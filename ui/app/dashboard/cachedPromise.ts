type CachedItem<T> = {
  item: T;
  validUntil: string;
};

export const cachedPromise = async <T>(
  key: string,
  cacheTimeMinutes: number,
  promise: () => Promise<T>,
): Promise<T> => {
  const cached = localStorage.getItem(key);
  const json = cached !== null ? (JSON.parse(cached) as CachedItem<T>) : null;

  if (json !== null && new Date(json.validUntil) > new Date()) {
    // console.log('using cache for', key);
    return json.item;
  } else {
    // console.log('not using cache for', key);
    const item = await promise();
    const validUntil = new Date(
      new Date().getTime() + cacheTimeMinutes * 60 * 1000,
    ).toISOString();
    const value: CachedItem<T> = {
      item,
      validUntil,
    };
    localStorage.setItem(key, JSON.stringify(value));

    return item;
  }
};
