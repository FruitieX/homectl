import assert from 'node:assert/strict';
import test from 'node:test';
import { catchAllGroupIds } from './catchAllGroups.ts';

const room = (...device_keys: string[]) => ({ device_keys });

test('a group covering every room is a catch-all', () => {
  const groups = {
    all: room('a/1', 'a/2', 'a/3', 'a/4'),
    living: room('a/1', 'a/2'),
    kitchen: room('a/3'),
    office: room('a/4'),
  };
  assert.deepEqual([...catchAllGroupIds(groups)], ['all']);
});

test('a floor that misses another room is not a catch-all', () => {
  const groups = {
    upstairs: { device_keys: [], linked_groups: ['bedroom', 'office'] },
    bedroom: room('a/1'),
    office: room('a/2'),
    kitchen: room('a/3'),
  };
  assert.deepEqual([...catchAllGroupIds(groups)], []);
});

test('linked groups count, and hidden rooms are ignored', () => {
  const groups = {
    home: { device_keys: [], linked_groups: ['living', 'kitchen'] },
    living: room('a/1'),
    kitchen: room('a/2'),
    storage: { ...room('a/9'), hidden: true },
  };
  assert.deepEqual([...catchAllGroupIds(groups)], ['home']);
});

test('needs at least two smaller rooms', () => {
  assert.deepEqual(
    [...catchAllGroupIds({ all: room('a/1', 'a/2'), living: room('a/1') })],
    [],
  );
});

test('missing devices do not keep a catch-all from qualifying', () => {
  const groups = {
    all: room('a/1', 'a/2'),
    living: room('a/1', 'gone/1'),
    kitchen: room('a/2'),
  };
  assert.deepEqual(
    [...catchAllGroupIds(groups, (key) => !key.startsWith('gone/'))],
    ['all'],
  );
});

test('a group that misses a same-sized room is not a catch-all', () => {
  const groups = {
    north: room('a/1', 'a/2', 'a/3'),
    a: room('a/1'),
    b: room('a/2'),
    south: room('b/1', 'b/2', 'b/3'),
  };
  assert.deepEqual([...catchAllGroupIds(groups)], []);
});
