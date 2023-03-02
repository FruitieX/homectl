import Link from 'next/link';
import { LayoutDashboard, List, Map } from 'lucide-react';
import { usePathname } from 'next/navigation';

type Route = 'Dashboard' | 'Map' | 'Groups';

const getRoute = (pathname: string | null): Route => {
  if (pathname === '/') {
    return 'Dashboard';
  } else if (pathname === '/map') {
    return 'Map';
  } else if (pathname === '/groups') {
    return 'Groups';
  } else if (pathname?.startsWith('/groups/')) {
    return 'Groups';
  } else {
    return 'Dashboard';
  }
};

export const BottomNavigation = () => {
  const pathname = usePathname();
  const route = getRoute(pathname);

  return (
    <div className="btm-nav relative z-10 min-h-0 flex-shrink-0 bg-opacity-75 backdrop-blur">
      <Link className={route === 'Dashboard' ? 'active' : ''} href="/">
        <LayoutDashboard />
        <span className="btm-nav-label">Dashboard</span>
      </Link>
      <Link className={route === 'Map' ? 'active' : ''} href="/map">
        <Map />
        <span className="btm-nav-label">Map</span>
      </Link>
      <Link className={route === 'Groups' ? 'active' : ''} href="/groups">
        <List />
        <span className="btm-nav-label">Groups</span>
      </Link>
    </div>
  );
};
