import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  routineReferences,
  sceneUsesDeviceKeys,
  groupUsesDeviceKeys,
} from './configUsage.ts';
const device = { integration_id: 'computed', device_id: 'sun' };
const alias = { integration_id: 'circadian', device_id: 'color' };
const keys = new Set(['computed/sun', 'circadian/color']);
test('source scene usage tolerates malformed targets and retains both namespaces', () => {
  for (const target of [null, false, 0, 'future', [], { color: null }])
    assert.equal(
      sceneUsesDeviceKeys({ device_states: { bad: target } }, keys),
      false,
    );
  assert.equal(
    sceneUsesDeviceKeys(
      { device_states: { same: null }, group_states: { same: alias } },
      keys,
    ),
    true,
  );
  assert.equal(
    sceneUsesDeviceKeys(
      { device_states: { a: device }, group_states: false },
      keys,
    ),
    true,
  );
  assert.equal(
    sceneUsesDeviceKeys({ device_states: null, group_states: [alias] }, keys),
    false,
  );
});
test('source group usage recognizes canonical devices and alias keys without substring matches', () => {
  assert.equal(groupUsesDeviceKeys({ devices: [null, device] }, keys), true);
  assert.equal(
    groupUsesDeviceKeys({ device_keys: ['circadian/color'] }, keys),
    true,
  );
  assert.equal(
    groupUsesDeviceKeys(
      { devices: [{ ...device, device_id: 'sunset' }] },
      keys,
    ),
    false,
  );
  assert.equal(
    groupUsesDeviceKeys({ devices: null, device_keys: false }, keys),
    false,
  );
});
test('routine usage follows native conditions, selection, nested actions and script declarations', () => {
  const result = routineReferences({
    triggers: [
      { kind: 'report', device },
      {
        kind: 'predicate_for',
        predicate: {
          kind: 'comparison',
          source: { kind: 'helper', helper: 'trigger' },
        },
      },
    ],
    condition: {
      kind: 'all',
      conditions: [
        {
          kind: 'not',
          condition: {
            kind: 'comparison',
            source: { kind: 'computed_source', source: 'sun' },
          },
        },
      ],
    },
    program: {
      kind: 'native',
      steps: [
        {
          action: 'activate_scene',
          select: { kind: 'helper_enum', helper: 'selection' },
          targets: { devices: [alias] },
          rollout: {
            source: {
              kind: 'device',
              device: { integration_id: 'mqtt', device_id: 'origin' },
            },
          },
        },
        {
          action: 'choose',
          branches: [
            {
              condition: {
                kind: 'comparison',
                source: { kind: 'helper', helper: 'condition' },
              },
              steps: [
                { action: 'set_helper', helper: 'written', value: null },
                {
                  action: 'run_script',
                  spec: {
                    declarations: [
                      {
                        kind: 'device',
                        device: {
                          integration_id: 'mqtt',
                          device_id: 'declared',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          action: 'cycle_scenes',
          detection: {
            devices: [{ integration_id: 'mqtt', device_id: 'detect' }],
          },
          scenes: [
            {
              targets: {
                devices: [{ integration_id: 'mqtt', device_id: 'cycle' }],
              },
            },
          ],
        },
        {
          action: 'schedule_timer',
          capture_target_intents: {
            devices: [{ integration_id: 'mqtt', device_id: 'capture' }],
          },
        },
      ],
    },
  });
  assert.deepEqual([...result.helpers].sort(), [
    'condition',
    'selection',
    'trigger',
    'written',
  ]);
  assert.deepEqual([...result.sources], ['sun']);
  assert.deepEqual([...result.devices].sort(), [
    'circadian/color',
    'computed/sun',
    'mqtt/capture',
    'mqtt/cycle',
    'mqtt/declared',
    'mqtt/detect',
    'mqtt/origin',
  ]);
  assert.deepEqual(
    [
      ...routineReferences({
        program: {
          kind: 'script',
          spec: { declarations: [{ kind: 'device', device }] },
        },
      }).devices,
    ],
    ['computed/sun'],
  );
});
test('routine usage ignores lookalikes in arbitrary JSON, scripts and future node kinds', () => {
  const fake = { kind: 'helper', helper: 'not-a-dependency' };
  const refs = routineReferences({
    metadata: fake,
    triggers: [null, { kind: 'future', device }],
    condition: {
      kind: 'comparison',
      source: { kind: 'device', device },
      value: fake,
    },
    program: {
      kind: 'native',
      steps: [
        null,
        { action: 'set_helper', helper: 'real', value: fake },
        { action: 'future', targets: { devices: [alias] } },
        {
          action: 'run_script',
          spec: {
            source_body: 'computed/sun not-a-dependency',
            declarations: [null, { kind: 'all_state' }],
          },
        },
      ],
    },
  });
  assert.deepEqual([...refs.helpers], ['real']);
  assert.deepEqual([...refs.devices], ['computed/sun']);
  assert.deepEqual([...refs.sources], []);
  for (const malformed of [
    null,
    false,
    [],
    { triggers: false, condition: [], program: { kind: 'native', steps: {} } },
  ])
    assert.equal(routineReferences(malformed).devices.size, 0);
});
