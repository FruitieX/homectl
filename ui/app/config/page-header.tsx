import { type ReactNode } from 'react';

import { cn } from '@/lib/cn';

type ConfigPageHeaderProps = {
  actions?: ReactNode;
  backTo?: string | null;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function ConfigPageHeader({
  actions,
  className,
  description,
  title,
}: ConfigPageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
