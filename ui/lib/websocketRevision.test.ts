import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decidePatchAction } from './websocketRevision.ts';

test('applies a patch that follows the last revision', () => {
  assert.equal(decidePatchAction(4, 5), 'apply');
  assert.equal(decidePatchAction(0, 1), 'apply');
});

test('requests a resync when a patch skips revisions', () => {
  assert.equal(decidePatchAction(4, 6), 'resync');
  assert.equal(decidePatchAction(4, 100), 'resync');
});

test('requests a resync when no revision was seen yet', () => {
  assert.equal(decidePatchAction(null, 1), 'resync');
});

test('ignores duplicate and stale patches', () => {
  assert.equal(decidePatchAction(4, 4), 'ignore');
  assert.equal(decidePatchAction(4, 3), 'ignore');
});
