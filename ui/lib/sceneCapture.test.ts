import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureSceneDeviceState,
  colorMatchesCapabilities,
  isControllable,
  isOffline,
  isPowerOnly,
  manualRoomState,
  supportsBrightness,
  supportsColor,
  toSceneColor,
} from './sceneCapture.ts';

const brightnessOnly = {
  brightness: true,
  xy: false,
  hs: false,
  rgb: false,
  ct: null,
};

function controllable(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: brightnessOnly,
    state: { power: true, brightness: 0.5, color: null, transition: null },
    ...overrides,
  };
}

function device(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: 'lamp',
    name: 'lamp',
    integration_id: 'hue',
    data: { Controllable: data },
    raw: null,
    ...overrides,
  } as never;
}

test('a power-only device captures power and omits the rest', () => {
  const result = captureSceneDeviceState(
    device(
      controllable({
        capabilities: { ...brightnessOnly, brightness: false },
        state: { power: false, brightness: 0.8, color: null, transition: 2 },
      }),
    ),
  );
  assert.deepEqual(result.state, {
    power: false,
    brightness: undefined,
    color: undefined,
    transition: undefined,
  });
  assert.ok(
    result.notes.some((note) => /does not support brightness/.test(note)),
  );
});

test('supported brightness and hue color are captured in the scene color shape', () => {
  const result = captureSceneDeviceState(
    device(
      controllable({
        capabilities: {
          brightness: true,
          hs: true,
          xy: false,
          rgb: false,
          ct: null,
        },
        state: {
          power: true,
          brightness: 0.25,
          color: { h: 210, s: 0.6 },
          transition: 3,
        },
      }),
    ),
  );
  assert.deepEqual(result.state, {
    power: true,
    brightness: 0.25,
    color: { h: 210, s: 0.6 },
    transition: undefined,
  });
  assert.deepEqual(result.notes, []);
});

test('a color space the device does not advertise is left out with a reason', () => {
  const result = captureSceneDeviceState(
    device(
      controllable({
        capabilities: {
          brightness: true,
          hs: true,
          xy: false,
          rgb: false,
          ct: null,
        },
        state: {
          power: true,
          brightness: 0.4,
          color: { ct: 2700 },
          transition: null,
        },
      }),
    ),
  );
  assert.equal(result.state.color, undefined);
  assert.ok(
    result.notes.some((note) =>
      /outside what this device advertises/.test(note),
    ),
  );
});

test('a supported field with no requested value is omitted with a reason', () => {
  const result = captureSceneDeviceState(
    device(
      controllable({
        capabilities: {
          brightness: true,
          hs: true,
          xy: false,
          rgb: false,
          ct: null,
        },
        state: { power: true, brightness: null, color: null, transition: null },
      }),
    ),
  );
  assert.equal(result.state.brightness, undefined);
  assert.equal(result.state.color, undefined);
  assert.equal(result.notes.length, 2);
});

test('capture follows the requested state when the report disagrees', () => {
  const result = captureSceneDeviceState(
    device(
      controllable({
        state: { power: true, brightness: 0.9, color: null, transition: null },
        last_report: {
          state: { power: false, brightness: 0.1, color: null },
          reported_at_ms: Date.now(),
        },
        requested_at_ms: Date.now() - 60_000,
      }),
    ),
  );
  assert.equal(result.state.power, true);
  assert.equal(result.state.brightness, 0.9);
});

test('an offline device still captures the requested state and says so', () => {
  const offline = device(controllable({ availability: { kind: 'offline' } }));
  assert.equal(isOffline(offline), true);
  const result = captureSceneDeviceState(offline);
  assert.equal(result.state.power, true);
  assert.ok(result.notes.some((note) => /offline/.test(note)));
  assert.equal(isOffline(device(controllable())), false);
});

test('sensors and unknown payloads cannot be captured', () => {
  const sensor = {
    id: 'temp',
    name: 'temp',
    integration_id: 'esphome',
    data: { Sensor: {} },
    raw: null,
  } as never;
  assert.equal(isControllable(sensor), false);
  const result = captureSceneDeviceState(sensor);
  assert.ok(result.notes.some((note) => /not controllable/.test(note)));
  assert.equal(isPowerOnly(sensor), true);
});

test('color shapes convert from live to scene form and match capabilities', () => {
  assert.deepEqual(toSceneColor({ h: 10, s: 1 }), { h: 10, s: 1 });
  assert.deepEqual(toSceneColor({ r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
  assert.deepEqual(toSceneColor({ x: 0.3, y: 0.4 }), { x: 0.3, y: 0.4 });
  assert.deepEqual(toSceneColor({ ct: 2400 }), { ct: 2400 });
  assert.deepEqual(toSceneColor({ h: 1, s: 1 }), { h: 1, s: 1 });
  assert.equal(toSceneColor(null), undefined);
  assert.equal(toSceneColor({}), undefined);
  assert.equal(
    colorMatchesCapabilities(
      { ct: 2000 },
      { ...brightnessOnly, ct: { start: 2000, end: 6500 } },
    ),
    true,
  );
  assert.equal(
    colorMatchesCapabilities(
      { ct: 2000 },
      { ...brightnessOnly, ct: null },
    ),
    false,
  );
});

test('brightness is inferred from color capabilities but never overridden', () => {
  assert.equal(supportsColor({ ...brightnessOnly, hs: true }), true);
  assert.equal(
    supportsBrightness({
      ...brightnessOnly,
      brightness: null,
      ct: { start: 2000, end: 6500 },
    }),
    true,
  );
  assert.equal(
    supportsBrightness({ ...brightnessOnly, brightness: false, hs: true }),
    false,
  );
  assert.equal(
    isPowerOnly(
      device({
        capabilities: {
          brightness: false,
          xy: false,
          hs: false,
          rgb: false,
          ct: null,
        },
        state: { power: true, brightness: null, color: null, transition: null },
      }),
    ),
    true,
  );
});

test('room targets start from a manual shared state', () => {
  assert.deepEqual(manualRoomState(), {
    power: true,
    brightness: undefined,
    color: undefined,
    transition: undefined,
  });
});
