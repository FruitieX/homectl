import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/ui/primitives/button';

/** Visible, keyboard-accessible ordering; the caller owns the retained draft. */
export function ReorderButtons({
  label,
  index,
  total,
  onMove,
}: {
  label: string;
  index: number;
  total: number;
  onMove: (offset: number) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center"
      role="group"
      aria-label={`Reorder ${label}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 rounded-md md:size-8"
        aria-label={`Move ${label} up`}
        title="Move up"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 rounded-md md:size-8"
        aria-label={`Move ${label} down`}
        title="Move down"
        disabled={index >= total - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
