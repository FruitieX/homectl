import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupLabelZoomStyle,
  layoutGroupLabels,
} from './floorplan-group-label.ts';
import { floorplanLabels } from './floorplan-labels.ts';
import { readFloorplanDraft } from './floorplanDraft.ts';
import { deserializeGrid } from './floorplan-editor.ts';

const rectangle = (w: number, h: number, x = 0, y = 0) =>
  Array.from({ length: h }, (_, dy) =>
    Array.from({ length: w }, (_, dx) => ({ x: x + dx, y: y + dy })),
  ).flat();
const measure = (text: string) => text.length * 6;
const layout = (
  groups: { id: string; cells: { x: number; y: number }[]; text: string }[],
  scale = 1,
  avoid: { x: number; y: number }[] = [],
) =>
  layoutGroupLabels({
    groups,
    tileWidth: 32,
    tileHeight: 32,
    scale,
    measure,
    avoid,
  });
const box = (label: ReturnType<typeof layout>[number], scale = 1) => ({
  left: label.x * scale - label.width / 2,
  right: label.x * scale + label.width / 2,
  top: label.y * scale - label.height / 2,
  bottom: label.y * scale + label.height / 2,
});

test('narrow rooms keep whole words on one line and may overflow', () => {
  for (const scale of [0.5, 1, 2]) {
    const [label] = layout(
      [{ id: 'entry', cells: rectangle(2, 3), text: 'Entryway' }],
      scale,
    );
    assert(label, `label at ${scale}`);
    assert.equal(label.text, 'Entryway');
    assert.equal(label.width, measure('Entryway') + 8);
  }
  const [label] = layout([
    { id: 'out', cells: rectangle(1, 6), text: 'Outdoor lights' },
  ]);
  assert.equal(label.text, 'Outdoor lights');
  assert(label.width > 32);
});

test('long names drop whole words before cutting into one', () => {
  const [label] = layout([
    {
      id: 'living',
      cells: rectangle(6, 4),
      text: 'Living room and reading corner by the big window overlooking the yard',
    },
  ]);
  assert(label.text.endsWith('…'));
  assert(
    'Living room and reading corner by the big window overlooking the yard'.startsWith(
      label.text.slice(0, -1) + ' ',
    ),
  );
  assert(label.width <= 200);
  const [word] = layout([
    { id: 'word', cells: rectangle(6, 4), text: 'x'.repeat(60) },
  ]);
  assert.equal(word.text, 'x'.repeat(31) + '…');
});

test('labels never overlap and larger rooms win collisions', () => {
  const labels = layout(
    [
      { id: 'small', cells: rectangle(2, 2, 6, 2), text: 'Bathroom upstairs' },
      { id: 'large', cells: rectangle(6, 6), text: 'Living room' },
    ],
    0.5,
  );
  assert.deepEqual(
    labels.map((label) => label.id),
    ['large'],
  );
  const spread = layout(
    [
      { id: 'a', cells: rectangle(4, 4), text: 'Kitchen' },
      { id: 'b', cells: rectangle(4, 4, 6, 0), text: 'Hall' },
      { id: 'c', cells: rectangle(4, 4, 0, 6), text: 'Bedroom' },
    ],
    1,
  );
  assert.equal(spread.length, 3);
  for (const a of spread)
    for (const b of spread) {
      if (a === b) continue;
      const p = box(a),
        q = box(b);
      assert(
        p.right <= q.left ||
          q.right <= p.left ||
          p.bottom <= q.top ||
          q.bottom <= p.top,
      );
    }
});

test('labels step aside for markers when the room has room', () => {
  const cells = [...rectangle(4, 2), ...rectangle(4, 4, 0, 2)];
  const free = layout([{ id: 'room', cells, text: 'Kitchen' }]);
  const marker = { x: free[0].x, y: free[0].y };
  const [moved] = layout([{ id: 'room', cells, text: 'Kitchen' }], 1, [marker]);
  assert(moved);
  assert.notDeepEqual({ x: moved.x, y: moved.y }, marker);
});

test('anchors stay put while zooming and tiny rooms are hidden', () => {
  const cells = [...rectangle(2, 2), ...rectangle(7, 6, 0, 2)];
  const anchors = [0.75, 1, 1.5, 2, 4].map(
    (scale) => layout([{ id: 'room', cells, text: 'Living room' }], scale)[0],
  );
  assert(anchors.every(Boolean));
  assert.equal(new Set(anchors.map(({ x, y }) => `${x},${y}`)).size, 1);
  assert.deepEqual(
    layout([{ id: 'r', cells: rectangle(1, 1), text: 'Room' }], 0.1),
    [],
  );
  assert.deepEqual(layout([{ id: 'r', cells: [], text: 'Room' }]), []);
  assert.deepEqual(
    layout([{ id: 'r', cells: rectangle(2, 2), text: ' ' }]),
    [],
  );
});

test('label toggles retain old defaults and survive both floorplan readers', () => {
  assert.deepEqual(floorplanLabels({ labelMode: 'sensors' }), {
    lights: false,
    sensors: true,
    groups: true,
  });
  assert.deepEqual(floorplanLabels({ labelMode: 'none' }), {
    lights: false,
    sensors: false,
    groups: false,
  });
  const labelVisibility = { lights: true, sensors: false, groups: false };
  const grid = {
    width: 2,
    height: 2,
    tileSize: 32,
    deviceScale: 1,
    tiles: [
      ['floor', 'floor'],
      ['floor', 'floor'],
    ],
    devices: [],
    groups: {},
    labelVisibility,
  };
  const raw = JSON.stringify(grid);
  assert.deepEqual(
    floorplanLabels(readFloorplanDraft(raw).grid),
    labelVisibility,
  );
  assert.deepEqual(floorplanLabels(deserializeGrid(raw)), labelVisibility);
  assert.equal(
    readFloorplanDraft(
      JSON.stringify({
        ...grid,
        labelVisibility: { ...labelVisibility, groups: 'yes' },
      }),
    ).grid,
    null,
  );
});

test('room names shrink and fade as the map zooms out', () => {
  assert.deepEqual(groupLabelZoomStyle(1), { textScale: 1, alpha: 1 });
  const half = groupLabelZoomStyle(0.3);
  const small = groupLabelZoomStyle(0.2);
  assert(half && small);
  assert(small.textScale < half.textScale && half.textScale < 1);
  assert(small.alpha < half.alpha && half.alpha < 1);
  assert.equal(groupLabelZoomStyle(0.05), null);

  const cells = rectangle(4, 2);
  const [full] = layoutGroupLabels({
    groups: [{ id: 'kitchen', cells, text: 'Kitchen' }],
    tileWidth: 32,
    tileHeight: 32,
    scale: 1,
    measure,
  });
  const [shrunk] = layoutGroupLabels({
    groups: [{ id: 'kitchen', cells, text: 'Kitchen' }],
    tileWidth: 32,
    tileHeight: 32,
    scale: 1,
    measure,
    textScale: 0.5,
  });
  assert.equal(shrunk.text, 'Kitchen');
  assert.equal(shrunk.width, full.width / 2);
  assert.equal(shrunk.height, full.height / 2);
});
