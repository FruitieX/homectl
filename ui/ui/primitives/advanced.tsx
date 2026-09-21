import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { advancedDefaultOpen, isFieldVisible } from '@/lib/preferences';
import { useExperience } from '@/hooks/preferences';

/**
 * Collapsible disclosure for secondary/expert fields. In Simple and Standard
 * levels it starts collapsed so the common path stays uncluttered; Expert
 * users see it open. Opening it never changes the experience level.
 */
export function Advanced({
  label = 'Advanced',
  description,
  defaultOpen,
  className,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { level, isExpert } = useExperience();
  const [open, setOpen] = useState(() =>
    advancedDefaultOpen(level, defaultOpen),
  );

  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-border/70 bg-muted/20',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform', open && 'rotate-90')}
        />
        {label}
        {!isExpert ? (
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[0.65rem] font-medium normal-case tracking-normal text-muted-foreground">
            optional
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-4 border-t border-dashed border-border/70 p-3">
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

/**
 * Renders children only when the current experience level meets the minimum.
 * Use for expert-only surfaces (raw JSON, internals) that should disappear
 * entirely rather than collapse.
 */
export function ExperienceOnly({
  minimum,
  children,
}: {
  minimum: 'standard' | 'expert';
  children: ReactNode;
}) {
  const { level } = useExperience();
  if (!isFieldVisible(level, minimum)) return null;
  return <>{children}</>;
}
