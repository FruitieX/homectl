import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  pushRecent,
  rankByPreference,
  toggleFavoriteKey,
} from './preferences.ts';

test('pushRecent dedupes, prepends, and bounds the list', () => {
  assert.deepEqual(pushRecent(['a', 'b'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(pushRecent(['a', 'b'], 'a'), ['a', 'b']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'c', 2), ['c', 'a']);
});

test('toggleFavoriteKey adds and removes keys', () => {
  assert.deepEqual(toggleFavoriteKey(['a'], 'b'), ['b', 'a']);
  assert.deepEqual(toggleFavoriteKey(['a', 'b'], 'a'), ['b']);
});

test('rankByPreference orders favorites, then recents, then original', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const ranked = rankByPreference(items, (item) => item.id, ['c'], ['b', 'd']);
  assert.deepEqual(
    ranked.map((item) => item.id),
    ['c', 'b', 'd', 'a'],
  );
});

test('rankByPreference keeps original order without preferences', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(
    rankByPreference(items, (item) => item.id, [], []),
    items,
  );
});
