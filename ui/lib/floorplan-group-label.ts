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

/** Fit wrapped text into a rectangle wholly inside the painted mask, in scene units. */
export function getGroupLabelLayout({
  cells,
  text,
  tileWidth,
  tileHeight,
  scale,
  measure,
  fontSize = 10,
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
  const padding = 6 / scale,
    lineHeight = (fontSize + 3) / scale;
  // Prefer wide spans near the top. Bound the search for very large masks.
  const starts = [...rows]
    .sort((a, b) => b.width - a.width || a.y - b.y)
    .slice(0, 64);
  let best: Label | null = null,
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
      const count = Math.min(4, Math.floor(height / lineHeight));
      if (width * scale < 24) break;
      if (count > 0) {
        const all = wrap(text, width * scale, measure),
          lines = all.slice(0, count);
        if (all.length > count) {
          let last = Array.from(lines.at(-1)!);
          while (last.length && measure(last.join('') + '…') > width * scale)
            last.pop();
          lines[lines.length - 1] = last.join('') + '…';
        }
        const x = ((left + right) * tileWidth) / 2;
        const labelHeight = lines.length * lineHeight;
        const centerY =
          (start.y - 0.5) * tileHeight + padding + labelHeight / 2;
        const collision = avoid.some(
          (p) =>
            Math.abs(p.x - x) < width / 2 + 20 / scale &&
            Math.abs(p.y - centerY) < labelHeight / 2 + 24 / scale,
        );
        const score =
          (all.length <= count ? 10000 : lines.join('').length * 10) -
          (collision ? 20000 : 0) -
          lines.length -
          start.y;
        if (score > bestScore) {
          bestScore = score;
          best = { lines, x, y: centerY, width, height: labelHeight };
        }
        if (all.length <= count) break;
      }
      if (height >= 4 * lineHeight) break;
    }
  }
  return best;
}
