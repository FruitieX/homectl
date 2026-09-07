import type { ComponentProps, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Card } from '@/ui/primitives/card';

export function WidgetCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <Card
      className={cn(
        'relative overflow-hidden rounded-[1.5rem] border-border/55 bg-gradient-to-br from-card via-card to-muted/30 shadow-[0_1px_0_hsl(var(--foreground)/0.03),0_12px_32px_-24px_hsl(var(--foreground)/0.35)]',
        className,
      )}
      {...props}
    />
  );
}

export function WidgetHeading({
  icon,
  label,
  detail = false,
  className,
}: {
  icon: ReactNode;
  label: ReactNode;
  detail?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-primary [&>svg]:size-3.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail ? (
        <ArrowUpRight className="size-4 opacity-45 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-80" />
      ) : null}
    </div>
  );
}

export function DetailPanel({
  className,
  ...props
}: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border/50 bg-muted/25 p-4 sm:p-5',
        className,
      )}
      {...props}
    />
  );
}

export function Metric({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
