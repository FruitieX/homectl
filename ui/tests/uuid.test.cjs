const assert = require('node:assert/strict');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(crypto) {
  const source = fs.readFileSync(path.join(__dirname, '../lib/uuid.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const context = { exports: {}, crypto };
  vm.runInNewContext(compiled.outputText, context);
  return context.exports.createUuid;
}

test('uses the native UUID API when available', () => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return 'native-id'; } };
  assert.equal(load(crypto)(), 'native-id');
});

test('generates distinct UUID v4 IDs without randomUUID, as on LAN HTTP', () => {
  const createUuid = load({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const ids = Array.from({ length: 100 }, () => createUuid());
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.equal(new Set(ids).size, ids.length);
});
