import { Link, useLocation } from 'react-router-dom';

import { configSectionTabs } from 'app/config/sections';

import { cn } from '@/lib/cn';

export type ConfigTab = {
  label: string;
  to: string;
  active?: boolean;
};

/**
 * Segmented links for closely related config pages. Each view has its own URL,
 * so browser navigation and deep links continue to work.
 */
export function ConfigTabs({
  tabs,
  className,
}: {
  tabs: ConfigTab[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Related settings"
      className={cn(
        'inline-flex w-full max-w-2xl gap-1 overflow-x-auto rounded-2xl bg-muted p-1 sm:w-fit',
        className,
      )}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'flex-1 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-center text-sm font-medium transition',
            tab.active
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Tabs for a settings section that merges several pages, from the catalog. */
export function ConfigSectionTabs({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const tabs = configSectionTabs(pathname);
  if (!tabs.length) return null;
  return (
    <ConfigTabs
      className={className}
      tabs={tabs.map((tab) => ({
        label: tab.label,
        to: tab.href,
        active: tab.active,
      }))}
    />
  );
}
