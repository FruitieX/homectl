const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(require.resolve('../lib/colorCalibration.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  context,
);
const { seedCircadianCalibration } = context.exports;
const profile = (day_color, night_color) => ({
  plugin: 'circadian',
  config: { day_color, night_color },
});
const reference = profile({ h: 30, s: 0.25 }, { h: 27, s: 0.9 });

test('existing LIFX and Tuya circadian pairs seed reference-to-output mappings', () => {
  for (const output of [
    profile({ h: 55, s: 0.1 }, { h: 35, s: 0.8 }),
    profile({ h: 48, s: 0.6 }, { h: 34, s: 1 }),
  ]) {
    const result = JSON.parse(
      JSON.stringify(seedCircadianCalibration(reference, output)),
    );
    assert.deepEqual(result, [
      {
        reference: reference.config.day_color,
        output: output.config.day_color,
      },
      {
        reference: reference.config.night_color,
        output: output.config.night_color,
      },
    ]);
  }
});
test('rejects incompatible modes, missing colors, out-of-range values and identical reference points', () => {
  for (const invalid of [
    { ct: 3000 },
    undefined,
    { h: 30, s: NaN },
    { h: 30, s: 1.1 },
  ]) {
    assert.throws(() =>
      seedCircadianCalibration(reference, profile(invalid, { h: 27, s: 0.9 })),
    );
  }
  assert.throws(() =>
    seedCircadianCalibration(
      profile({ h: 30, s: 1 }, { h: 30, s: 1 }),
      reference,
    ),
  );
});
