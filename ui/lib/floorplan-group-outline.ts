type Point = { x: number; y: number };
export type GroupOutline = {
  edges: { a: Point; b: Point }[];
  labelRows: { x: number; y: number; width: number }[];
};
const cache = new WeakMap<readonly Point[], GroupOutline>();

/** Merge exposed cell edges; never draw the internal grid of a room mask. */
export function getGroupOutline(cells: readonly Point[]): GroupOutline {
  const cached = cache.get(cells);
  if (cached) return cached;
  const occupied = new Set(cells.map((p) => `${p.x},${p.y}`));
  const edges = new Map<string, number[]>();
  const rows = new Map<number, number[]>();
  const add = (axis: 'h' | 'v', fixed: number, start: number) => {
    const key = `${axis}:${fixed}`;
    const values = edges.get(key) ?? [];
    values.push(start);
    edges.set(key, values);
  };
  for (const key of occupied) {
    const [x, y] = key.split(',').map(Number);
    if (!occupied.has(`${x},${y - 1}`)) add('h', y, x);
    if (!occupied.has(`${x},${y + 1}`)) add('h', y + 1, x);
    if (!occupied.has(`${x - 1},${y}`)) add('v', x, y);
    if (!occupied.has(`${x + 1},${y}`)) add('v', x + 1, y);
    const row = rows.get(y) ?? [];
    row.push(x);
    rows.set(y, row);
  }
  const merge = (
    values: number[],
    visit: (start: number, end: number) => void,
  ) => {
    values.sort((a, b) => a - b);
    let start = values[0],
      end = start + 1;
    for (let i = 1; i < values.length; i++) {
      if (values[i] === end) end++;
      else {
        visit(start, end);
        start = values[i];
        end = start + 1;
      }
    }
    visit(start, end);
  };
  const result: GroupOutline = { edges: [], labelRows: [] };
  for (const [key, values] of edges) {
    const [axis, fixed] = key.split(':');
    merge(values, (start, end) =>
      result.edges.push(
        axis === 'h'
          ? {
              a: { x: start, y: Number(fixed) },
              b: { x: end, y: Number(fixed) },
            }
          : {
              a: { x: Number(fixed), y: start },
              b: { x: Number(fixed), y: end },
            },
      ),
    );
  }
  for (const [y, values] of [...rows].sort(([a], [b]) => a - b))
    merge(values, (start, end) =>
      result.labelRows.push({ x: start, y: y + 0.5, width: end - start }),
    );
  cache.set(cells, result);
  return result;
}
