import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasCurrentRequestedMismatch } from './deviceReachability.ts';

const mismatch = {
  requested_at_ms: 9_000,
  last_report: {
    received_at_ms: 9_500,
    retained: false,
    matches_requested: false,
  },
};

test('current request mismatch needs a fresh, non-cached report after the request', () => {
  assert.equal(hasCurrentRequestedMismatch(mismatch, 10_000), true);
  assert.equal(
    hasCurrentRequestedMismatch(
      {
        ...mismatch,
        last_report: { ...mismatch.last_report, received_at_ms: 8_000 },
      },
      10_000,
    ),
    false,
    'a report before the request cannot explain it',
  );
  assert.equal(
    hasCurrentRequestedMismatch(
      {
        ...mismatch,
        last_report: { ...mismatch.last_report, retained: true },
      },
      10_000,
    ),
    false,
    'a cached report is not current evidence',
  );
  assert.equal(
    hasCurrentRequestedMismatch(mismatch, 10_000 + 10 * 60_000 + 1),
    false,
    'an old report does not describe current device state',
  );
  assert.equal(
    hasCurrentRequestedMismatch(
      { requested_at_ms: 9_000, last_report: null },
      10_000,
    ),
    false,
    'missing report means there is no comparison',
  );
  assert.equal(
    hasCurrentRequestedMismatch({ last_report: mismatch.last_report }, 10_000),
    false,
    'without a request timestamp, the report cannot be linked to the latest request',
  );
});
