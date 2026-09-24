import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeGroupUsage,
  findExistingPath,
  findNestedCycle,
  missingGroupDevices,
  suggestId,
} from './groupGraph.ts';

const groups = [
  { id: 'all', name: 'All', linked_groups: ['living_room', 'office'] },
  { id: 'living_room', name: 'Living room', linked_groups: [] },
  { id: 'office', name: 'Office', linked_groups: ['desk'] },
  { id: 'desk', name: 'Desk', linked_groups: [] },
  { id: 'loop_a', name: 'Loop A', linked_groups: ['loop_b'] },
  { id: 'loop_b', name: 'Loop B', linked_groups: ['loop_a'] },
];

test('findNestedCycle detects a direct nesting loop', () => {
  assert.deepEqual(findNestedCycle(groups, 'all', 'all'), ['all']);
});

test('findNestedCycle follows the candidate down to the group', () => {
  // Linking 'all' into 'office' would nest all -> office -> all.
  assert.deepEqual(findNestedCycle(groups, 'office', 'all'), ['all', 'office']);
  assert.deepEqual(findNestedCycle(groups, 'desk', 'office'), [
    'office',
    'desk',
  ]);
  // 'desk' does not contain 'all' anywhere below it, so this is allowed.
  assert.equal(findNestedCycle(groups, 'all', 'desk'), null);
  assert.equal(findNestedCycle(groups, 'living_room', 'desk'), null);
  assert.equal(findNestedCycle(groups, 'office', 'living_room'), null);
});

test('findExistingPath reports redundant nesting', () => {
  assert.deepEqual(findExistingPath(groups, 'all', 'desk'), [
    'all',
    'office',
    'desk',
  ]);
  assert.equal(findExistingPath(groups, 'all', 'hallway'), null);
});

test('findNestedCycle stops on an existing unrelated loop', () => {
  // loop_a/loop_b already reference each other; asking about a third group
  // must terminate instead of recursing forever.
  assert.equal(
    findNestedCycle(
      [...groups, { id: 'fresh', name: 'Fresh', linked_groups: [] }],
      'fresh',
      'loop_a',
    ),
    null,
  );
});

test('describeGroupUsage lists the scenes and routines that target a room', () => {
  const scenes = [
    {
      id: 'normal',
      name: 'Normal',
      group_states: { living_room: { power: true }, office: { power: false } },
    },
    { id: 'night', name: 'Night', group_states: { bedroom: { power: false } } },
  ];
  const routines = [
    {
      id: 'morning',
      name: 'Morning',
      definition_v2: {
        triggers: [],
        condition: { kind: 'all', conditions: [] },
        program: {
          kind: 'native',
          steps: [{ kind: 'activate_scene', group_keys: ['living_room'] }],
        },
      },
    },
    {
      id: 'legacy',
      name: 'Legacy',
      actions: [{ action: 'ActivateScene', group_keys: ['office'] }],
    },
    {
      id: 'other',
      name: 'Other',
      actions: [{ action: 'ActivateScene', group_keys: ['kitchen'] }],
    },
  ];

  assert.deepEqual(describeGroupUsage({ scenes, routines }, 'living_room'), {
    scenes: [{ id: 'normal', name: 'Normal' }],
    routines: [{ id: 'morning', name: 'Morning' }],
  });
  assert.deepEqual(describeGroupUsage({ scenes, routines }, 'office'), {
    scenes: [{ id: 'normal', name: 'Normal' }],
    routines: [{ id: 'legacy', name: 'Legacy' }],
  });
  assert.deepEqual(describeGroupUsage({ scenes, routines }, 'bedroom'), {
    scenes: [{ id: 'night', name: 'Night' }],
    routines: [],
  });
  assert.deepEqual(describeGroupUsage({ scenes, routines }, 'nowhere'), {
    scenes: [],
    routines: [],
  });
});

test('describeGroupUsage finds group keys nested inside steps', () => {
  const routines = [
    {
      id: 'nested',
      name: 'Nested',
      definition_v2: {
        program: {
          kind: 'script',
          steps: [
            {
              kind: 'if',
              then: [{ kind: 'activate_scene', group_keys: ['kitchen'] }],
            },
          ],
        },
      },
    },
  ];
  assert.deepEqual(describeGroupUsage({ scenes: [], routines }, 'kitchen'), {
    scenes: [],
    routines: [{ id: 'nested', name: 'Nested' }],
  });
});

test('missingGroupDevices keeps unresolved members visible', () => {
  const group = {
    id: 'living_room',
    devices: [
      { integration_id: 'zigbee2mqtt', device_id: 'lamp' },
      { integration_id: 'zigbee2mqtt', device_id: 'removed_lamp' },
    ],
  };
  assert.deepEqual(missingGroupDevices(group, new Set(['zigbee2mqtt/lamp'])), [
    'zigbee2mqtt/removed_lamp',
  ]);
});

test('suggestId slugifies a name and avoids collisions', () => {
  assert.equal(suggestId('Living Room', []), 'living_room');
  assert.equal(suggestId('Övrigt & Co', []), 'ovrigt_co');
  assert.equal(suggestId('Kitchen', ['kitchen']), 'kitchen_2');
  assert.equal(suggestId('Kitchen', ['kitchen', 'kitchen_2']), 'kitchen_3');
  assert.equal(suggestId('', []), 'room');
  assert.equal(suggestId('   ', []), 'room');
  assert.equal(suggestId('3rd floor', ['3rd_floor']), '3rd_floor_2');
});
