import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/ui/primitives/button';
import { cn } from '@/lib/cn';
import { configSectionAliases, configSections } from './sections';
import { Breadcrumbs } from '@/ui/config/Breadcrumbs';

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
  const { pathname } = useLocation();
  const resolvedPath = configSectionAliases[pathname] ?? pathname;
  const section = configSections.find((entry) => entry.href === resolvedPath);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {backTo && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0 rounded-full sm:hidden"
          >
            <Link to={backTo} aria-label="Back to settings">
              <ChevronLeft />
            </Link>
          </Button>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          {section ? <Breadcrumbs items={[{ label: section.label }]} /> : null}
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
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
