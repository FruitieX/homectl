import { Link } from 'react-router-dom';

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
        'inline-flex w-full max-w-md gap-1 rounded-2xl bg-muted p-1',
        className,
      )}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab.active ? 'page' : undefined}
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
    </nav>
  );
}
