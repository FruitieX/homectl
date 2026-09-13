const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(name) {
  const source = fs.readFileSync(
    path.join(__dirname, '../lib', `${name}.ts`),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function('module', 'exports', compiled.outputText)(
    module,
    module.exports,
  );
  return module.exports;
}

const { filterDeparturesWithinHorizon } = load('trainSchedule');
const now = Date.UTC(2026, 8, 13, 12);
const departureAt = (minutesFromNow) =>
  (now + minutesFromNow * 60 * 1000) / 1000;

test('filters departures beyond the configured future horizon', () => {
  const trains = [
    { name: 'exactly at limit', departureAt: departureAt(100) },
    { name: 'one minute too late', departureAt: departureAt(101) },
    { name: 'already departed', departureAt: departureAt(-1) },
    { name: 'missing timestamp' },
  ];

  const result = filterDeparturesWithinHorizon(trains, now, 100);

  assert.deepEqual(
    result.map((train) => train.name),
    ['exactly at limit', 'already departed', 'missing timestamp'],
  );
});

test('normalizes invalid horizon values to a safe range', () => {
  const trains = [{ name: 'later', departureAt: departureAt(1200) }];

  assert.deepEqual(filterDeparturesWithinHorizon(trains, now, -5), []);
  assert.deepEqual(filterDeparturesWithinHorizon(trains, now, Number.NaN), []);
  assert.deepEqual(filterDeparturesWithinHorizon(trains, now, 2000), trains);
});
