/**
 * Recovery for tabs left open across a deploy. Each build has new hashed
 * chunk names and the server stops serving the old ones, so the first lazy
 * import an old tab makes fails with a 404. Wall displays never reload on
 * their own, so reload into the new build instead of showing an error.
 */

// Chrome, Firefox and Safari word the failed dynamic import differently.
const STALE_BUILD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
];

/** A reload sooner than this after the last one is a loop, not a new build. */
export const RELOAD_GUARD_MS = 60_000;

const STORAGE_KEY = 'homectl:stale-build-reload-at';

export function isStaleBuildError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return STALE_BUILD_PATTERNS.some((pattern) => pattern.test(message));
}

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Milliseconds to wait before reloading: 0 when the last stale-build reload
 * was long enough ago, otherwise the rest of the guard window. Records the
 * reload it allows, so a build that is genuinely broken retries once a minute
 * instead of reloading in a tight loop.
 */
export function staleBuildReloadDelay(
  storage: ReloadStorage | undefined,
  now: number,
): number {
  let last = 0;
  try {
    last = Number(storage?.getItem(STORAGE_KEY)) || 0;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  const delay = Math.max(0, last + RELOAD_GUARD_MS - now);
  try {
    storage?.setItem(STORAGE_KEY, String(now + delay));
  } catch {
    // Without storage the guard can't persist; the delay still applies.
  }
  return delay;
}

function sessionStore(): ReloadStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

let scheduled = false;

/** Schedules one reload into the current build per page load. */
export function reloadForNewBuild(): void {
  if (scheduled) return;
  scheduled = true;
  const delay = staleBuildReloadDelay(sessionStore(), Date.now());
  window.setTimeout(() => window.location.reload(), delay);
}
