import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConfigDiagnostic } from '../bindings/ConfigDiagnostic';
import { diagnosticFix } from './diagnosticFixes.ts';

const issue = (code: string, reference: string): ConfigDiagnostic => ({
  id: code,
  severity: 'warning',
  entity:
    code.includes('group_') && !code.includes('scene') ? 'group' : 'scene',
  entity_id: 'x',
  name: 'X',
  code,
  message: '',
  suggestion: '',
  device_keys: [],
  reference,
});
const group = {
  id: 'living',
  name: 'Living',
  hidden: false,
  devices: [
    { integration_id: 'z', device_id: 'lamp' },
    { integration_id: 'z', device_id: 'gone' },
  ],
  linked_groups: ['kitchen', 'attic'],
};
const scene = {
  id: 'night',
  name: 'Night',
  device_states: { 'z/lamp': { power: true }, 'z/gone': { power: false } },
  group_states: { kitchen: { power: true }, attic: { power: true } },
  group_state_order: ['attic', 'kitchen'],
};

test('removes only the missing group member and keeps other fields', () => {
  const fix = diagnosticFix(issue('missing_group_device', 'z/gone'));
  assert.equal(fix?.entity, 'group');
  const fixed = fix!.entity === 'group' ? fix!.apply(group) : group;
  assert.deepEqual(fixed.devices, [{ integration_id: 'z', device_id: 'lamp' }]);
  assert.equal(fixed.hidden, false);
});

test('removes a missing nested group link', () => {
  const fix = diagnosticFix(issue('missing_group_link', 'attic'));
  const fixed = fix!.entity === 'group' ? fix!.apply(group) : group;
  assert.deepEqual(fixed.linked_groups, ['kitchen']);
});

test('removes missing scene targets, including their order entry', () => {
  const device = diagnosticFix(issue('missing_scene_device', 'z/gone'));
  const groupFix = diagnosticFix(issue('missing_scene_group', 'attic'));
  const a = device!.entity === 'scene' ? device!.apply(scene) : scene;
  const b = groupFix!.entity === 'scene' ? groupFix!.apply(scene) : scene;
  assert.deepEqual(Object.keys(a.device_states), ['z/lamp']);
  assert.deepEqual(Object.keys(b.group_states), ['kitchen']);
  assert.deepEqual(b.group_state_order, ['kitchen']);
});

test('issues that need a choice have no one-click fix', () => {
  assert.equal(diagnosticFix(issue('missing_scene_link', 'z/lamp')), null);
  assert.equal(diagnosticFix(issue('missing_group_device', '')), null);
});
