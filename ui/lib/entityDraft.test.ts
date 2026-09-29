import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEntityDraftStore, changedDraftFields } from './entityDraft.ts';
const original = {
  name: 'Hall',
  hidden: false,
  members: ['a', 'b'],
  future: { preserved: true },
};
const meta = { href: '/config/groups/hall', label: 'Hall' };

test('draft retains all collections and unknown fields across background refreshes and discard', () => {
  const store = createEntityDraftStore();
  store.sync('hall', original, meta);
  store.change<typeof original>('hall', (value) => ({
    ...value,
    members: [...value.members, 'c'],
  }));
  store.sync('hall', { ...original, name: 'Hallway' }, meta);
  const draft = store.get<typeof original>('hall')!;
  assert.deepEqual(draft.value.members, ['a', 'b', 'c']);
  assert.deepEqual(draft.value.future, { preserved: true });
  assert.equal(draft.conflict, true);
  assert.equal(store.start('hall'), null);
  store.discard('hall');
  assert.equal(store.get<typeof original>('hall')!.value.name, 'Hallway');
  assert.equal(store.get('hall')!.dirty, false);
});

test('edits made while saving survive response normalization and a delayed response cannot clear newer work', () => {
  const store = createEntityDraftStore();
  store.sync('hall', original, meta);
  store.change<typeof original>('hall', (value) => ({
    ...value,
    name: 'First',
  }));
  const first = store.start<typeof original>('hall')!;
  store.change<typeof original>('hall', (value) => ({
    ...value,
    name: 'Second',
  }));
  store.saved('hall', first.generation, { ...first.value, name: 'FIRST' });
  assert.equal(store.get<typeof original>('hall')!.value.name, 'Second');
  assert.equal(store.get('hall')!.dirty, true);
  const second = store.start<typeof original>('hall')!;
  store.saved('hall', first.generation, original);
  assert.equal(store.get('hall')!.saving, true);
  store.saved('hall', second.generation, second.value);
  assert.equal(store.get('hall')!.dirty, false);
});

test('failed save retains draft and reviewed conflict choices preserve unrelated server changes', () => {
  const store = createEntityDraftStore();
  store.sync('hall', original, meta);
  store.change<typeof original>('hall', (value) => ({
    ...value,
    name: 'My name',
  }));
  const request = store.start<typeof original>('hall')!;
  store.failed('hall', request.generation, 'Changed elsewhere', {
    ...original,
    hidden: true,
    members: ['a', 'b', 'd'],
  });
  assert.deepEqual(changedDraftFields(store.get<typeof original>('hall')!), [
    'name',
  ]);
  store.rebase('hall', ['name']);
  const reviewed = store.get<typeof original>('hall')!;
  assert.equal(reviewed.value.name, 'My name');
  assert.equal(reviewed.value.hidden, true);
  assert.deepEqual(reviewed.value.members, ['a', 'b', 'd']);
  assert.equal(reviewed.conflict, false);
  assert.equal(reviewed.dirty, true);
});

test('inactive variants survive navigation and are discarded explicitly', () => {
  const store = createEntityDraftStore();
  store.sync('hall', original, meta);
  const explicit = { power: false, brightness: 0.7, future: true };
  const link = { scene_id: 'night' };
  assert.deepEqual(
    store.switchVariant<object>(
      'hall',
      'target',
      'state',
      explicit,
      'scene',
      link,
    ),
    link,
  );
  store.change('hall', { ...original, name: 'Unsaved' });
  store.sync('hall', original, meta);
  assert.deepEqual(
    store.switchVariant<object>('hall', 'target', 'scene', link, 'state', {}),
    explicit,
  );
  store.discard('hall');
  assert.deepEqual(
    store.switchVariant<object>('hall', 'target', 'scene', link, 'state', {}),
    {},
  );
});

test('nested conflict choices preserve remote siblings and treat arrays and variants as units', async () => {
  const { changedDraftPaths } = await import('./entityDraft.ts');
  const store = createEntityDraftStore();
  const base = {
    config: {
      name: 'Before',
      password: 'before',
      list: [{ id: 'one', name: 'Before' }],
      'a/b': { '~value': 1 },
    },
    program: { kind: 'native', steps: [] },
  };
  store.sync('nested', base, meta);
  store.change('nested', {
    ...base,
    config: { ...base.config, name: 'Mine', 'a/b': { '~value': 2 } },
  });
  store.sync(
    'nested',
    { ...base, config: { ...base.config, password: 'Changed remotely' } },
    meta,
  );
  const paths = changedDraftPaths(store.get('nested')!);
  assert.deepEqual(paths, ['/config/name', '/config/a~1b/~0value']);
  store.rebase('nested', paths);
  const value = store.get<typeof base>('nested')!.value;
  assert.equal(value.config.password, 'Changed remotely');
  assert.equal(value.config['a/b']['~value'], 2);
  assert.equal(value.config.name, 'Mine');
  store.sync('arrays', base, meta);
  store.change('arrays', {
    ...base,
    config: {
      ...base.config,
      list: [...base.config.list, { id: 'two', name: 'Added' }],
    },
    program: { kind: 'script', source: 'text' },
  });
  assert.deepEqual(changedDraftPaths(store.get('arrays')!), [
    '/config/list',
    '/program',
  ]);
});
