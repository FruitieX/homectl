import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';

// The map reserves this space so controls never cover the canvas.
export function FloorplanInspector({
  title,
  children,
  onClose,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const [viewportHeight, setViewportHeight] = useState(
    () => window.visualViewport?.height ?? window.innerHeight,
  );
  const [height, setHeight] = useState(() =>
    Math.min(window.innerHeight * 0.44 + 48, 384),
  );
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const maxHeight = Math.round(viewportHeight * 0.8);
  const minHeight = Math.min(200, maxHeight);
  const clamp = (value: number) =>
    Math.max(minHeight, Math.min(maxHeight, value));
  const currentHeight = clamp(height);
  useEffect(() => {
    const resize = () =>
      setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  const target = document.getElementById('floorplan-inspector');
  if (!target) return null;
  return createPortal(
    <section
      aria-label="Floorplan inspector"
      className="flex h-[var(--inspector-height)] min-h-0 flex-col border-t border-border bg-background md:h-full md:border-l md:border-t-0"
      style={{ '--inspector-height': `${currentHeight}px` } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        role="separator"
        aria-label="Resize device controls"
        aria-orientation="horizontal"
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        aria-valuenow={Math.round(currentHeight)}
        aria-valuetext={`${Math.round(currentHeight)} pixels high`}
        tabIndex={0}
        className="flex h-7 shrink-0 touch-none cursor-ns-resize select-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:hidden"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            y: event.clientY,
            height: currentHeight,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.id === event.pointerId)
            setHeight(clamp(start.height + start.y - event.clientY));
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowUp'
              ? currentHeight + 24
              : event.key === 'ArrowDown'
                ? currentHeight - 24
                : event.key === 'Home'
                  ? minHeight
                  : event.key === 'End'
                    ? maxHeight
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          setHeight(clamp(next));
        }}
      >
        <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
      </div>
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close controls"
          className="size-8"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] md:px-4 md:pb-4">
        {children}
      </div>
    </section>,
    target,
  );
}
