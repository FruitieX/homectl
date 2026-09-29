import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFloorplanDraft } from './floorplanDraft.ts';
import { describeConflictValue } from './conflictPresentation.ts';
const grid = {
  width: 2,
  height: 2,
  tileSize: 20,
  tiles: [
    ['wall', 'window'],
    ['floor', 'door'],
  ],
  devices: [
    {
      deviceKey: 'dummy/lamp',
      deviceName: 'Lamp',
      x: 1,
      y: 0,
      future: { keep: true },
    },
  ],
  groups: { room: [{ x: 0, y: 1, future: 'mask' }] },
  labelMode: 'all',
  deviceScale: 1.1,
  future: { keep: [2, 1] },
};
test('floorplan authoring preserves labels, unavailable placements and extension data', () => {
  const parsed = readFloorplanDraft(JSON.stringify(grid));
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.grid, grid);
});
test('malformed or future layouts are kept out of drawing controls instead of silently repaired', () => {
  for (const bad of [
    { ...grid, width: 0 },
    { ...grid, tiles: [['wall']] },
    { ...grid, labelMode: 'future-mode' },
    { ...grid, devices: [{ ...grid.devices[0], x: 3 }] },
    { ...grid, groups: { room: [{ x: 0.5, y: 1 }] } },
  ])
    assert.equal(readFloorplanDraft(JSON.stringify(bad)).grid, null);
});
test('floorplan conflict summaries show layout dimensions and omit uploaded image bytes', () => {
  assert.match(
    describeConflictValue(JSON.stringify(grid), '/grid_data'),
    /2 × 2 tiles · 1 placed devices/,
  );
  const text = describeConflictValue(
    {
      kind: 'upload',
      mime_type: 'image/png',
      data_base64: 'private-image-bytes',
    },
    '/image',
  );
  assert(!text.includes('private-image-bytes'));
  assert(text.includes('Uploaded image data'));
});
