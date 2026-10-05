import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  lightCalibration,
  planCalibrationSave,
  profileChannelSummary,
} from './calibrationProfiles.ts';

const point = {
  reference: { u: 0.2, v: 0.47 },
  output: { u: 0.21, v: 0.48 },
};
const curve = [
  { logical: 0.1, output: 0.2 },
  { logical: 1, output: 0.9 },
];
const profile = {
  id: 'model',
  name: 'Hue Go',
  points: [point],
  brightness_points: [],
  reference_device_key: 'mqtt/ref',
  brightness: 0.5,
};
const view = (assigned: string[], legacy = false) => ({
  profiles: [profile],
  assignments: assigned.map((device_key) => ({
    device_key,
    profile_id: 'model',
  })),
  legacy: legacy
    ? [{ device_key: 'mqtt/old', points: [point], brightness_points: curve }]
    : [],
  revision_token: 'r',
});
const plan = (
  assigned: string[],
  deviceKey: string,
  change: object,
  scope: 'shared' | 'copy' = 'shared',
  legacy = false,
) =>
  planCalibrationSave({
    view: view(assigned, legacy),
    deviceKey,
    change,
    scope,
    newId: 'new',
    defaultName: 'Desk lamp calibration',
  });

describe('calibration profiles', () => {
  it('summarizes a light and its channels', () => {
    const light = lightCalibration(view(['mqtt/a', 'mqtt/b']), 'mqtt/a');
    assert.equal(light.kind, 'profile');
    assert.deepEqual(light.sharedWith, ['mqtt/b']);
    assert.equal(lightCalibration(view([], true), 'mqtt/old').kind, 'legacy');
    assert.equal(lightCalibration(view([]), 'mqtt/x').kind, 'none');
    assert.equal(profileChannelSummary(profile), 'Color · 1 point');
    assert.equal(
      profileChannelSummary({ points: [], brightness_points: curve }),
      'Brightness · 2-point curve',
    );
  });

  it('adds a brightness curve to the same profile instead of forking it', () => {
    const edit = plan(['mqtt/a', 'mqtt/b'], 'mqtt/a', {
      brightness_points: curve,
    });
    assert.equal(edit.profile_id, 'model');
    assert.deepEqual(edit.profile?.points, [point]);
    assert.deepEqual(edit.profile?.brightness_points, curve);
    assert.equal(edit.profile?.name, 'Hue Go');
  });

  it('saves a copy for one light when asked, keeping the shared profile', () => {
    const edit = plan(
      ['mqtt/a', 'mqtt/b'],
      'mqtt/a',
      { brightness_points: curve },
      'copy',
    );
    assert.equal(edit.profile_id, 'new');
    assert.equal(edit.profile?.name, 'Desk lamp calibration');
    assert.deepEqual(edit.profile?.points, [point]);
    assert.deepEqual(edit.device_keys, ['mqtt/a']);
  });

  it('edits in place when no other light shares the profile', () => {
    assert.equal(
      plan(['mqtt/a'], 'mqtt/a', { name: 'Renamed' }, 'copy').profile?.id,
      'model',
    );
  });

  it('creates a profile for an uncalibrated light, seeded from legacy data', () => {
    const fresh = plan([], 'mqtt/x', { brightness_points: curve });
    assert.equal(fresh.profile?.id, 'new');
    assert.deepEqual(fresh.profile?.points, []);
    const legacy = plan([], 'mqtt/old', { points: [] }, 'shared', true);
    assert.deepEqual(legacy.profile?.brightness_points, curve);
    assert.deepEqual(legacy.profile?.points, []);
  });

  it('removes calibration once both channels are empty', () => {
    assert.deepEqual(plan(['mqtt/a'], 'mqtt/a', { points: [] }), {
      device_keys: ['mqtt/a'],
      profile_id: null,
      delete_profile_id: 'model',
    });
    // A shared profile survives when only this light drops it.
    assert.deepEqual(
      plan(['mqtt/a', 'mqtt/b'], 'mqtt/a', { points: [] }, 'copy'),
      { device_keys: ['mqtt/a'], profile_id: null, delete_profile_id: null },
    );
  });
});
