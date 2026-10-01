import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuickControlDismissGuard } from './quickControlDismiss.ts';

class FakeTarget {
  listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, pointerId: number) {
    const event = Object.assign(new Event(type), { pointerId });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  get count() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

test('the dismissing gesture is consumed once and only for its own pointer', () => {
  const target = new FakeTarget();
  const guard = createQuickControlDismissGuard(target);
  guard.dismiss(7);
  assert.equal(guard.consume(8), false, 'another pointer is not suppressed');
  assert.equal(guard.consume(7), true);
  assert.equal(guard.consume(7), false, 'consumed once');
  assert.equal(target.count, 0, 'no listeners left behind');
});

test('a record never outlives the gesture that created it', () => {
  const target = new FakeTarget();
  const guard = createQuickControlDismissGuard(target);
  guard.dismiss(3);
  target.dispatch('pointerup', 4);
  assert.equal(
    guard.consume(3),
    true,
    'another pointer ending keeps the record',
  );
  guard.dismiss(5);
  target.dispatch('pointercancel', 5);
  assert.equal(guard.consume(5), false, 'released when its own pointer ended');
  assert.equal(target.count, 0);
});

test('a second dismissal replaces the first without leaking listeners', () => {
  const target = new FakeTarget();
  const guard = createQuickControlDismissGuard(target);
  guard.dismiss(1);
  guard.dismiss(2);
  assert.equal(target.count, 2, 'one record, both end events');
  assert.equal(guard.consume(1), false);
  assert.equal(guard.consume(2), true);
  assert.equal(target.count, 0);
});

test('works without a browser event target', () => {
  const guard = createQuickControlDismissGuard(null);
  guard.dismiss(9);
  assert.equal(guard.consume(9), true);
});
