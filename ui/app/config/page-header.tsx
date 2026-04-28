import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/ui/primitives/button';
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
  backTo = '/config',
  className,
  description,
  title,
}: ConfigPageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {backTo && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0 rounded-full"
          >
            <Link to={backTo} aria-label="Back to config hub">
              <ChevronLeft />
            </Link>
          </Button>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
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
