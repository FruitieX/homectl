import { Link, useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { RefreshCw, Search } from 'lucide-react';
import {
  primaryNavigationItems,
  primaryNavigationActive,
} from '@/ui/AppNavigation';
import { useDeveloperMode } from '@/hooks/developerMode';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { commandPaletteOpenAtom } from '@/ui/CommandPalette';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/lib/cn';

export const HomectlBottomNavigation = () => {
  const pathname = useLocation().pathname;

  const [isFullscreen] = useIsFullscreen();
  const [developerMode] = useDeveloperMode();
  const openPalette = useSetAtom(commandPaletteOpenAtom);

  if (isFullscreen) {
    return null;
  }

  const items = primaryNavigationItems;

  return (
    <div className="z-30 shrink-0 border-t border-border/50 bg-background px-2 pb-[calc(env(safe-area-inset-bottom)+0.45rem)] pt-1.5    lg:hidden">
      <nav
        aria-label="Primary navigation"
        className={cn(
          'grid gap-1.5',
          developerMode ? 'grid-cols-6' : 'grid-cols-5',
        )}
      >
        {items.slice(0, 1).map((item) => (
          <BottomNavLink
            key={item.to}
            item={item}
            active={primaryNavigationActive(item.to, pathname)}
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          aria-label="Search"
          className="relative h-14 min-w-0 flex-col gap-1.5 rounded-2xl px-1 py-1.5 text-[0.68rem] font-semibold leading-tight"
          onClick={() => openPalette(true)}
        >
          <Search className="size-4" />
          <span className="max-w-full truncate leading-tight">Search</span>
        </Button>
        {items.slice(1).map((item) => (
          <BottomNavLink
            key={item.to}
            item={item}
            active={primaryNavigationActive(item.to, pathname)}
          />
        ))}
        {developerMode ? (
          <Button
            type="button"
            variant="ghost"
            className="relative h-14 min-w-0 flex-col gap-1.5 rounded-2xl px-1 py-1.5 text-[0.68rem] font-semibold leading-tight"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="size-4" />
            <span className="max-w-full truncate leading-tight">Refresh</span>
          </Button>
        ) : null}
      </nav>
    </div>
  );
};

const BottomNavLink = ({
  item,
  active,
}: {
  item: {
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  active: boolean;
}) => {
  const Icon = item.icon;
  return (
    <Button
      asChild
      variant={active ? 'secondary' : 'ghost'}
      className={cn(
        'relative h-14 min-w-0 flex-col gap-1.5 rounded-2xl px-1 py-1.5 text-[0.68rem] font-semibold leading-tight',
        active && 'bg-primary/10 text-primary shadow-none',
      )}
    >
      <Link to={item.to} aria-current={active ? 'page' : undefined}>
        <Icon className="size-4" />
        <span className="max-w-full truncate leading-tight">{item.label}</span>
      </Link>
    </Button>
  );
};
