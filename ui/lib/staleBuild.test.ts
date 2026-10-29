import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RELOAD_GUARD_MS,
  isStaleBuildError,
  staleBuildReloadDelay,
} from './staleBuild.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test('recognises failed chunk loads in each browser', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://homectl/assets/page-mM2Gh7AM.js',
    'error loading dynamically imported module: https://homectl/assets/page.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/index.css',
  ]) {
    assert.equal(isStaleBuildError(new Error(message)), true, message);
  }
  assert.equal(isStaleBuildError(new Error('Cannot read properties of undefined')), false);
  assert.equal(isStaleBuildError(undefined), false);
});

test('reloads at once, then at most once per guard window', () => {
  const storage = memoryStorage();
  assert.equal(staleBuildReloadDelay(storage, 1_000_000), 0);
  // The reloaded page fails again 5 s later: wait out the rest of the window.
  assert.equal(staleBuildReloadDelay(storage, 1_005_000), RELOAD_GUARD_MS - 5_000);
  // Long after the last scheduled reload, a new deploy reloads at once.
  assert.equal(staleBuildReloadDelay(storage, 1_000_000 + 10 * RELOAD_GUARD_MS), 0);
});

test('works without storage', () => {
  assert.equal(staleBuildReloadDelay(undefined, 1_000_000), 0);
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(staleBuildReloadDelay(broken, 1_000_000), 0);
});
