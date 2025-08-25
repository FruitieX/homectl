import Link from 'next/link';
import { LayoutDashboard, List, Map } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { BottomNavigation, Button } from 'react-daisyui';

type Route = 'Dashboard' | 'Floorplan' | 'Groups';

const getRoute = (pathname: string | null): Route => {
  if (pathname === '/' || pathname === '/dashboard') {
    return 'Dashboard';
  } else if (pathname === '/map') {
    return 'Floorplan';
  } else if (pathname === '/groups') {
    return 'Groups';
  } else if (pathname?.startsWith('/groups/')) {
    return 'Groups';
  } else {
    return 'Dashboard';
  }
};

export const HomectlBottomNavigation = () => {
  const pathname = usePathname();
  const route = getRoute(pathname);

  const [isFullscreen] = useIsFullscreen();

  if (isFullscreen) {
    return null;
  }

  return (
    <BottomNavigation className="flex justify-around items-center h-12 z-30 min-h-0 shrink-0 bg-opacity-75 backdrop-blur-sm">
      <Link href="/" passHref className="h-full flex-1">
        <Button
          active={route === 'Dashboard'}
          className="flex gap-3 items-center h-full w-full"
          color={route === 'Dashboard' ? 'neutral' : 'ghost'}
        >
          <LayoutDashboard />
          <BottomNavigation.Label>Dashboard</BottomNavigation.Label>
        </Button>
      </Link>
      <Link href="/map" passHref className="h-full flex-1">
        <Button
          active={route === 'Floorplan'}
          className="flex gap-3 items-center h-full w-full"
          color={route === 'Floorplan' ? 'neutral' : 'ghost'}
        >
          <Map />
          <BottomNavigation.Label>Floorplan</BottomNavigation.Label>
        </Button>
      </Link>
      <Link href="/groups" passHref className="h-full flex-1">
        <Button
          active={route === 'Groups'}
          className="flex gap-3 items-center h-full w-full"
          color={route === 'Groups' ? 'neutral' : 'ghost'}
        >
          <List />
          <BottomNavigation.Label>Groups</BottomNavigation.Label>
        </Button>
      </Link>
    </BottomNavigation>
  );
};
