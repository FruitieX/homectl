import Link from 'next/link';
import { LayoutDashboard, List, Map } from 'lucide-react';

export const BottomNavigation = () => {
  return (
    <div className="btm-nav relative z-10 min-h-0 flex-shrink-0 bg-opacity-75 backdrop-blur">
      <Link href="/">
        <button>
          <LayoutDashboard />
        </button>
      </Link>
      <Link href="/map">
        <Map />
      </Link>
      <Link href="/list">
        <List />
      </Link>
    </div>
  );
};
