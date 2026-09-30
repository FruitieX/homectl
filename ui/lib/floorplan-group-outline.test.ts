import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGroupOutline } from './floorplan-group-outline.ts';
const rectangle = (width: number, height: number) =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x, y })),
  ).flat();
const perimeter = (cells: { x: number; y: number }[]) =>
  getGroupOutline(cells).edges.reduce(
    (sum, e) => sum + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y),
    0,
  );

test('a rectangular room has four merged boundary runs and no internal grid', () => {
  const cells = rectangle(5, 3),
    result = getGroupOutline(cells);
  assert.equal(result.edges.length, 4);
  assert.equal(perimeter(cells), 16);
  assert.deepEqual(result.labelRows, [
    { x: 0, y: 0.5, width: 5 },
    { x: 0, y: 1.5, width: 5 },
    { x: 0, y: 2.5, width: 5 },
  ]);
});
test('concave room outlines and label spans follow the actual painted area', () => {
  const cells = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    result = getGroupOutline(cells);
  assert.equal(result.edges.length, 6);
  assert.equal(perimeter(cells), 8);
  assert.deepEqual(result.labelRows, [
    { x: 0, y: 0.5, width: 1 },
    { x: 0, y: 1.5, width: 2 },
  ]);
  for (const row of result.labelRows)
    for (let x = row.x; x < row.x + row.width; x++)
      assert.ok(
        cells.some((p) => p.x === x && p.y === Math.floor(row.y)),
        'label span stays inside the room',
      );
});
test('holes retain their boundaries without filling the missing cell', () => {
  const cells = rectangle(3, 3).filter((p) => p.x !== 1 || p.y !== 1),
    result = getGroupOutline(cells);
  assert.equal(result.edges.length, 8);
  assert.equal(perimeter(cells), 16);
  assert.deepEqual(
    result.labelRows.filter((r) => r.y === 1.5),
    [
      { x: 0, y: 1.5, width: 1 },
      { x: 2, y: 1.5, width: 1 },
    ],
  );
});
test('disconnected areas and duplicate cells do not create phantom shared borders', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 0, y: 0 },
  ];
  assert.equal(getGroupOutline(cells).edges.length, 8);
  assert.equal(perimeter(cells), 8);
  assert.deepEqual(getGroupOutline(cells).labelRows, [
    { x: 0, y: 0.5, width: 1 },
    { x: 3, y: 0.5, width: 1 },
  ]);
  assert.deepEqual(getGroupOutline([]), { edges: [], labelRows: [] });
});
