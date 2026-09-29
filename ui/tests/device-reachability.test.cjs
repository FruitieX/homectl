const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deviceReachability: health } = require('../lib/deviceReachability.ts');
const device = (data = {}) => ({ data: { Controllable: data } });
test('floorplan uses the shared evaluator, including policy-based lateness', () => {
  assert.equal(health(device(), { status: 'healthy' }), 'online');
  assert.equal(health(device(), { status: 'late' }), 'stale');
  assert.equal(health(device(), { status: 'offline' }), 'offline');
  assert.equal(health(device(), { status: 'error' }), 'stale');
});
test('missing health never invents a browser timeout or asserts online', () => {
  assert.equal(
    health(device({ last_report: { received_at_ms: 1, retained: false } })),
    'unknown',
  );
  assert.equal(
    health(device({ availability: { online: true, observed_at_ms: 1 } })),
    'unknown',
  );
  assert.equal(health(device(), { status: 'ignored' }), 'unknown');
  assert.equal(health(device(), { status: 'waiting' }), 'unknown');
  assert.equal(health(device(), { status: 'cached' }), 'cached');
});
test('disabled devices do not contribute floorplan light intensity', () => {
  assert.equal(
    health(device({ disabled: true }), { status: 'healthy' }),
    'disabled',
  );
  assert.equal(health(device(), { status: 'disabled' }), 'disabled');
});
