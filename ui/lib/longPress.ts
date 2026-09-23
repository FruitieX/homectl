/**
 * Shared long-press gesture tuning.
 *
 * A press that travels further than the tolerance is a scroll (or a drag), not
 * a selection gesture, so callers cancel the pending press as soon as the
 * pointer moves that far. Keeping the values here lets touch surfaces agree on
 * the same feel.
 */
export const longPressDelayMs = 500;
export const longPressMoveTolerancePx = 10;

export type PointerPoint = {
  x: number;
  y: number;
};

/**
 * True when the pointer travelled far enough from the press origin that the
 * gesture must be treated as a scroll/drag instead of a hold.
 */
export function exceedsLongPressTolerance(
  start: PointerPoint,
  current: PointerPoint,
  tolerancePx: number = longPressMoveTolerancePx,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > tolerancePx;
}
