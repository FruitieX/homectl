/**
 * Quick-control popovers dismiss on a tap outside them, and that tap must do
 * nothing else: the pointer gesture that dismissed the popover is consumed so
 * a tap-driven surface underneath (the floorplan) does not also open the
 * light, sensor or room the tap landed on.
 *
 * Popovers record the dismissing pointer here; the surface that acts on taps
 * asks whether a press belongs to that gesture. A record lives only for the
 * dismissing gesture: it is dropped when the surface consumes it or when the
 * pointer ends, so a later press with a reused pointer id is never swallowed.
 */

type DismissTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

export type QuickControlDismissGuard = {
  /** Record that this pointer gesture dismissed a quick-control popover. */
  dismiss: (pointerId: number) => void;
  /**
   * True when this pointer's press was the gesture that dismissed a popover,
   * in which case the caller must ignore that press. Clears the record.
   */
  consume: (pointerId: number) => boolean;
};

export function createQuickControlDismissGuard(
  target: DismissTarget | null = typeof window === 'undefined' ? null : window,
): QuickControlDismissGuard {
  let dismissedPointerId: number | null = null;
  let release: ((event: Event) => void) | null = null;
  const releaseNow = () => {
    dismissedPointerId = null;
    if (!release) return;
    target?.removeEventListener('pointerup', release);
    target?.removeEventListener('pointercancel', release);
    release = null;
  };
  const onPointerEnd = (event: Event) => {
    if ((event as PointerEvent).pointerId !== dismissedPointerId) return;
    releaseNow();
  };
  return {
    dismiss(pointerId) {
      releaseNow();
      dismissedPointerId = pointerId;
      if (!target) return;
      release = onPointerEnd;
      target.addEventListener('pointerup', release);
      target.addEventListener('pointercancel', release);
    },
    consume(pointerId) {
      if (dismissedPointerId !== pointerId) return false;
      releaseNow();
      return true;
    },
  };
}

/** Shared instance: quick popovers record, the floorplan renderer consumes. */
export const quickControlDismissGuard = createQuickControlDismissGuard();
