import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, List, Map, Settings, Cog } from 'lucide-react';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/lib/cn';

type Route = 'Dashboard' | 'Floorplan' | 'Groups' | 'Config' | 'Settings';

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
    return 'Settings';
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
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    { route: 'Floorplan' as const, to: '/map', label: 'Floorplan', icon: Map },
    { route: 'Groups' as const, to: '/groups', label: 'Groups', icon: List },
    { route: 'Config' as const, to: '/config', label: 'Config', icon: Cog },
    {
      route: 'Settings' as const,
      to: '/settings',
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <div className="z-30 shrink-0 border-t border-border/60 bg-background/85 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 shadow-[0_-12px_35px_rgba(15,23,42,0.08)] backdrop-blur-xl supports-backdrop-filter:bg-background/75">
      <nav aria-label="Primary navigation" className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;

          return (
            <Button
              key={item.route}
              asChild
              variant={active ? 'secondary' : 'ghost'}
              className={cn(
                'h-12 flex-col gap-1 rounded-2xl px-1 text-[0.68rem] font-medium',
                active && 'text-foreground shadow-sm',
              )}
            >
              <Link to={item.to} aria-current={active ? 'page' : undefined}>
                <Icon className="size-4" />
                <span className="truncate">{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </nav>
    </div>
  );
};
