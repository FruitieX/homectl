import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

type CachedItem<T> = {
  item: T;
  validUntil: Date;
};

// In-memory cache for server-side caching
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, CachedItem<any>>();

// Disk cache directory
const CACHE_DIR = path.join(os.tmpdir(), 'homectl-cache');

// Ensure cache directory exists
const ensureCacheDir = async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
  }
};

// Get cache file path for a key
const getCacheFilePath = (key: string) => {
  // Replace invalid filename characters with underscores
  const safeKey = key.replace(/[<>:"/\\|?*]/g, '_');
  return path.join(CACHE_DIR, `${safeKey}.json`);
};

// Read from disk cache
const readFromDisk = async <T>(key: string): Promise<CachedItem<T> | null> => {
  try {
    const filePath = getCacheFilePath(key);
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      item: parsed.item,
      validUntil: new Date(parsed.validUntil),
    };
  } catch (error) {
    // File doesn't exist or is invalid, return null
    return null;
  }
};

// Write to disk cache
const writeToDisk = async <T>(key: string, cachedItem: CachedItem<T>) => {
  try {
    await ensureCacheDir();
    const filePath = getCacheFilePath(key);
    const data = JSON.stringify({
      item: cachedItem.item,
      validUntil: cachedItem.validUntil.toISOString(),
    });
    await fs.writeFile(filePath, data, 'utf-8');
  } catch (error) {
    // Ignore disk write errors, fallback to memory cache only
    console.warn('Failed to write to disk cache:', error);
  }
};

// Delete from disk cache
const deleteFromDisk = async (key: string) => {
  try {
    const filePath = getCacheFilePath(key);
    await fs.unlink(filePath);
  } catch (error) {
    // File might not exist, ignore error
  }
};

export const serverCache = {
  async get<T>(
    key: string,
    cacheTimeMinutes: number,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const now = new Date();

    // Check in-memory cache first
    const cached = cache.get(key);
    if (cached && cached.validUntil > now) {
      // console.log('using memory cache for', key);
      return cached.item as T;
    }

    // Check disk cache if memory cache miss
    const diskCached = await readFromDisk<T>(key);
    if (diskCached && diskCached.validUntil > now) {
      // console.log('using disk cache for', key);
      // Store back in memory cache for faster access
      cache.set(key, diskCached);
      return diskCached.item;
    }

    // Fetch new data if both caches miss or expired
    // console.log('fetching new data for', key);
    const item = await fetchFn();
    const validUntil = new Date(
      new Date().getTime() + cacheTimeMinutes * 60 * 1000,
    );

    const cachedItem = {
      item,
      validUntil,
    };

    // Store in both memory and disk cache
    cache.set(key, cachedItem);
    await writeToDisk(key, cachedItem);

    return item;
  },

  async clear(key?: string) {
    if (key) {
      cache.delete(key);
      await deleteFromDisk(key);
    } else {
      cache.clear();
      // Clear all disk cache files
      try {
        const files = await fs.readdir(CACHE_DIR);
        await Promise.all(
          files.map((file) => fs.unlink(path.join(CACHE_DIR, file))),
        );
      } catch (error) {
        // Directory might not exist, ignore error
      }
    }
  },

  // Clean up expired entries from both memory and disk
  async cleanup() {
    const now = new Date();

    // Clean up memory cache
    for (const [key, item] of cache.entries()) {
      if (item.validUntil <= now) {
        cache.delete(key);
      }
    }

    // Clean up disk cache
    try {
      const files = await fs.readdir(CACHE_DIR);
      await Promise.all(
        files.map(async (file) => {
          if (file.endsWith('.json')) {
            const filePath = path.join(CACHE_DIR, file);
            try {
              const data = await fs.readFile(filePath, 'utf-8');
              const parsed = JSON.parse(data);
              const validUntil = new Date(parsed.validUntil);
              if (validUntil <= now) {
                await fs.unlink(filePath);
              }
            } catch (error) {
              // Invalid file, delete it
              await fs.unlink(filePath);
            }
          }
        }),
      );
    } catch (error) {
      // Directory might not exist, ignore error
    }
  },
};

// Clean up expired entries every 10 minutes
setInterval(
  async () => {
    await serverCache.cleanup();
  },
  10 * 60 * 1000,
);
