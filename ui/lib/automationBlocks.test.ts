import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutomationBlock } from '../bindings/AutomationBlock';
import type { JsonValue } from '../bindings/serde_json/JsonValue';
import {
  materializeBlock,
  retainInputBindings,
  replaceInputName,
  bindingFields,
  blockUsers,
} from './automationBlocks.ts';
const inputs: AutomationBlock['inputs'] = {
  room: { label: 'Room', kind: { kind: 'group' } },
  enabled: { label: 'Enabled', kind: { kind: 'boolean' }, default: false },
};
const action = (id: string): JsonValue => ({
  action: 'set_power',
  id,
  targets: { groups: [{ $input: 'room' }] },
  power: { $input: 'enabled' },
});
test('authoring retains bindings through reorders, duplicates and unrelated edits', () => {
  const template = [action('first'), action('second')];
  const shown = materializeBlock(template, inputs) as JsonValue[];
  assert.deepEqual(
    retainInputBindings(template, [shown[1]!, shown[0]!], inputs),
    [template[1], template[0]],
  );
  const edited = structuredClone(shown);
  (edited[0] as Record<string, JsonValue>).power = true;
  const retained = retainInputBindings(template, edited, inputs) as Record<
    string,
    JsonValue
  >[];
  assert.equal(retained[0]!.power, true);
  assert.deepEqual(retained[0]!.targets, { groups: [{ $input: 'room' }] });
  const fresh = {
    action: 'set_power',
    id: 'new',
    power: false,
    targets: { groups: ['another'] },
  };
  assert.deepEqual(retainInputBindings(template, [fresh], inputs), [fresh]);
});
test('materialization uses supplied/default values and never interpolates strings', () => {
  const body = {
    id: '$input:room',
    power: { $input: 'enabled' },
    targets: { groups: [{ $input: 'room' }] },
  };
  assert.deepEqual(materializeBlock(body, inputs, { room: 'office' }), {
    id: '$input:room',
    power: false,
    targets: { groups: ['office'] },
  });
  assert.deepEqual(replaceInputName(body, 'room', 'area'), {
    ...body,
    targets: { groups: [{ $input: 'area' }] },
  });
});
test('bindable fields include nested block arguments, with typed choices', () => {
  const child = { id: 'child', inputs, ...{} } as AutomationBlock;
  const fields = bindingFields(
    [
      {
        action: 'call_block',
        id: 'nested',
        block_id: 'child',
        inputs: { room: 'office', enabled: false },
      },
    ],
    [child],
  );
  assert.equal(fields.length, 2);
  assert.deepEqual(fields[0]!.kinds, ['group']);
  assert.equal(fields[0]!.label, '1 / Input: Room');
});
test('usage includes indirect callers and terminates on cycles', () => {
  const call = (id: string) => ({
    action: 'call_block',
    id: 'call',
    block_id: id,
    inputs: {},
  });
  const blocks = [
    {
      id: 'inner',
      name: 'Inner',
      description: '',
      revision: 1n,
      inputs: {},
      kind: 'action',
      body: [call('outer')],
    },
    {
      id: 'outer',
      name: 'Outer',
      description: '',
      revision: 1n,
      inputs: {},
      kind: 'action',
      body: [call('inner')],
    },
  ] as AutomationBlock[];
  const routines = [
    {
      id: 'caller',
      name: 'Caller',
      definition_v2: { program: { kind: 'native', steps: [call('outer')] } },
    },
    { id: 'other', name: 'Other' },
  ];
  const users = blockUsers('inner', blocks, routines);
  assert.deepEqual(
    users.blocks.map((b) => b.id),
    ['outer'],
  );
  assert.deepEqual(
    users.routines.map((r) => r.id),
    ['caller'],
  );
});

test('duplicating bound actions retains their bindings after IDs change', () => {
  const template = [action('original')];
  const shown = materializeBlock(template, inputs) as Record<
    string,
    JsonValue
  >[];
  const copy = { ...shown[0], id: 'copy' };
  assert.deepEqual(retainInputBindings(template, [shown[0]!, copy], inputs), [
    template[0],
    { ...(template[0] as object), id: 'copy' },
  ]);
  const newStep = {
    action: 'dim',
    id: 'new',
    step: 0.2,
    targets: { groups: ['__block_input__room'] },
  };
  assert.deepEqual(retainInputBindings([], [newStep], inputs), [
    { ...newStep, targets: { groups: [{ $input: 'room' }] } },
  ]);
});
test('explicit null arguments override defaults for optional spread', () => {
  const specs: AutomationBlock['inputs'] = {
    spread: {
      label: 'Spread',
      kind: { kind: 'rollout' },
      default: { style: 'spatial', duration_ms: 1500 },
    },
  };
  assert.equal(
    materializeBlock({ $input: 'spread' }, specs, { spread: null }),
    null,
  );
});
test('usage ignores objects in comparison operands that resemble calls', () => {
  const routines = [
    {
      id: 'literal',
      name: 'Literal',
      definition_v2: {
        condition: {
          kind: 'comparison',
          source: { kind: 'helper', helper: 'payload' },
          operator: 'eq',
          value: { kind: 'block', block_id: 'unused', inputs: {} },
        },
      },
    },
  ];
  assert.deepEqual(blockUsers('unused', [], routines).routines, []);
});
