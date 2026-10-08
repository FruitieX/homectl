import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/ui/primitives/button';

/**
 * Hides settings most people never change. It starts open when something
 * inside is customized, and is held open while it contains an error so
 * validation can focus the field.
 */
export function Disclosure({
  label,
  hint,
  defaultOpen = false,
  forceOpen = false,
  children,
}: {
  label: string;
  hint?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = open || forceOpen;
  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-fit flex-wrap justify-start gap-x-2 gap-y-0 px-2 py-2 text-left"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        <ChevronRight
          aria-hidden
          className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        {label}
        {hint && (
          <span className="text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </Button>
      {expanded && children}
    </div>
  );
}
