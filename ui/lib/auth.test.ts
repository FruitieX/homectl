import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeUserAgent, formatPairingCode } from './auth.ts';

test('pairing codes are normalized as they are typed', () => {
  assert.equal(formatPairingCode('abcd'), 'ABCD');
  assert.equal(formatPairingCode('abcd2'), 'ABCD-2');
  assert.equal(formatPairingCode(' ab cd-23 45 99'), 'ABCD-2345');
});

test('user agents are summarized for the device list', () => {
  assert.equal(
    describeUserAgent(
      'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    ),
    'Chrome on Android',
  );
  assert.equal(describeUserAgent('curl/8.16.0'), 'curl');
  assert.equal(describeUserAgent(null), 'Unknown browser');
});
