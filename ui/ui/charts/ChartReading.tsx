import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Compact reading outside the plot when possible, offset from touch input. */
export function ChartReading({
  anchor,
  point,
  children,
}: {
  anchor: Element | null;
  point: { clientX: number; clientY: number; touch: boolean } | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!bubble || !anchor) return;
    const chart = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const edge = 10;
    const leftBound = (viewport?.offsetLeft ?? 0) + edge;
    const topBound = (viewport?.offsetTop ?? 0) + edge;
    const rightBound = leftBound + (viewport?.width ?? innerWidth) - 2 * edge;
    const bottomBound = topBound + (viewport?.height ?? innerHeight) - 2 * edge;
    bubble.style.maxWidth = `${Math.min(280, rightBound - leftBound)}px`;
    bubble.style.maxHeight = `${bottomBound - topBound}px`;
    const size = bubble.getBoundingClientRect();
    const x = point?.clientX ?? chart.left + chart.width / 2;
    const fingerGap = point?.touch ? 64 : 18;
    const above = Math.min(
      chart.top - size.height - 10,
      (point?.clientY ?? chart.top) - size.height - fingerGap,
    );
    const below = Math.max(
      chart.bottom + 10,
      (point?.clientY ?? chart.bottom) + fingerGap,
    );
    // Use the space outside the chart first. If neither side fits, float on
    // the opposite side of the pointer with extra clearance for a fingertip.
    let top =
      above >= topBound
        ? above
        : below + size.height <= bottomBound
          ? below
          : (point?.clientY ?? chart.top) - size.height - fingerGap;
    if (top < topBound && point) top = point.clientY + fingerGap;
    bubble.style.left = `${Math.max(leftBound, Math.min(x - size.width / 2, rightBound - size.width))}px`;
    bubble.style.top = `${Math.max(topBound, Math.min(top, bottomBound - size.height))}px`;
  }, [anchor, point, children]);

  return createPortal(
    <div
      ref={ref}
      data-chart-reading
      role="tooltip"
      className="pointer-events-none fixed z-[10000] w-max max-w-[280px] overflow-hidden rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left: -10000, top: -10000 }}
    >
      {children}
    </div>,
    document.body,
  );
}
