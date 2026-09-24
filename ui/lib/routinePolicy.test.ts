import assert from 'node:assert/strict';
import test from 'node:test';

import { describeExecutionPolicy } from './routinePolicy.ts';

test('describeExecutionPolicy explains overlapping runs and action caps', () => {
  assert.match(describeExecutionPolicy(undefined), /Defaults/);
  const skipped = describeExecutionPolicy({
    mode: 'single',
    max_actions: 8,
  });
  assert.match(skipped, /skipped, not queued/);
  assert.match(skipped, /At most 8 actions/);
  const queued = describeExecutionPolicy({ mode: 'queued', max_actions: 1 });
  assert.match(queued, /waits its turn/);
  assert.match(queued, /At most 1 action /);
  const restarted = describeExecutionPolicy({
    mode: 'restart',
    max_actions: 0,
  });
  assert.match(restarted, /replaces it/);
  assert.match(restarted, /No cap on dispatched actions/);
});

test('describeExecutionPolicy reports rate limits in seconds or minutes', () => {
  assert.match(
    describeExecutionPolicy({
      mode: 'single',
      max_actions: 4,
      min_interval_ms: 30_000n,
    }),
    /every 30 seconds/,
  );
  assert.match(
    describeExecutionPolicy({
      mode: 'single',
      max_actions: 4,
      min_interval_ms: 120_000n,
    }),
    /every 2 minutes/,
  );
});
