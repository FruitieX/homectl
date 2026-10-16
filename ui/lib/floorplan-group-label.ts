import { getGroupOutline } from './floorplan-group-outline.ts';

export const GROUP_LABEL_FONT_SIZE = 13;
export const GROUP_LABEL_LINE_HEIGHT = GROUP_LABEL_FONT_SIZE + 3;
/** Screen-space padding around the text, matching the drawn chip. */
export const GROUP_LABEL_PADDING_X = 4;
export const GROUP_LABEL_PADDING_Y = 3;

// Map zoom at which room names reach full size. Below it they shrink with the
// map, like the device markers do, and fade until they are hidden entirely.
const FULL_SIZE_VIEW_SCALE = 0.6;
const MIN_TEXT_SCALE = 0.25;
const MIN_ALPHA = 0.35;

/**
 * Size and opacity of room names at a map zoom. Returns null once they would
 * be too small to be worth drawing.
 */
export function groupLabelZoomStyle(
  viewScale: number,
): { textScale: number; alpha: number } | null {
  const textScale = Math.min(1, viewScale / FULL_SIZE_VIEW_SCALE);
  if (!(textScale >= MIN_TEXT_SCALE)) return null;
  const fade = (textScale - MIN_TEXT_SCALE) / (1 - MIN_TEXT_SCALE);
  return { textScale, alpha: MIN_ALPHA + (1 - MIN_ALPHA) * fade };
}

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

export type GroupLabelInput = {
  id: string;
  cells: readonly Point[];
  text: string;
  /** Higher wins a collision; ties go to the larger mask. */
  priority?: number;
};

/** x/y is the chip's center in scene units; width/height are screen pixels. */
export type GroupLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// A room must be at least this big on screen before its name is shown.
const MIN_ROOM_WIDTH = 24;
const MIN_ROOM_HEIGHT = GROUP_LABEL_LINE_HEIGHT;
// Labels may spill out of their room, but never grow past this.
const MAX_LABEL_WIDTH = 200;
const LABEL_GAP = 4;
const MARKER_RADIUS = 12;
const MAX_CANDIDATES = 400;

type Candidates = { room: Rect; points: Point[] };
const candidateCache = new WeakMap<
  readonly Point[],
  Map<string, Candidates | null>
>();

/**
 * The mask's roomiest open rectangle, plus every cell center and the
 * midpoints between neighboring cells, nearest to that rectangle first. All
 * in scene units and independent of zoom, so a label only moves when a closer
 * spot gets blocked.
 */
function getCandidates(
  cells: readonly Point[],
  tileWidth: number,
  tileHeight: number,
): Candidates | null {
  const key = `${tileWidth}:${tileHeight}`;
  const cachedResult = candidateCache.get(cells)?.get(key);
  if (cachedResult !== undefined) return cachedResult;
  const room = getRoomiestRect(cells, tileWidth, tileHeight);
  let result: Candidates | null = null;
  if (room) {
    const occupied = new Set(cells.map((p) => `${p.x},${p.y}`));
    const points: Point[] = [];
    for (const cell of cells) {
      const cx = (cell.x + 0.5) * tileWidth,
        cy = (cell.y + 0.5) * tileHeight;
      points.push({ x: cx, y: cy });
      if (occupied.has(`${cell.x + 1},${cell.y}`))
        points.push({ x: cx + tileWidth / 2, y: cy });
      if (occupied.has(`${cell.x},${cell.y + 1}`))
        points.push({ x: cx, y: cy + tileHeight / 2 });
    }
    const distance = (p: Point) => Math.hypot(p.x - room.x, p.y - room.y);
    points.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
    result = { room, points: [room, ...points.slice(0, MAX_CANDIDATES)] };
  }
  const byTile =
    candidateCache.get(cells) ?? new Map<string, Candidates | null>();
  byTile.set(key, result);
  candidateCache.set(cells, byTile);
  return result;
}

/** The mask's largest roughly label-shaped open rectangle, in scene units. */
function getRoomiestRect(
  cells: readonly Point[],
  tileWidth: number,
  tileHeight: number,
): Rect | null {
  const rows = getGroupOutline(cells).labelRows;
  const byY = new Map<number, typeof rows>();
  for (const row of rows) {
    const spans = byY.get(row.y) ?? [];
    spans.push(row);
    byY.set(row.y, spans);
  }
  // Grow each span downwards; bound the search for very large masks.
  const starts = [...rows]
    .sort((a, b) => b.width - a.width || a.y - b.y)
    .slice(0, 64);
  const found: (Rect & { area: number; top: number })[] = [];
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
      const width = (right - left) * tileWidth;
      const height = (y - start.y + 1) * tileHeight;
      found.push({
        x: ((left + right) * tileWidth) / 2,
        y: (start.y - 0.5) * tileHeight + height / 2,
        width,
        height,
        // Prefer roomy, roughly label-shaped areas over long thin strips.
        area: Math.min(width, 4 * height) * Math.min(height, width),
        top: start.y,
      });
    }
  }
  found.sort((a, b) => b.area - a.area || a.top - b.top || a.x - b.x);
  const best = found[0];
  return best
    ? { x: best.x, y: best.y, width: best.width, height: best.height }
    : null;
}

/**
 * Fit text on one line: drop whole words first and only cut inside a word
 * when even the first word is too long. Either way an ellipsis marks it.
 */
function fitText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string | null {
  const full = text.trim().replace(/\s+/g, ' ');
  if (!full) return null;
  if (measure(full) <= maxWidth) return full;
  const words = full.split(' ');
  for (let count = words.length - 1; count > 0; count--) {
    const candidate = words.slice(0, count).join(' ') + '…';
    if (measure(candidate) <= maxWidth) return candidate;
  }
  const characters = Array.from(words[0]);
  while (characters.length > 1) {
    characters.pop();
    if (measure(characters.join('') + '…') <= maxWidth)
      return characters.join('') + '…';
  }
  return null;
}

function overlaps(a: Rect, b: Rect, gap: number) {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + 2 * gap &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height + 2 * gap
  );
}

type Marker = Point & { radius?: number };

function hitsMarker(box: Rect, marker: Point, radius: number) {
  const dx = Math.max(Math.abs(marker.x - box.x) - box.width / 2, 0);
  const dy = Math.max(Math.abs(marker.y - box.y) - box.height / 2, 0);
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Place every group's name as a single-line chip. Labels may overflow their
 * room, never overlap each other, and move off device markers to the nearest
 * clear spot in their room. Rooms too small to read at this zoom, or with no
 * spot left by larger rooms, get no label rather than a broken one.
 */
export function layoutGroupLabels({
  groups,
  tileWidth,
  tileHeight,
  scale,
  measure,
  avoid = [],
  markerRadius = MARKER_RADIUS,
  bounds,
  textScale = 1,
}: {
  groups: readonly GroupLabelInput[];
  tileWidth: number;
  tileHeight: number;
  scale: number;
  /** Text width in screen pixels. */
  measure: (text: string) => number;
  /** Marker centers, and optionally radii, in scene units. */
  avoid?: readonly Marker[];
  /** Screen-pixel radius for markers without their own. */
  markerRadius?: number;
  /** Scene size; chips are kept inside it. */
  bounds?: { width: number; height: number };
  /** Screen size multiplier for the chips, see `groupLabelZoomStyle`. */
  textScale?: number;
}): GroupLabel[] {
  if (scale <= 0 || textScale <= 0) return [];
  const markers = avoid.map((p) => ({
    x: p.x * scale,
    y: p.y * scale,
    radius: p.radius === undefined ? markerRadius : p.radius * scale,
  }));
  const ordered = groups
    .filter((group) => group.cells.length && group.text.trim())
    .flatMap((group) => {
      const candidates = getCandidates(group.cells, tileWidth, tileHeight);
      return candidates &&
        candidates.room.width * scale >= MIN_ROOM_WIDTH * textScale &&
        candidates.room.height * scale >= MIN_ROOM_HEIGHT * textScale
        ? [{ group, points: candidates.points }]
        : [];
    })
    .sort(
      (a, b) =>
        (b.group.priority ?? 0) - (a.group.priority ?? 0) ||
        b.group.cells.length - a.group.cells.length ||
        a.group.id.localeCompare(b.group.id),
    );

  const placed: (Rect & { label: GroupLabel })[] = [];
  for (const { group, points } of ordered) {
    const text = fitText(
      group.text,
      MAX_LABEL_WIDTH - 2 * GROUP_LABEL_PADDING_X,
      measure,
    );
    if (!text) continue;
    const width = (measure(text) + 2 * GROUP_LABEL_PADDING_X) * textScale;
    const height =
      (GROUP_LABEL_LINE_HEIGHT + 2 * GROUP_LABEL_PADDING_Y) * textScale;
    // Prefer the nearest spot clear of markers, else the one covering fewest.
    let best: Rect | null = null,
      bestHits = Infinity;
    for (const point of points) {
      let x = point.x * scale;
      let y = point.y * scale;
      if (bounds) {
        const maxX = bounds.width * scale - width / 2;
        const maxY = bounds.height * scale - height / 2;
        if (maxX >= width / 2) x = Math.min(Math.max(x, width / 2), maxX);
        if (maxY >= height / 2) y = Math.min(Math.max(y, height / 2), maxY);
      }
      const box = { x, y, width, height };
      if (placed.some((other) => overlaps(box, other, LABEL_GAP * textScale)))
        continue;
      let hits = 0;
      for (const marker of markers)
        if (hitsMarker(box, marker, marker.radius) && ++hits >= bestHits) break;
      if (hits < bestHits) {
        best = box;
        bestHits = hits;
        if (!hits) break;
      }
    }
    if (!best) continue;
    placed.push({
      ...best,
      label: {
        id: group.id,
        text,
        x: best.x / scale,
        y: best.y / scale,
        width,
        height,
      },
    });
  }
  return placed.map(({ label }) => label);
}
