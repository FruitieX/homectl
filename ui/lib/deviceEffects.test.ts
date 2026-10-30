import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commonEffects,
  deviceColorSlots,
  sharedEffect,
  withColorSlot,
} from './deviceEffects.ts';

const caps = (effects?: string[]) =>
  ({
    brightness: true,
    xy: false,
    hs: true,
    rgb: false,
    ct: null,
    ...(effects ? { effects } : {}),
  }) as never;

function device(state: Record<string, unknown>, effects?: string[]) {
  return {
    id: 'curtain',
    name: 'Curtain',
    integration_id: 'twinkly',
    data: {
      Controllable: {
        capabilities: caps(effects),
        state: { power: true, brightness: 0.5, color: null, ...state },
      },
    },
    raw: null,
  } as never;
}

test('commonEffects intersects devices that offer effects', () => {
  assert.deepEqual(
    commonEffects([
      caps(['Aurora', 'Fire', 'Snowfall']),
      caps(),
      caps(['Fire', 'Aurora']),
    ]),
    ['Aurora', 'Fire'],
  );
  assert.deepEqual(commonEffects([caps(), caps([])]), []);
});

test('sharedEffect reports a common, customised or mixed look', () => {
  assert.equal(
    sharedEffect([device({ effect: 'Aurora' }), device({ effect: 'Aurora' })]),
    'Aurora',
  );
  assert.equal(sharedEffect([device({})]), null);
  assert.equal(
    sharedEffect([device({ effect: 'Aurora' }), device({})]),
    'mixed',
  );
});

test('deviceColorSlots is empty for single-color devices', () => {
  assert.deepEqual(deviceColorSlots(device({})), []);
  assert.deepEqual(deviceColorSlots(device({ colors: [{ h: 1, s: 1 }] })), [
    { h: 1, s: 1 },
  ]);
});

test('withColorSlot replaces a slot without leaving holes', () => {
  const red = { h: 0, s: 1 };
  const blue = { h: 240, s: 1 };
  const green = { h: 120, s: 1 };
  assert.deepEqual(withColorSlot([red, blue], 1, green), [red, green]);
  assert.deepEqual(withColorSlot(undefined, 2, green, [red, blue]), [
    red,
    blue,
    green,
  ]);
  assert.deepEqual(withColorSlot([], 1, green), [green, green]);
});
