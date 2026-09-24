import { ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Collapsible disclosure for secondary controls. The essentials remain in view
 * and every advanced control remains reachable without a global mode switch.
 */
export function Advanced({
  label = 'Advanced',
  description,
  /** Replaces the “Optional” tag, e.g. “Customized” or “Needs attention”. */
  summary,
  defaultOpen,
  openWhen,
  className,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  openWhen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-muted/20',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-muted/50"
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform', open && 'rotate-90')}
        />
        {label}
        <span
          className={cn(
            'ml-auto text-xs font-normal',
            summary ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {summary ?? 'Optional'}
        </span>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-border/70 p-4">
          {description ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
