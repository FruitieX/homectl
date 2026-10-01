import { useEffect, useRef, type PointerEvent, type MouseEvent } from 'react';

/** A tap may open details; a drag/hold only inspects. Every release clears it. */
export function useChartInteraction<T extends Element>({
  inspect,
  clear,
  onTap,
}: {
  inspect: (event: PointerEvent<T>) => void;
  clear: () => void;
  onTap?: () => void;
}) {
  const callbacks = useRef({ inspect, clear, onTap });
  callbacks.current = { inspect, clear, onTap };
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    started: number;
    dragged: boolean;
  } | null>(null);
  const suppressTap = useRef(false);

  useEffect(() => {
    const cancel = () => {
      if (gesture.current) suppressTap.current = true;
      gesture.current = null;
      callbacks.current.clear();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('resize', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('resize', cancel);
    };
  }, []);

  return {
    onPointerDown(event: PointerEvent<T>) {
      if (event.button !== 0) return;
      if (gesture.current) {
        suppressTap.current = true;
        gesture.current = null;
        callbacks.current.clear();
        return;
      }
      suppressTap.current = false;
      gesture.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        started: performance.now(),
        dragged: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      callbacks.current.inspect(event);
    },
    onPointerMove(event: PointerEvent<T>) {
      const current = gesture.current;
      if (current?.id === event.pointerId) {
        if (
          Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8
        )
          current.dragged = true;
        callbacks.current.inspect(event);
      } else if (
        !current &&
        event.pointerType === 'mouse' &&
        event.buttons === 0
      ) {
        callbacks.current.inspect(event);
      }
    },
    onPointerUp(event: PointerEvent<T>) {
      const current = gesture.current;
      if (current?.id !== event.pointerId) return;
      suppressTap.current =
        current.dragged || performance.now() - current.started >= 450;
      gesture.current = null;
      callbacks.current.clear();
    },
    onPointerCancel() {
      suppressTap.current = true;
      gesture.current = null;
      callbacks.current.clear();
    },
    onLostPointerCapture() {
      if (gesture.current) suppressTap.current = true;
      gesture.current = null;
      callbacks.current.clear();
    },
    onPointerLeave() {
      if (!gesture.current) callbacks.current.clear();
    },
    onClick(event: MouseEvent<T>) {
      if (suppressTap.current) {
        event.preventDefault();
        event.stopPropagation();
      } else if (callbacks.current.onTap) {
        event.stopPropagation();
        callbacks.current.onTap();
      }
    },
  };
}
