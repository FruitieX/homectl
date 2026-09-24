import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { configSections } from '../../app/config/sections';
import { cn } from '@/lib/cn';

export type Crumb = { label: ReactNode; to?: string };

/** The list page a config sub-route belongs to, if any. */
export function configParentCrumb(pathname: string): Crumb | null {
  const section =
    configSections.find((entry) => entry.href === pathname) ??
    configSections.find((entry) => pathname.startsWith(`${entry.href}/`));
  if (!section) return null;
  return { label: section.label, to: section.href };
}

type BreadcrumbsProps = {
  /**
   * The trail after “Settings”, outermost first; the last entry is the current
   * page and the only one that is not a link. Section groups (“Your home”,
   * “Automations”) are never shown — they are not pages you can open, so a
   * crumb for them would only be a dead end.
   */
  items?: Crumb[];
  className?: string;
};

/**
 * The one breadcrumb for the whole app: `Settings / <list> / <item>`. Every
 * crumb except the current page navigates somewhere; a crumb without a target
 * renders as plain text rather than as a link that does nothing.
 */
export function Breadcrumbs({ items = [], className }: BreadcrumbsProps) {
  const trail: Crumb[] =
    items[0]?.label === 'Settings'
      ? items
      : [{ label: 'Settings', to: '/config' }, ...items];

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('hidden text-xs text-muted-foreground sm:block', className)}
    >
      <ol className="flex flex-wrap items-center gap-1">
        {trail.map((crumb, index) => {
          const isCurrent = index === trail.length - 1;
          return (
            <li key={index} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight aria-hidden className="size-3 opacity-60" />
              ) : null}
              {isCurrent || !crumb.to ? (
                <span
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(
                    'transition',
                    isCurrent && 'font-medium text-foreground',
                  )}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.to}
                  className="transition hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
