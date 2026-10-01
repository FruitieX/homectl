import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorplanLabels, hiddenFloorplanLabels } from './floorplan-labels.ts';

test('saved label visibility wins over the legacy label mode', () => {
  const visibility = { lights: true, sensors: false, groups: false };
  assert.deepEqual(
    floorplanLabels({ labelVisibility: visibility }),
    visibility,
  );
  assert.deepEqual(
    floorplanLabels({ labelVisibility: visibility, labelMode: 'none' }),
    visibility,
  );
});

test('legacy label modes keep their layer meaning', () => {
  // A floorplan saved before visibility existed defaults to sensor labels.
  assert.deepEqual(floorplanLabels(undefined), {
    lights: false,
    sensors: true,
    groups: true,
  });
  assert.deepEqual(floorplanLabels({ labelMode: 'all' }), {
    lights: true,
    sensors: true,
    groups: true,
  });
  assert.deepEqual(floorplanLabels({ labelMode: 'lights' }), {
    lights: true,
    sensors: false,
    groups: true,
  });
  assert.deepEqual(floorplanLabels({ labelMode: 'none' }), {
    lights: false,
    sensors: false,
    groups: false,
  });
});

test('embedded previews hide every layer, whatever the floorplan enables', () => {
  assert.deepEqual(hiddenFloorplanLabels(), {
    lights: false,
    sensors: false,
    groups: false,
  });
  // A caller adjusting its copy must not affect the next scene.
  const hidden = hiddenFloorplanLabels();
  hidden.groups = true;
  assert.deepEqual(hiddenFloorplanLabels(), {
    lights: false,
    sensors: false,
    groups: false,
  });
});
