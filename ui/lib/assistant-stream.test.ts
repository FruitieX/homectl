import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  affectedDevicesSummary,
  buildAssistantHistory,
  contextUsagePercent,
  describeAssistantActionChange,
  formatTokenCount,
  parseAssistantSseEvents,
} from './assistant-stream.ts';

import type { AssistantActionChange } from '../bindings/AssistantActionChange.ts';

test('parseAssistantSseEvents parses complete frames and buffers partial ones', () => {
  const first = parseAssistantSseEvents(
    'event: status\ndata: {"phase":"context","message":"Gathering"}\n\nevent: delta\ndata: {"text":"Hel',
  );
  assert.equal(first.events.length, 1);
  assert.deepEqual(first.events[0], {
    type: 'status',
    phase: 'context',
    message: 'Gathering',
    attempt: undefined,
  });
  assert.equal(first.rest, 'event: delta\ndata: {"text":"Hel');

  const second = parseAssistantSseEvents(`${first.rest}lo"}\n\n`);
  assert.deepEqual(second.events, [{ type: 'delta', text: 'Hello' }]);
  assert.equal(second.rest, '');
});

test('parseAssistantSseEvents handles CRLF, usage, results, and errors', () => {
  const parsed = parseAssistantSseEvents(
    [
      'event: usage',
      'data: {"promptTokens":10,"completionTokens":5,"totalTokens":15,"contextWindow":1000,"approximate":false}',
      '',
      'event: action',
      'data: {"actionId":"action-1","summary":"Dim","changes":[],"createdAtMs":1,"expiresAtMs":2,"model":"m"}',
      '',
      'event: thread',
      'data: {"id":"thread-1","name":"Hallway lights"}',
      '',
      'event: error',
      'data: {"message":"boom"}',
      '',
      'event: unknown',
      'data: {"ignored":true}',
      '',
    ].join('\r\n'),
  );
  assert.equal(parsed.events.length, 4);
  assert.equal(parsed.events[0]?.type, 'usage');
  assert.equal(parsed.events[1]?.type, 'action');
  const thread = parsed.events[2];
  assert.deepEqual(thread?.type === 'thread' ? thread.thread : null, {
    id: 'thread-1',
    name: 'Hallway lights',
  });
  assert.equal(parsed.events[3]?.type, 'error');
  const error = parsed.events[3];
  assert.equal(error?.type === 'error' ? error.message : '', 'boom');
});

test('buildAssistantHistory keeps the newest turns and caps sizes', () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `turn ${index}`,
  }));
  entries.push({ role: 'assistant', content: 'x'.repeat(5000) });

  const history = buildAssistantHistory(entries);
  assert.equal(history.length, 12);
  assert.equal(history[history.length - 1]?.role, 'assistant');
  assert.ok((history[history.length - 1]?.content.length ?? 0) <= 1501);

  assert.deepEqual(
    buildAssistantHistory([{ role: 'user', content: '  ' }]),
    [],
  );
});

test('formatTokenCount renders compact approximate counts', () => {
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(999), '999');
  assert.equal(formatTokenCount(1500), '1.5k');
  assert.equal(formatTokenCount(12_345n), '12k');
  assert.equal(formatTokenCount(1_500_000), '1.5M');
});

test('describeAssistantActionChange summarizes power, brightness, and color', () => {
  const change: AssistantActionChange = {
    deviceKey: 'dummy/lamp',
    power: true,
    brightness: 0.2,
    color: { h: 320, s: 0.8 },
  };
  assert.equal(
    describeAssistantActionChange(change),
    'on · 20% · h 320° · s 80%',
  );
  assert.equal(
    describeAssistantActionChange({ deviceKey: 'dummy/lamp' }),
    'No changes',
  );
});

test('contextUsagePercent clamps to the context window', () => {
  assert.equal(
    contextUsagePercent({
      promptTokens: 100n,
      completionTokens: 50n,
      totalTokens: 150n,
      contextWindow: 1000n,
      approximate: true,
    }),
    15,
  );
  assert.equal(
    contextUsagePercent({
      promptTokens: 0n,
      completionTokens: 0n,
      totalTokens: 5000n,
      contextWindow: 1000n,
      approximate: false,
    }),
    100,
  );
});

test('affectedDevicesSummary counts devices and surfaces failures', () => {
  assert.equal(affectedDevicesSummary(1, null), '1 device');
  assert.equal(affectedDevicesSummary(4, null), '4 devices');
  assert.equal(
    affectedDevicesSummary(2, [
      { deviceKey: 'a', ok: true },
      { deviceKey: 'b', ok: true },
    ]),
    '2 devices',
  );
  assert.equal(
    affectedDevicesSummary(3, [
      { deviceKey: 'a', ok: true },
      { deviceKey: 'b', ok: false, error: 'no response' },
    ]),
    '3 devices · 1 failed',
  );
});
