import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  decideResumeAction,
  reconnectDelayMs,
  socketReadiness,
} from './websocketReconnect.ts';

test('backs off exponentially and caps the delay', () => {
  assert.equal(reconnectDelayMs(0), RECONNECT_BASE_DELAY_MS);
  assert.equal(reconnectDelayMs(1), 2_000);
  assert.equal(reconnectDelayMs(3), 8_000);
  assert.equal(reconnectDelayMs(4), RECONNECT_MAX_DELAY_MS);
  assert.equal(reconnectDelayMs(50), RECONNECT_MAX_DELAY_MS);
});

test('treats a negative or fractional attempt count as zero', () => {
  assert.equal(reconnectDelayMs(-3), RECONNECT_BASE_DELAY_MS);
  assert.equal(reconnectDelayMs(1.7), 2_000);
});

test('reconnects at once when the socket is gone or closing', () => {
  assert.equal(decideResumeAction('none'), 'reconnect');
  assert.equal(decideResumeAction('closed'), 'reconnect');
  assert.equal(decideResumeAction('closing'), 'reconnect');
});

test('waits for an in-flight connection instead of racing it', () => {
  assert.equal(decideResumeAction('connecting'), 'wait');
});

test('probes a socket the browser still reports as open', () => {
  assert.equal(decideResumeAction('open'), 'probe');
});

test('maps websocket readyState values onto readiness', () => {
  assert.equal(socketReadiness(0), 'connecting');
  assert.equal(socketReadiness(1), 'open');
  assert.equal(socketReadiness(2), 'closing');
  assert.equal(socketReadiness(3), 'closed');
  assert.equal(socketReadiness(42), 'none');
});
