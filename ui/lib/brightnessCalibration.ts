/**
 * Brightness calibration, as pure functions: the curve a person edits, whether
 * it is valid, and what it does to a level. Kept free of UI imports so the
 * wizard, the device page, and the tests share one answer.
 *
 * Levels are fractions in `(0, 1]`; the UI shows percentages. The forward and
 * inverse maps mirror `server/src/core/color_calibration.rs` so the preview the
 * person checks is the command the server sends.
 */

export type BrightnessPoint = {
  /** Desired brightness shown in homectl. */
  logical: number;
  /** Brightness command sent to the device. */
  output: number;
};

export const BRIGHTNESS_MIN_POINTS = 2;
export const BRIGHTNESS_MAX_POINTS = 16;
/** Smallest step a person can enter: a tenth of a percent. */
export const BRIGHTNESS_FINE_STEP = 0.001;
export const BRIGHTNESS_COARSE_STEP = 0.01;

/** Editable starting points: high, middle, low. Never a required sequence. */
export function suggestedBrightnessPoints(): BrightnessPoint[] {
  return [
    { logical: 1, output: 1 },
    { logical: 0.5, output: 0.5 },
    { logical: 0.1, output: 0.1 },
  ];
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function sortBrightnessPoints(
  points: BrightnessPoint[],
): BrightnessPoint[] {
  return [...points].sort((left, right) => left.logical - right.logical);
}

/**
 * Add a desired level, keeping the curve ordered. The new point starts as
 * identity so nothing is invented for the person.
 */
export function addBrightnessPoint(
  points: BrightnessPoint[],
  logical: number,
): BrightnessPoint[] {
  if (!Number.isFinite(logical)) return points;
  const next = sortBrightnessPoints([
    ...points.filter((point) => Math.abs(point.logical - logical) > 1e-6),
    { logical: round(logical), output: round(logical) },
  ]);
  return next.slice(0, BRIGHTNESS_MAX_POINTS);
}

export function removeBrightnessPoint(
  points: BrightnessPoint[],
  logical: number,
): BrightnessPoint[] {
  return points.filter((point) => Math.abs(point.logical - logical) > 1e-6);
}

export function setBrightnessPoint(
  points: BrightnessPoint[],
  index: number,
  field: 'logical' | 'output',
  value: number,
): BrightnessPoint[] {
  return points.map((point, position) =>
    position === index ? { ...point, [field]: round(value) } : point,
  );
}

/** Nudge a percentage by a coarse (±1%) or fine (±0.1%) step. */
export function stepBrightnessValue(
  value: number,
  direction: 'up' | 'down',
  step: number = BRIGHTNESS_COARSE_STEP,
): number {
  const delta = direction === 'up' ? step : -step;
  return Math.min(1, Math.max(BRIGHTNESS_FINE_STEP, round(value + delta)));
}

export function formatPercent(value: number, decimals = 1): string {
  const percent = value * 100;
  const fixed = percent.toFixed(decimals);
  // 4.20% reads better as 4.2%; 100.0% keeps one decimal like the others.
  const trimmed = fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed;
  return `${trimmed}%`;
}

/** Parse what a person typed into a fraction. Accepts `4.2`, `4,2`, `4.2%`. */
export function parsePercent(text: string): number | null {
  const cleaned = text.trim().replace('%', '').replace(',', '.');
  if (cleaned === '') {
    // An empty field means "not chosen yet" — never zero.
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value / 100;
}

/** One sentence for the row a person is editing, or null when it is fine. */
export function brightnessPointError(
  points: BrightnessPoint[],
  index: number,
): string | null {
  const point = points[index];
  if (!point) return null;
  if (!Number.isFinite(point.logical) || !Number.isFinite(point.output)) {
    return 'Enter a number for both values';
  }
  if (point.logical <= 0 || point.logical > 1) {
    return 'Desired brightness runs from just above 0% up to 100%';
  }
  if (point.output <= 0 || point.output > 1) {
    return 'Target output runs from just above 0% up to 100%';
  }
  const duplicate = points.some(
    (other, position) =>
      position !== index && Math.abs(other.logical - point.logical) < 1e-6,
  );
  if (duplicate) {
    return 'Two points cannot ask for the same desired brightness';
  }
  // Rows can be listed in any order while editing; the drop rule is about
  // desired brightness, so compare against the levels below this one.
  const ordered = sortBrightnessPoints(points);
  const position = ordered.findIndex(
    (other) => Math.abs(other.logical - point.logical) < 1e-6,
  );
  const earlier = ordered
    .slice(0, position)
    .some((other) => other.output > point.output + 1e-9);
  if (earlier) {
    return 'Target output cannot drop as desired brightness rises';
  }
  return null;
}

/** Whole-curve validation: what actually blocks Save. */
export function brightnessCurveError(points: BrightnessPoint[]): string | null {
  if (points.length === 0) return null;
  if (points.length < BRIGHTNESS_MIN_POINTS) {
    return `Add at least ${BRIGHTNESS_MIN_POINTS} points, or remove the calibration`;
  }
  if (points.length > BRIGHTNESS_MAX_POINTS) {
    return `A curve takes at most ${BRIGHTNESS_MAX_POINTS} points`;
  }
  for (let index = 0; index < points.length; index += 1) {
    const error = brightnessPointError(points, index);
    if (error) return error;
  }
  return null;
}

/**
 * The command a logical level produces. Zero stays zero, and a level below the
 * first point clamps to its output (the usable floor) rather than fading to
 * nothing.
 */
export function mapBrightnessOutput(
  points: BrightnessPoint[],
  logical: number,
): number {
  if (points.length === 0 || !Number.isFinite(logical) || logical <= 0) {
    return logical;
  }
  const ordered = sortBrightnessPoints(points);
  const first = ordered[0];
  if (logical <= first.logical) return first.output;
  const last = ordered[ordered.length - 1];
  if (logical >= last.logical) return last.output;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const low = ordered[index];
    const high = ordered[index + 1];
    if (logical >= low.logical && logical <= high.logical) {
      const span = high.logical - low.logical;
      if (span <= 0) return low.output;
      return (
        low.output +
        ((high.output - low.output) * (logical - low.logical)) / span
      );
    }
  }
  return last.output;
}

/** The inverse, for reading a report back. A plateau resolves to its floor. */
export function mapBrightnessInput(
  points: BrightnessPoint[],
  physical: number,
): number {
  if (points.length === 0 || !Number.isFinite(physical) || physical <= 0) {
    return physical;
  }
  const ordered = sortBrightnessPoints(points);
  let best: number | null = null;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const low = ordered[index];
    const high = ordered[index + 1];
    const min = Math.min(low.output, high.output);
    const max = Math.max(low.output, high.output);
    if (physical < min || physical > max) continue;
    const span = high.output - low.output;
    const logical =
      span <= 0
        ? low.logical
        : low.logical +
          ((high.logical - low.logical) * (physical - low.output)) / span;
    if (best === null || logical < best) best = logical;
  }
  if (best !== null) return best;
  if (physical < ordered[0].output) return ordered[0].logical;
  return ordered[ordered.length - 1].logical;
}

/**
 * What the curve does at the edges, in the words the review uses. A custom top
 * anchor means 100% no longer sends 100% — that must be visible before saving.
 */
export function brightnessClampSummary(points: BrightnessPoint[]): {
  floor: string;
  ceiling: string;
} {
  if (points.length === 0) {
    return {
      floor: 'Unchanged: every level is sent as asked',
      ceiling: 'Unchanged: 100% stays 100%',
    };
  }
  const ordered = sortBrightnessPoints(points);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    floor: `Below ${formatPercent(first.logical)} the light stays at ${formatPercent(first.output)} — its lowest usable level`,
    ceiling:
      Math.abs(last.output - 1) < 1e-9
        ? '100% still sends 100%'
        : `${formatPercent(last.logical)} and above send ${formatPercent(last.output)} — 100% no longer means full`,
  };
}

/** One review row: “Desired 10% → send 4.2%”. */
export function brightnessReviewRows(points: BrightnessPoint[]): Array<{
  logical: string;
  output: string;
  changes: boolean;
}> {
  return sortBrightnessPoints(points).map((point) => ({
    logical: formatPercent(point.logical),
    output: formatPercent(point.output),
    changes: Math.abs(point.logical - point.output) > 1e-9,
  }));
}

export function isDimmableDevice(device: { data?: unknown }): boolean {
  const data = device.data as
    | { Controllable?: { capabilities?: { brightness?: boolean | null } } }
    | undefined;
  return Boolean(data?.Controllable?.capabilities?.brightness);
}
