const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, '../lib/deviceReachability.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  context,
);
const health = context.exports.deviceReachability;
const now = 1_000_000;
const device = (data) => ({ data: { Controllable: data } });
test('reachable evidence is independent of scene confirmation and expires', () => {
  const d = device({
    requested_at_ms: now,
    last_report: {
      received_at_ms: now - 5000,
      retained: false,
      matches_requested: false,
    },
  });
  assert.equal(health(d, now), 'online');
  assert.equal(health(d, now + 600_000), 'stale');
});
test('cached reports do not establish reachability', () => {
  assert.equal(
    health(
      device({ last_report: { received_at_ms: now, retained: true } }),
      now,
    ),
    'cached',
  );
});
test('explicit offline wins unless a newer device report arrives', () => {
  const d = device({
    availability: { online: false, observed_at_ms: now },
    last_report: { received_at_ms: now - 10, retained: false },
  });
  assert.equal(health(d, now), 'offline');
  d.data.Controllable.last_report.received_at_ms = now + 1;
  assert.equal(health(d, now + 1), 'online');
  d.data.Controllable.disabled = true;
  assert.equal(health(d, now + 1), 'disabled');
});

test('off devices can be reachable and old evidence is distinguished from first discovery', () => {
  assert.equal(
    health(
      device({
        state: { power: false },
        last_report: { received_at_ms: now - 100, retained: false },
      }),
      now,
    ),
    'online',
  );
  assert.equal(
    health(
      device({
        last_report: { received_at_ms: now - 700_000, retained: false },
      }),
      now,
    ),
    'stale',
  );
  assert.equal(health(device({}), now), 'unknown');
  assert.equal(
    health(
      device({
        availability: { online: false, observed_at_ms: 0 },
        last_report: { received_at_ms: now - 100, retained: false },
      }),
      now,
    ),
    'online',
  );
});
