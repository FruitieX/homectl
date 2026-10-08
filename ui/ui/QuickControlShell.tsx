import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type HTMLMotionProps,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import { cn } from '@/lib/cn';
import { quickControlDismissGuard } from '@/lib/quickControlDismiss';

const EDGE = 12;
// Every quick control grows from and shrinks back to its center point.
const HIDDEN_SCALE = 0.72;

type Point = { x: number; y: number };

/**
 * Floating quick-control surface centered on the tapped point and clamped to
 * the viewport. A tap outside or Escape closes it; the dismissing tap is
 * consumed so the floorplan does not also act on it.
 *
 * By default the shell measures itself and centers its whole box. Surfaces
 * whose visual center differs from their box (the radial light control) pass
 * `origin`, the center within the box, and `reach`, how far content extends
 * from that center, including room to the viewport edge.
 *
 * Render it inside `AnimatePresence` so closing fades out; while exiting it
 * ignores input and no longer dismisses on outside taps.
 */
export function QuickControlShell({
  anchor,
  origin,
  reach,
  autoFocus = true,
  onClose,
  className,
  style,
  children,
  ...props
}: Omit<
  HTMLMotionProps<'div'>,
  'ref' | 'initial' | 'animate' | 'exit' | 'transition'
> & {
  anchor: Point;
  origin?: Point;
  reach?: { x: number; top: number; bottom: number };
  /** Focus the `[data-autofocus]` element on open and restore focus after. */
  autoFocus?: boolean;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  const latest = useRef({ onClose });
  latest.current = { onClose };
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const measured = !origin || !reach;
  useLayoutEffect(() => {
    const node = root.current;
    if (!measured || !node) return;
    const measure = () =>
      setSize({ w: node.offsetWidth, h: node.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measured]);
  useEffect(() => {
    if (!present) return;
    const previousFocus = document.activeElement;
    const outside = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      quickControlDismissGuard.dismiss(e.pointerId);
      latest.current.onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onClose();
      }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    if (autoFocus)
      root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
      if (autoFocus && previousFocus instanceof HTMLElement)
        previousFocus.focus();
    };
  }, [autoFocus, present]);
  const center = origin ?? { x: (size?.w ?? 0) / 2, y: (size?.h ?? 0) / 2 };
  const extent = reach ?? {
    x: center.x + EDGE,
    top: center.y + EDGE,
    bottom: (size?.h ?? 0) - center.y + EDGE,
  };
  const x = Math.max(extent.x, Math.min(innerWidth - extent.x, anchor.x));
  const y = Math.max(
    extent.top,
    Math.min(innerHeight - extent.bottom, anchor.y),
  );
  const position: CSSProperties = {
    left: x - center.x,
    top: y - center.y,
    visibility: measured && !size ? 'hidden' : undefined,
    transformOrigin: `${center.x}px ${center.y}px`,
    pointerEvents: present ? undefined : 'none',
  };
  const hidden = { opacity: 0, scale: reduceMotion ? 1 : HIDDEN_SCALE };
  return createPortal(
    <motion.div
      ref={root}
      role="dialog"
      className={cn('fixed z-[60]', className)}
      style={{ ...style, ...position }}
      initial={hidden}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
      }}
      exit={{ ...hidden, transition: { duration: 0.12, ease: 'easeIn' } }}
      {...props}
    >
      {children}
    </motion.div>,
    document.body,
  );
}
