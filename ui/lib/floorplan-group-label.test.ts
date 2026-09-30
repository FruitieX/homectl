import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGroupLabelLayout } from './floorplan-group-label.ts';
import { floorplanLabels } from './floorplan-labels.ts';
import { readFloorplanDraft } from './floorplanDraft.ts';
import { deserializeGrid } from './floorplan-editor.ts';

const rectangle = (w: number, h: number, x = 0, y = 0) =>
  Array.from({ length: h }, (_, dy) =>
    Array.from({ length: w }, (_, dx) => ({ x: x + dx, y: y + dy })),
  ).flat();
const layout = (cells: { x: number; y: number }[], text: string, scale = 1) =>
  getGroupLabelLayout({
    cells,
    text,
    tileWidth: 32,
    tileHeight: 32,
    scale,
    measure: (text) => text.length * 6,
  });

test('room labels wrap inside a narrow area at different zoom levels', () => {
  for (const scale of [0.5, 1, 2]) {
    const result = layout(
      rectangle(4, 6),
      'Living room and reading corner',
      scale,
    )!;
    assert(result);
    assert(result.lines.length > 1 || scale === 2);
    assert.equal(result.lines.join(' '), 'Living room and reading corner');
    assert(
      result.x - result.width / 2 >= 0 && result.x + result.width / 2 <= 128,
    );
    assert(result.y >= 0 && result.y + result.height <= 192);
    assert(
      result.lines.every((line) => line.length * 6 <= result.width * scale),
    );
  }
});
test('multiline labels stay inside concave and disconnected group masks', () => {
  const cells = [
    ...rectangle(1, 2),
    ...rectangle(5, 3, 0, 2),
    ...rectangle(1, 1, 9, 0),
  ];
  const result = layout(cells, 'Kitchen and dining area')!;
  assert(result);
  assert.equal(result.lines.join(' '), 'Kitchen and dining area');
  for (let y = result.y; y < result.y + result.height; y += 2)
    for (
      let x = result.x - result.width / 2;
      x < result.x + result.width / 2;
      x += 2
    )
      assert(
        cells.some(
          (p) => p.x === Math.floor(x / 32) && p.y === Math.floor(y / 32),
        ),
      );
});
test('label anchors stay fixed through zoom and text reflow, including marker avoidance', () => {
  const cells = [
    ...rectangle(2, 2),
    ...rectangle(7, 6, 0, 2),
    ...rectangle(5, 4, 10, 0),
  ];
  const labels = [0.5, 0.75, 1, 1.5, 2, 4].map((scale) =>
    getGroupLabelLayout({
      cells,
      text: 'Living room and reading corner by the window',
      tileWidth: 32,
      tileHeight: 32,
      scale,
      measure: (text) => text.length * 6,
      avoid: [{ x: 112, y: 84 }],
    })!,
  );
  assert(labels.every(Boolean));
  assert(new Set(labels.map((label) => label.lines.join('\n'))).size > 1);
  assert.deepEqual(
    labels.map(({ x, y }) => ({ x, y })),
    labels.map(() => ({ x: labels[0].x, y: labels[0].y })),
  );
});
test('small group labels truncate safely; tiny or empty masks omit the label', () => {
  const result = layout(
    rectangle(2, 1),
    'Extremely long name without enough space',
  )!;
  assert(result.lines.at(-1)!.endsWith('…'));
  assert(result.lines.every((line) => line.length * 6 <= result.width));
  assert.equal(layout([], 'Room'), null);
  assert.equal(layout(rectangle(1, 1), 'Room', 0.1), null);
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
