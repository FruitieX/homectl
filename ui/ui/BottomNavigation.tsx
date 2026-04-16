import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, List, Map, Settings, Cog } from 'lucide-react';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { Button } from 'react-daisyui';

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

  return (
    <div className="z-30 shrink-0 overflow-x-auto overflow-y-hidden bg-base-100/75 backdrop-blur-sm">
      <nav
        aria-label="Primary navigation"
        className="flex min-h-0 h-12 min-w-full w-max items-stretch"
      >
        <Link to="/" className="h-full min-w-36 shrink-0 flex-1">
          <Button
            active={route === 'Dashboard'}
            className="flex h-full w-full items-center gap-3 whitespace-nowrap"
            color={route === 'Dashboard' ? 'neutral' : 'ghost'}
          >
            <LayoutDashboard />
            <span className="text-xs">Dashboard</span>
          </Button>
        </Link>
        <Link to="/map" className="h-full min-w-36 shrink-0 flex-1">
          <Button
            active={route === 'Floorplan'}
            className="flex h-full w-full items-center gap-3 whitespace-nowrap"
            color={route === 'Floorplan' ? 'neutral' : 'ghost'}
          >
            <Map />
            <span className="text-xs">Floorplan</span>
          </Button>
        </Link>
        <Link to="/groups" className="h-full min-w-36 shrink-0 flex-1">
          <Button
            active={route === 'Groups'}
            className="flex h-full w-full items-center gap-3 whitespace-nowrap"
            color={route === 'Groups' ? 'neutral' : 'ghost'}
          >
            <List />
            <span className="text-xs">Groups</span>
          </Button>
        </Link>
        <Link to="/config" className="h-full min-w-36 shrink-0 flex-1">
          <Button
            active={route === 'Config'}
            className="flex h-full w-full items-center gap-3 whitespace-nowrap"
            color={route === 'Config' ? 'neutral' : 'ghost'}
          >
            <Cog />
            <span className="text-xs">Config</span>
          </Button>
        </Link>
        <Link to="/settings" className="h-full min-w-36 shrink-0 flex-1">
          <Button
            active={route === 'Settings'}
            className="flex h-full w-full items-center gap-3 whitespace-nowrap"
            color={route === 'Settings' ? 'neutral' : 'ghost'}
          >
            <Settings />
            <span className="text-xs">Settings</span>
          </Button>
        </Link>
      </nav>
    </div>
  );
};

