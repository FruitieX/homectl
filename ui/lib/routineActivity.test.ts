import assert from 'node:assert/strict';
import test from 'node:test';
import { explainEntry, outcome, summary } from './routineActivity.ts';
import type { RoutineHistoryEntry } from '../hooks/useConfig';

const base = (): RoutineHistoryEntry => ({
  id: 'record',
  timestamp: '2026-09-29T12:00:00Z',
  routine_id: 'motion',
  routine_name: 'Motion',
  trigger_kind: 'v2_run',
  action_count: 0,
  v2: {
    definition_revision: 1n,
    fingerprint: 'test',
    matched_trigger_ids: ['motion'],
    triggers: [],
    condition: {
      truth: 'true',
      trace: { path: '/conditions', truth: 'true', evaluated: true },
    },
    will_trigger: true,
    execution_pending: false,
  },
});

test('an evaluation without a run outcome never claims dispatch or successful execution', () => {
  const entry = base();
  assert.equal(outcome(entry), 'No run recorded');
  assert.match(summary(entry), /No run outcome/);
  assert.doesNotMatch(explainEntry(entry), /^Ran because/);
});

test('blocked coalesced attempts remain separate from old run evidence', () => {
  const entry = base();
  entry.trigger_kind = 'v2_blocked';
  entry.occurrence_count = 7;
  entry.blocked_reason = 'outside the schedule';
  entry.v2!.last_run = {
    run_id: 3n,
    definition_revision: 1n,
    accepted: true,
    steps: [],
    dropped: 0n,
  };
  assert.equal(outcome(entry), 'Blocked');
  assert.match(summary(entry), /outside the schedule · 7 attempts/);
  assert.match(explainEntry(entry), /did not run/);
});

test('policy rejection, suppression and unknown conditions keep their recorded meaning', () => {
  const entry = base();
  entry.v2!.last_run = {
    run_id: 3n,
    definition_revision: 1n,
    accepted: false,
    steps: [
      {
        action_id: 'step',
        kind: 'activate_scene',
        targets: [],
        disposition: 'suppressed',
        reason: 'queue full',
      },
    ],
    dropped: 1n,
  };
  assert.equal(outcome(entry), 'Rejected');
  assert.equal(summary(entry), 'queue full');
  assert.match(explainEntry(entry), /rejected/);
  entry.v2!.last_run.accepted = true;
  assert.equal(outcome(entry), 'Some steps skipped');
  entry.v2!.condition.truth = 'unknown';
  entry.v2!.condition.unknown_reason = { kind: 'stale', device: 'mqtt/window' };
  assert.equal(outcome(entry), 'Unknown');
  assert.match(summary(entry), /Stale observation: mqtt\/window/);
});

test('legacy history without a condition trace still records a run, not a failed evaluation', () => {
  const entry = base();
  entry.v2 = null;
  entry.trigger_kind = 'rule_match';
  entry.action_count = 2;
  assert.equal(outcome(entry), 'Dispatched');
  assert.match(explainEntry(entry), /routine ran/);
  entry.trigger_kind = 'force_trigger';
  assert.match(explainEntry(entry), /Manually triggered/);
});
