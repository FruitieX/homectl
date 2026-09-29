import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEntityDraftStore,
  changedDraftFields,
  remapArrayEditorPath,
} from './entityDraft.ts';
const original = {
  name: 'Hall',
  hidden: false,
  members: ['a', 'b'],
  future: { preserved: true },
};
const meta = { href: '/config/groups/hall', label: 'Hall' };

test('unfinished numeric input retains its type, blocks saves and survives navigation until discarded', () => {
  const store = createEntityDraftStore();
  const base = { number: 12 };
  store.sync('number', base, meta);
  for (const raw of ['', '-', '1e']) {
    store.stageInput('number', 'json/number', {
      raw,
      error: 'Finish the number',
    });
    store.sync('number', base, meta);
    assert.deepEqual(store.get('number')!.value, base);
    assert.equal(store.get('number')!.inputs?.['json/number'].raw, raw);
    assert.equal(store.get('number')!.dirty, true);
    assert.equal(store.start('number'), null);
  }
  store.discard('number');
  assert.equal(store.get('number')!.inputs, undefined);
  assert.equal(store.get('number')!.dirty, false);
});

test('raw numeric state is never submitted and only acknowledged input is cleared by a save', () => {
  const store = createEntityDraftStore();
  const base = { number: 12, other: 3 };
  store.sync('number', base, meta);
  store.stageInput('number', 'json/number', { raw: '1e3' });
  store.stageInput('number', 'json/other', { raw: '3.00' });
  store.change('number', { ...base, number: 1000 });
  const submission = store.start('number')!;
  assert.deepEqual(submission.value, { number: 1000, other: 3 });
  assert.deepEqual(Object.keys(submission).sort(), [
    'baseline',
    'generation',
    'value',
  ]);
  store.stageInput('number', 'json/number', {
    raw: '-',
    error: 'Finish the number',
  });
  store.saved('number', submission.generation, submission.value);
  assert.deepEqual(store.get('number')!.inputs, {
    'json/number': { raw: '-', error: 'Finish the number' },
  });
  assert.equal(store.get('number')!.dirty, true);
  assert.equal(store.start('number'), null);
  store.stageInput('number', 'json/number', { raw: '-0.25' });
  store.change('number', { ...base, number: -0.25 });
  const second = store.start('number')!;
  store.saved('number', second.generation, second.value);
  assert.equal(store.get('number')!.inputs, undefined);
  assert.equal(store.get('number')!.dirty, false);
});

test('clean refresh and reviewed remote values cannot leave a stale numeric display', () => {
  const store = createEntityDraftStore();
  const base = { number: 12, name: 'Before' };
  store.sync('number', base, meta);
  store.stageInput('number', 'json/number', { raw: '12.00' });
  store.sync('number', { ...base, number: 20 }, meta);
  assert.equal(store.get('number')!.inputs, undefined);
  store.change('number', { ...base, number: 30, name: 'Mine' });
  store.stageInput('number', 'json/number', { raw: '30.0' });
  store.sync('number', { ...base, number: 40 }, meta);
  store.rebase('number', ['name']);
  assert.deepEqual(store.get('number')!.value, { number: 40, name: 'Mine' });
  assert.deepEqual(store.get('number')!.inputs, {});
});

test('collection variants and unfinished inputs follow reordered items and disappear with removed items', () => {
  const store = createEntityDraftStore();
  store.sync('list', { values: [10, 20] }, meta);
  const array = 'json/object/values/array';
  store.switchVariant<unknown>(
    'list',
    `${array}/0`,
    'number',
    10,
    'string',
    '',
  );
  store.switchVariant<unknown>(
    'list',
    `${array}/1`,
    'number',
    20,
    'string',
    '',
  );
  store.stageInput('list', `${array}/0/object/nested`, {
    raw: '-',
    error: 'Finish',
  });
  store.remapEditorPaths('list', (path) =>
    remapArrayEditorPath(path, array, [1, 0]),
  );
  assert.equal(
    store.switchVariant<unknown>(
      'list',
      `${array}/0`,
      'string',
      '',
      'number',
      0,
    ),
    20,
  );
  assert.equal(
    store.get('list')!.inputs?.[`${array}/1/object/nested`].raw,
    '-',
  );
  assert.equal(
    store.switchVariant<unknown>(
      'list',
      `${array}/1`,
      'string',
      '',
      'number',
      0,
    ),
    10,
  );
  store.remapEditorPaths('list', (path) =>
    remapArrayEditorPath(path, array, [1]),
  );
  assert.equal(
    store.switchVariant<unknown>(
      'list',
      `${array}/0`,
      'string',
      '',
      'number',
      0,
    ),
    10,
  );
  assert.equal(
    store.switchVariant<unknown>(
      'list',
      `${array}/1`,
      'string',
      '',
      'number',
      0,
    ),
    0,
  );
  assert.equal(
    remapArrayEditorPath(`${array}/10/object/0`, array, [10, 0]),
    `${array}/0/object/0`,
  );
  assert.equal(remapArrayEditorPath(`${array}/1`, array, [10, 0]), null);
  assert.equal(
    remapArrayEditorPath('json/object/other/array/0', array, [1, 0]),
    'json/object/other/array/0',
  );
});

test('switching type clears incomplete inputs and distinguishes cached null from an absent variant', () => {
  const store = createEntityDraftStore();
  store.sync('value', { value: 0 }, meta);
  store.stageInput('value', 'json', { raw: '-', error: 'Finish' });
  assert.equal(
    store.switchVariant('value', 'json', 'number', 0, 'null', null),
    null,
  );
  assert.equal(store.get('value')!.dirty, false);
  assert.deepEqual(store.get('value')!.inputs, {});
  store.switchVariant('value', 'json', 'null', null, 'number', 0);
  assert.equal(
    store.switchVariant<unknown>(
      'value',
      'json',
      'number',
      0,
      'null',
      'fallback',
    ),
    null,
  );
});

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
