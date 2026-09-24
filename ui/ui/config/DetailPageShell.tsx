import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/cn';
import { SectionEditProvider } from '@/ui/config/sectionEditCoordinator';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';

export type Crumb = { label: ReactNode; to?: string };

export type DetailMenuItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

export type DetailPageShellProps = {
  /** Breadcrumb trail, outermost first; the current item is last without `to`. */
  crumbs: Crumb[];
  /** Visible Back control; must work after a direct load or refresh. */
  backTo: string;
  backLabel?: string;
  title: ReactNode;
  /** One sentence: what is happening, with a timestamp when it is known. */
  status?: ReactNode;
  /** At most one primary action. */
  primaryAction?: ReactNode;
  menu?: DetailMenuItem[];
  loading?: boolean;
  error?: string | null;
  notFound?: boolean;
  notFoundMessage?: ReactNode;
  onRetry?: () => void;
  loadingSkeleton?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * The compact detail-page shell shared by every config item: breadcrumb and
 * Back, the item name, one status sentence, one primary action, and a labeled
 * overflow menu for the rest. Loading, load-error (with retry) and
 * “no longer exists” states render here so every page behaves the same.
 */
export function DetailPageShell({
  crumbs,
  backTo,
  backLabel = 'Back to list',
  title,
  status,
  primaryAction,
  menu,
  loading = false,
  error = null,
  notFound = false,
  notFoundMessage,
  onRetry,
  loadingSkeleton,
  children,
  className,
}: DetailPageShellProps) {
  return (
    <div
      className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4', className)}
    >
      <div className="flex flex-col gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
        >
          <Link to={backTo}>
            <ChevronLeft aria-hidden />
            {backLabel}
          </Link>
        </Button>

        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((crumb, index) => {
              // Every crumb except the current one is navigable: a crumb
              // without an explicit target falls back to the parent route.
              const to =
                crumb.to ?? (index < crumbs.length - 1 ? backTo : undefined);
              return (
                <li key={index} className="flex items-center gap-1">
                  {index > 0 ? <span aria-hidden>/</span> : null}
                  {to ? (
                    <Link to={to} className="transition hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground">
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-lg font-semibold text-foreground">
              {title}
            </h1>
            {status ? (
              <p className="text-sm leading-5 text-muted-foreground">
                {status}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {primaryAction}
            {menu && menu.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More actions for this item"
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menu.map((item) => (
                    <DropdownMenuItem
                      key={item.label}
                      disabled={item.disabled}
                      onSelect={item.onSelect}
                      className={cn(
                        item.destructive &&
                          'text-destructive focus:text-destructive',
                      )}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>

      {loading ? (
        (loadingSkeleton ?? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ))
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load this item</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : notFound ? (
        <EmptyState
          title="This item no longer exists"
          description={
            notFoundMessage ??
            'It may have been deleted or renamed. Open the list to pick another item.'
          }
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={backTo}>{backLabel}</Link>
            </Button>
          }
        />
      ) : (
        <SectionEditProvider>{children}</SectionEditProvider>
      )}
    </div>
  );
}
