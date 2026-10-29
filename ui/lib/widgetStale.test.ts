import assert from 'node:assert/strict';
import { test } from 'node:test';

import { earlierDataSuffix, parseStaleSince } from './widgetStale.ts';

test('parses the stale-since header', () => {
  assert.equal(parseStaleSince(null), null);
  assert.equal(parseStaleSince(''), null);
  assert.equal(parseStaleSince('soon'), null);
  assert.equal(parseStaleSince('1793281871990')?.getTime(), 1793281871990);
});

test('describes what a refresh notice is showing', () => {
  assert.equal(earlierDataSuffix(false, null), '.');
  assert.equal(earlierDataSuffix(true, null), '; showing earlier results.');
  const since = new Date(2026, 9, 29, 15, 49);
  assert.match(
    earlierDataSuffix(true, since),
    /^; showing data from 15[:.]49\.$/,
  );
});
