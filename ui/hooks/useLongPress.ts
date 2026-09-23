import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  exceedsLongPressTolerance,
  longPressDelayMs,
  longPressMoveTolerancePx,
  type PointerPoint,
} from '@/lib/longPress';

type LongPressOptions = {
  /** Called once the press has been held long enough without moving. */
  onLongPress?: () => void;
  /** Hold duration before the press counts as long. */
  delayMs?: number;
  /** Movement beyond this many pixels turns the press into a scroll/drag. */
  moveTolerancePx?: number;
  /** When false the gesture is ignored and any pending press is cancelled. */
  enabled?: boolean;
};

export type LongPressHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
};

/**
 * Controls nested in a long-press surface keep their own press behaviour, so a
 * hold that starts on one of them must not fire the surface's long press.
 */
const controlSelector = 'a, button, input, select, textarea, label';

function startedInsideControl(event: ReactPointerEvent<HTMLElement>) {
  let element: Element | null =
    event.target instanceof Element ? event.target : null;

  while (element && element !== event.currentTarget) {
    if (element.matches(controlSelector)) {
      return true;
    }
    element = element.parentElement;
  }

  return false;
}

/**
 * Touch-friendly long press built on pointer events.
 *
 * It never calls `preventDefault`, so the surrounding list keeps scrolling
 * normally: a drag past the move tolerance (or a `pointercancel` from the
 * browser's own scroll handling) cancels the pending press. Because the click
 * that follows a press is dispatched after `pointerup`, callers must swallow
 * that click with `consumeLongPress()` to avoid also running the tap action.
 */
export function useLongPress({
  onLongPress,
  delayMs = longPressDelayMs,
  moveTolerancePx = longPressMoveTolerancePx,
  enabled = true,
}: LongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<PointerPoint | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const handlerRef = useRef(onLongPress);

  useEffect(() => {
    handlerRef.current = onLongPress;
  }, [onLongPress]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endGesture = useCallback(() => {
    clearTimer();
    startRef.current = null;
    pointerIdRef.current = null;
  }, [clearTimer]);

  useEffect(() => endGesture, [endGesture]);

  useEffect(() => {
    if (!enabled) {
      endGesture();
    }
  }, [enabled, endGesture]);

  const longPressProps = useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: (event) => {
        // A new press starts a new gesture, so a previous long press can no
        // longer swallow this press' click.
        endGesture();
        firedRef.current = false;
        if (!enabled) {
          return;
        }
        if (startedInsideControl(event)) {
          return;
        }
        if (
          !event.isPrimary ||
          (event.pointerType === 'mouse' && event.button !== 0)
        ) {
          return;
        }
        startRef.current = { x: event.clientX, y: event.clientY };
        pointerIdRef.current = event.pointerId;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          startRef.current = null;
          pointerIdRef.current = null;
          firedRef.current = true;
          handlerRef.current?.();
        }, delayMs);
      },
      onPointerMove: (event) => {
        const start = startRef.current;
        if (start === null || pointerIdRef.current !== event.pointerId) {
          return;
        }
        if (
          exceedsLongPressTolerance(
            start,
            { x: event.clientX, y: event.clientY },
            moveTolerancePx,
          )
        ) {
          // The user is scrolling or dragging, not holding.
          endGesture();
        }
      },
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
      onPointerLeave: endGesture,
      onContextMenu: endGesture,
    }),
    [delayMs, enabled, endGesture, moveTolerancePx],
  );

  /**
   * Returns true exactly once when the last gesture ended in a long press, so
   * the caller can ignore the click the browser dispatches afterwards.
   */
  const consumeLongPress = useCallback(() => {
    const fired = firedRef.current;
    firedRef.current = false;
    return fired;
  }, []);

  return { longPressProps, consumeLongPress };
}

export default useLongPress;
