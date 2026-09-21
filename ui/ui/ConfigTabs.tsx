import { Link } from 'react-router-dom';

import { cn } from '@/lib/cn';

export type ConfigTab = {
  label: string;
  to: string;
  active?: boolean;
};

/**
 * Segmented link tabs for closely related config pages (Routines/History,
 * Backups/Migration). Uses links so each tab keeps its own URL and deep links
 * continue to work.
 */
export function ConfigTabs({
  tabs,
  className,
}: {
  tabs: ConfigTab[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex w-full max-w-md gap-1 rounded-2xl bg-muted p-1',
        className,
      )}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          role="tab"
          aria-selected={tab.active ?? false}
          className={cn(
            'flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition',
            tab.active
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
