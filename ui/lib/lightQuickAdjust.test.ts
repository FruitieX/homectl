import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLightAdjustmentQueue,
  quickLightSelection,
  type LightAdjustment,
} from './lightQuickAdjust.ts';
import type { Device } from '../bindings/Device';
import type { Capabilities } from '../bindings/Capabilities';

const light = (capabilities: Partial<Capabilities>, disabled = false): Device =>
  ({
    id: 'test',
    integration_id: 'dummy',
    name: 'Light',
    data: {
      Controllable: {
        capabilities: {
          brightness: true,
          hs: true,
          rgb: false,
          xy: false,
          ct: { start: 2000, end: 6500 },
          ...capabilities,
        },
        disabled,
        managed: 'Full',
        state: { power: true, brightness: 0.5, color: { h: 120, s: 0.8 } },
      },
    },
  }) as Device;

test('selection controls use shared capabilities and overlapping temperature ranges', () => {
  const result = quickLightSelection([
    light({}),
    light({ hs: false, rgb: true, ct: { start: 2700, end: 5000 } }),
  ]);
  assert.equal(result.caps.hs, true);
  assert.equal(result.caps.brightness, true);
  assert.deepEqual(result.caps.ct, { start: 2700, end: 5000 });
  const switchSelection = quickLightSelection([
    light({}),
    light({ brightness: false, hs: false, ct: null }),
  ]);
  assert.equal(switchSelection.caps.hs, false);
  assert.equal(switchSelection.caps.brightness, false);
  assert.equal(switchSelection.caps.ct, null);
});

test('read-only devices and sensors are excluded, and incompatible temperature ranges have no shared wheel', () => {
  const sensor = { data: { Sensor: { value: true } } } as Device;
  const result = quickLightSelection([
    light({}),
    light({ brightness: false }, true),
    sensor,
  ]);
  assert.equal(result.writable.length, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.caps.brightness, true);
  assert.equal(
    quickLightSelection([
      light({ ct: { start: 2000, end: 3000 } }),
      light({ ct: { start: 4000, end: 6500 } }),
    ]).caps.ct,
    null,
  );
  assert.equal(quickLightSelection([sensor]).caps.hs, false);
  assert.equal(quickLightSelection([]).caps.brightness, false);
});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('continuous input sends the latest value after one short window', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: LightAdjustment[] = [];
  const queue = createLightAdjustmentQueue({
    send: async (value) => {
      sent.push(value);
      return true;
    },
    onBusy: () => {},
    onFailure: () => {},
  });
  queue.update({ brightness: 20 });
  context.mock.timers.tick(80);
  queue.update({ brightness: 45 });
  context.mock.timers.tick(40);
  await settle();
  assert.deepEqual(sent, [{ brightness: 45 }]);
  assert.equal(queue.idle, true);
  queue.dispose();
});

test('a slow acknowledgement serializes writes and retains the newest complete target', async () => {
  const sent: LightAdjustment[] = [],
    replies: Array<(applied: boolean) => void> = [];
  const queue = createLightAdjustmentQueue({
    send: (value) => {
      sent.push(value);
      return new Promise((resolve) => replies.push(resolve));
    },
    onBusy: () => {},
    onFailure: () => {},
  });
  queue.update({ power: true, brightness: 20 });
  queue.flush();
  queue.update({ brightness: 45 });
  queue.update({ color: { h: 120, s: 1 } });
  queue.update({ brightness: 80 });
  queue.flush();
  assert.equal(sent.length, 1);
  replies.shift()!(true);
  await settle();
  assert.deepEqual(sent[1], { brightness: 80, color: { h: 120, s: 1 } });
  replies.shift()!(true);
  await settle();
  assert.equal(queue.idle, true);
  queue.dispose();
});

test('a rejected command stops queued writes and clears the local pending state', async () => {
  const busy: boolean[] = [];
  let reply!: (applied: boolean) => void;
  let count = 0,
    failures = 0;
  const queue = createLightAdjustmentQueue({
    send: () => {
      count++;
      return new Promise((resolve) => {
        reply = resolve;
      });
    },
    onBusy: (value) => busy.push(value),
    onFailure: () => {
      failures++;
    },
  });
  queue.update({ brightness: 20 });
  queue.flush();
  queue.update({ brightness: 80 });
  queue.flush();
  reply(false);
  await settle();
  assert.equal(count, 1);
  assert.equal(failures, 1);
  assert.deepEqual(busy, [true, false]);
  assert.equal(queue.idle, true);
  queue.dispose();
});

test('closing during a slow write finishes the released target without updating an unmounted view', async () => {
  const sent: LightAdjustment[] = [],
    replies: Array<(applied: boolean) => void> = [],
    busy: boolean[] = [];
  const queue = createLightAdjustmentQueue({
    send: (value) => {
      sent.push(value);
      return new Promise((resolve) => replies.push(resolve));
    },
    onBusy: (value) => busy.push(value),
    onFailure: () => assert.fail('Unmounted callback'),
  });
  queue.update({ brightness: 20 });
  queue.flush();
  queue.update({ brightness: 80 });
  queue.dispose();
  replies.shift()!(true);
  await settle();
  assert.deepEqual(sent, [{ brightness: 20 }, { brightness: 80 }]);
  replies.shift()!(true);
  await settle();
  assert.deepEqual(busy, [true]);
});

test('canceling an unsent gesture drops its timer and command', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const queue = createLightAdjustmentQueue({
    send: async () => {
      assert.fail('Canceled write');
    },
    onBusy: () => {},
    onFailure: () => {},
  });
  queue.update({ brightness: 80 });
  queue.cancel();
  context.mock.timers.tick(1000);
  assert.equal(queue.idle, true);
  queue.dispose();
});
