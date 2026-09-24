import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { triggerStateSentence } from './routineRuntimeText.ts';

/**
 * The enabled/unknown combination: a routine that is enabled must never be
 * told to enable itself, and a missing report must name the missing evidence.
 */
describe('triggerStateSentence', () => {
  it('names the absent evidence when enabled with no report yet', () => {
    const sentence = triggerStateSentence(undefined, 0, { enabled: true });
    assert.equal(
      sentence,
      'No trigger evaluation received yet; waiting for the first report.',
    );
    assert.doesNotMatch(sentence, /enable the routine/i);
  });

  it('names the trigger that has not reported', () => {
    assert.equal(
      triggerStateSentence(undefined, 0, {
        enabled: true,
        triggerLabel: 'Living room motion',
      }),
      'No trigger evaluation received yet; waiting for a report from Living room motion.',
    );
  });

  it('says a disabled routine is not evaluated', () => {
    assert.equal(
      triggerStateSentence(undefined, 0, { enabled: false }),
      'Not evaluated: the routine is disabled.',
    );
  });

  it('keeps an armed schedule and an unknown input apart', () => {
    const now = 1_000_000;
    assert.match(
      triggerStateSentence(
        {
          trigger_id: 't1',
          kind: 'schedule',
          armed: true,
          eligible: true,
          due_wall_ms: now + 60_000,
        } as never,
        now,
      ),
      /^Scheduled — next run in 1m/,
    );
    assert.equal(
      triggerStateSentence(
        {
          trigger_id: 't2',
          kind: 'state_change',
          armed: false,
          eligible: false,
          unknown_reason: { kind: 'stale', device: 'hallway_spot' },
        } as never,
        now,
      ),
      'Unknown: stale data: hallway_spot',
    );
  });

  it('does not claim a deadline when none is armed', () => {
    assert.equal(
      triggerStateSentence(
        {
          trigger_id: 't3',
          kind: 'state_change',
          armed: false,
          eligible: true,
        } as never,
        0,
      ),
      'Eligible, but no deadline is armed for it right now.',
    );
  });
});
