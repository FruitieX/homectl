import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREATION_DRAFT_VERSION,
  clearCreationDraft,
  containsSecretLikeKey,
  creationDraftKey,
  describeDraftAge,
  loadCreationDraft,
  saveCreationDraft,
} from './creationDraft.ts';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    size: () => store.size,
  };
}

test('a draft round-trips through sessionStorage', () => {
  const storage = memoryStorage();
  assert.equal(
    saveCreationDraft('routine', { id: 'evening', steps: [1, 2] }, storage),
    true,
  );
  const loaded = loadCreationDraft<{ id: string; steps: number[] }>(
    'routine',
    storage,
  );
  assert.deepEqual(loaded?.payload, { id: 'evening', steps: [1, 2] });
  clearCreationDraft('routine', storage);
  assert.equal(loadCreationDraft('routine', storage), null);
});

test('payloads that look like credentials are refused and never read back', () => {
  const storage = memoryStorage();
  assert.equal(
    saveCreationDraft('scene', { name: 'x', apiKey: 'sk-live-123' }, storage),
    false,
  );
  assert.equal(storage.size(), 0);
  // Even a payload written by an older build is not restored.
  storage.setItem(
    creationDraftKey('scene'),
    JSON.stringify({
      version: CREATION_DRAFT_VERSION,
      kind: 'scene',
      savedAt: Date.now(),
      payload: { nested: { refresh_token: 'abc' } },
    }),
  );
  assert.equal(loadCreationDraft('scene', storage), null);
  assert.equal(containsSecretLikeKey({ a: { b: [{ password: 'x' }] } }), true);
  assert.equal(
    containsSecretLikeKey({ name: 'kitchen', brightness: 0.4 }),
    false,
  );
});

test('a draft from another version or another kind is ignored', () => {
  const storage = memoryStorage();
  storage.setItem(
    creationDraftKey('routine'),
    JSON.stringify({
      version: CREATION_DRAFT_VERSION + 1,
      kind: 'routine',
      savedAt: Date.now(),
      payload: { id: 'old' },
    }),
  );
  assert.equal(loadCreationDraft('routine', storage), null);
  storage.setItem(
    creationDraftKey('routine'),
    JSON.stringify({
      version: CREATION_DRAFT_VERSION,
      kind: 'scene',
      savedAt: Date.now(),
      payload: { id: 'mislabeled' },
    }),
  );
  assert.equal(loadCreationDraft('routine', storage), null);
  storage.setItem(creationDraftKey('routine'), 'not json');
  assert.equal(loadCreationDraft('routine', storage), null);
});

test('no storage at all is survivable', () => {
  assert.equal(saveCreationDraft('scene', { name: 'x' }, undefined), false);
  assert.equal(loadCreationDraft('scene', undefined), null);
  assert.doesNotThrow(() => clearCreationDraft('scene', undefined));
});

test('draft age reads in plain language', () => {
  const now = 10_000_000;
  assert.equal(describeDraftAge(now - 5_000, now), 'just now');
  assert.equal(describeDraftAge(now - 3 * 60_000, now), '3 minutes ago');
  assert.equal(describeDraftAge(now - 60 * 60_000, now), '1 hour ago');
});
