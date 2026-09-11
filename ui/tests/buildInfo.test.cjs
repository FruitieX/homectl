const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path) {
  const context = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    context,
  );
  return context.exports;
}

const { formatBuildInfoSummary, normalizeBuildInfo } = load(
  '../lib/buildInfo.ts',
);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('formats a compact build metadata summary for the settings footer', () => {
  assert.equal(
    formatBuildInfoSummary({
      version: '1.0.0',
      gitCommit: 'abc123',
      buildDate: '2026-09-11T12:00:00Z',
    }),
    'Version 1.0.0 · Built 2026-09-11T12:00:00Z · Commit abc123',
  );
});

test('normalizes complete build metadata for display', () => {
  assert.deepEqual(
    plain(
      normalizeBuildInfo({
        version: ' 1.0.0 ',
        gitCommit: ' abc123 ',
        buildDate: ' 2026-09-11T12:00:00Z ',
      }),
    ),
    {
      version: '1.0.0',
      gitCommit: 'abc123',
      buildDate: '2026-09-11T12:00:00Z',
    },
  );
});

test('uses explicit fallbacks for missing build metadata', () => {
  assert.deepEqual(
    plain(
      normalizeBuildInfo({
        version: ' ',
        gitCommit: undefined,
        buildDate: null,
      }),
    ),
    {
      version: 'development',
      gitCommit: 'unknown',
      buildDate: 'unknown',
    },
  );
});
