import { Link, useLocation } from 'react-router-dom';
import { Cog, House, Layers3, Map } from 'lucide-react';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/lib/cn';

type Route = 'Dashboard' | 'Floorplan' | 'Groups' | 'Config';

const getRoute = (pathname: string | null): Route => {
  if (pathname === '/' || pathname === '/dashboard') {
    return 'Dashboard';
  } else if (pathname === '/map') {
    return 'Floorplan';
  } else if (pathname === '/groups') {
    return 'Groups';
  } else if (pathname?.startsWith('/groups/')) {
    return 'Groups';
  } else if (pathname?.startsWith('/config')) {
    return 'Config';
  } else if (pathname === '/settings') {
    return 'Config';
  } else {
    return 'Dashboard';
  }
};

export const HomectlBottomNavigation = () => {
  const pathname = useLocation().pathname;
  const route = getRoute(pathname);

  const [isFullscreen] = useIsFullscreen();

  if (isFullscreen) {
    return null;
  }

  const items = [
    {
      route: 'Dashboard' as const,
      to: '/',
      label: 'Home',
      icon: House,
    },
    { route: 'Floorplan' as const, to: '/map', label: 'Floorplan', icon: Map },
    { route: 'Groups' as const, to: '/groups', label: 'Rooms', icon: Layers3 },
    { route: 'Config' as const, to: '/config', label: 'Studio', icon: Cog },
  ];

  return (
    <div className="z-30 shrink-0 border-t border-border/50 bg-background/78 px-2 pb-[calc(env(safe-area-inset-bottom)+0.45rem)] pt-1.5 shadow-[0_-18px_45px_rgba(12,18,18,0.08)] backdrop-blur-2xl supports-backdrop-filter:bg-background/70 lg:hidden">
      <nav aria-label="Primary navigation" className="grid grid-cols-4 gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;

          return (
            <Button
              key={item.route}
              asChild
              variant={active ? 'secondary' : 'ghost'}
              className={cn(
                'relative h-14 min-w-0 flex-col gap-1.5 rounded-2xl px-1 py-1.5 text-[0.68rem] font-semibold leading-tight',
                active && 'bg-primary/10 text-primary shadow-none',
              )}
            >
              <Link to={item.to} aria-current={active ? 'page' : undefined}>
                <Icon className="size-4" />
                <span className="max-w-full truncate leading-tight">
                  {item.label}
                </span>
              </Link>
            </Button>
          );
        })}
      </nav>
    </div>
  );
};

export const HomectlNavigationRail = () => {
  const pathname = useLocation().pathname;
  const route = getRoute(pathname);
  const [isFullscreen] = useIsFullscreen();

  if (isFullscreen) return null;

  const items = [
    { route: 'Dashboard' as const, to: '/', label: 'Home', icon: House },
    { route: 'Floorplan' as const, to: '/map', label: 'Floorplan', icon: Map },
    { route: 'Groups' as const, to: '/groups', label: 'Rooms', icon: Layers3 },
    { route: 'Config' as const, to: '/config', label: 'Studio', icon: Cog },
  ];

  return (
    <aside className="relative z-30 hidden w-24 shrink-0 flex-col items-center border-r border-border/45 bg-background/72 px-3 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-2xl lg:flex">
      <Link
        to="/"
        aria-label="homectl home"
        className="mb-10 grid size-12 place-items-center rounded-[1.15rem] bg-primary text-lg font-black tracking-[-0.08em] text-primary-foreground shadow-[0_12px_35px_hsl(var(--primary)/0.24)]"
      >
        hc
      </Link>
      <nav
        aria-label="Primary navigation"
        className="flex w-full flex-1 flex-col gap-2"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;
          return (
            <Button
              key={item.route}
              asChild
              variant="ghost"
              className={cn(
                'relative h-[4.6rem] w-full flex-col gap-2 rounded-[1.35rem] px-1 text-[0.68rem] font-semibold text-muted-foreground',
                active && 'bg-primary/10 text-primary hover:bg-primary/12',
              )}
            >
              <Link to={item.to} aria-current={active ? 'page' : undefined}>
                {active ? (
                  <span className="absolute -left-3 h-7 w-1 rounded-r-full bg-primary" />
                ) : null}
                <Icon className="!size-5" strokeWidth={active ? 2.4 : 1.8} />
                <span>{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </nav>
      <div className="mt-4 size-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]" />
    </aside>
  );
};
