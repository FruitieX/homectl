import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const target = document.getElementById('floorplan-inspector');
  if (!target) return null;
  return createPortal(
    <section
      aria-label="Floorplan inspector"
      className="flex min-h-0 flex-col border-t border-border bg-background md:h-full md:border-l md:border-t-0"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={expanded ? 'Collapse controls' : 'Expand controls'}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown /> : <ChevronUp />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close controls"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div
        className={`${expanded ? 'h-[52dvh]' : 'h-40'} min-h-0 overflow-y-auto overscroll-contain md:h-auto md:flex-1 md:px-4 md:pb-4`}
      >
        {children}
      </div>
    </section>,
    target,
  );
}
