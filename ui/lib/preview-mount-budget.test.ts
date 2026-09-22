import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PreviewMountBudget } from './preview-mount-budget.ts';

test('mounts at most the capacity, prioritising visible previews', () => {
  const budget = new PreviewMountBudget(2);
  budget.register('a');
  budget.register('b');
  budget.register('c');

  assert.equal(budget.isMounted('a'), false);

  budget.setVisible('a', true);
  budget.setVisible('b', true);
  budget.setVisible('c', true);

  assert.equal(budget.isMounted('a'), true);
  assert.equal(budget.isMounted('b'), true);
  assert.equal(budget.isMounted('c'), false);
});

test('keeps previously visible previews mounted while capacity remains', () => {
  const budget = new PreviewMountBudget(2);
  budget.register('a');
  budget.register('b');
  budget.setVisible('a', true);

  budget.setVisible('a', false);
  assert.equal(budget.isMounted('a'), true);

  budget.setVisible('b', true);
  assert.equal(budget.isMounted('a'), true);
  assert.equal(budget.isMounted('b'), true);
});

test('evicts the least recently visible preview for a new one', () => {
  const budget = new PreviewMountBudget(2);
  budget.register('a');
  budget.register('b');
  budget.setVisible('a', true);
  budget.setVisible('b', true);
  budget.setVisible('a', false);
  budget.setVisible('b', false);

  budget.register('c');
  budget.setVisible('c', true);

  assert.equal(budget.isMounted('b'), true);
  assert.equal(budget.isMounted('c'), true);
  assert.equal(budget.isMounted('a'), false);
});

test('unregister frees capacity and promotes a visible waiter', () => {
  const budget = new PreviewMountBudget(1);
  budget.register('a');
  budget.register('b');
  budget.setVisible('a', true);
  budget.setVisible('b', true);

  assert.equal(budget.isMounted('a'), true);
  assert.equal(budget.isMounted('b'), false);

  budget.unregister('a');
  assert.equal(budget.isMounted('b'), true);
});

test('notifies subscribers only when the mounted set changes', () => {
  const budget = new PreviewMountBudget(1);
  let calls = 0;
  const unsubscribe = budget.subscribe(() => {
    calls += 1;
  });

  budget.register('a');
  assert.equal(calls, 0);

  budget.setVisible('a', true);
  assert.equal(calls, 1);

  budget.setVisible('a', true);
  budget.setVisible('a', false);
  assert.equal(calls, 1);

  unsubscribe();
  budget.unregister('a');
  assert.equal(calls, 1);
});
