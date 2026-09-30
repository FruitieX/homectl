import { getGroupOutline } from './floorplan-group-outline.ts';

type Point = { x: number; y: number };
type Label = {
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

function wrap(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (line && measure(line + ' ' + word) <= width) {
      line += ' ' + word;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // Long names without spaces can wrap too.
    for (const character of word) {
      if (line && measure(line + character) > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Wrap in a stable mask rectangle. x is its center; y is the text's top edge. */
export function getGroupLabelLayout({
  cells,
  text,
  tileWidth,
  tileHeight,
  scale,
  measure,
  fontSize = 11,
  avoid = [],
}: {
  cells: readonly Point[];
  text: string;
  tileWidth: number;
  tileHeight: number;
  scale: number;
  measure: (text: string) => number;
  fontSize?: number;
  avoid?: readonly Point[];
}): Label | null {
  if (!text.trim() || scale <= 0) return null;
  const rows = getGroupOutline(cells).labelRows;
  const byY = new Map<number, typeof rows>();
  for (const row of rows) {
    const spans = byY.get(row.y) ?? [];
    spans.push(row);
    byY.set(row.y, spans);
  }
  // Choose the anchor in scene units, independent of zoom or wrapping.
  const padding = 6;
  // Prefer wide spans near the top. Bound the search for very large masks.
  const starts = [...rows]
    .sort((a, b) => b.width - a.width || a.y - b.y)
    .slice(0, 64);
  let best: { x: number; y: number; width: number; height: number } | null =
      null,
    bestScore = -Infinity;
  for (const start of starts) {
    let left = start.x,
      right = start.x + start.width;
    for (let y = start.y; ; y++) {
      if (y !== start.y) {
        const next = (byY.get(y) ?? [])
          .filter((r) => r.x < right && r.x + r.width > left)
          .sort(
            (a, b) =>
              Math.min(right, b.x + b.width) -
              Math.max(left, b.x) -
              (Math.min(right, a.x + a.width) - Math.max(left, a.x)),
          )[0];
        if (!next) break;
        left = Math.max(left, next.x);
        right = Math.min(right, next.x + next.width);
      }
      const width = (right - left) * tileWidth - 2 * padding;
      const height = (y - start.y + 1) * tileHeight - 2 * padding;
      if (width <= 0) break;
      if (height > 0) {
        const x = ((left + right) * tileWidth) / 2;
        const top = (start.y - 0.5) * tileHeight + padding;
        const reservedHeight = Math.min(height, 4 * (fontSize + 3));
        const collision = avoid.some(
          (p) =>
            Math.abs(p.x - x) < width / 2 + 20 &&
            Math.abs(p.y - (top + reservedHeight / 2)) <
              reservedHeight / 2 + 24,
        );
        const score = width * reservedHeight - (collision ? 1e9 : 0) - start.y;
        if (
          score > bestScore ||
          (score === bestScore && height > best!.height)
        ) {
          bestScore = score;
          best = { x, y: top, width, height };
        }
      }
    }
  }
  if (!best || best.width * scale < 24) return null;
  const lineHeight = (fontSize + 3) / scale;
  const count = Math.min(4, Math.floor(best.height / lineHeight));
  if (!count) return null;
  const all = wrap(text, best.width * scale, measure),
    lines = all.slice(0, count);
  if (all.length > count) {
    let last = Array.from(lines.at(-1)!);
    while (last.length && measure(last.join('') + '…') > best.width * scale)
      last.pop();
    lines[lines.length - 1] = last.join('') + '…';
  }
  return { ...best, lines, height: lines.length * lineHeight };
}
