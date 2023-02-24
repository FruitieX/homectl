import Link from 'next/link';
import { LayoutDashboard, Lamp, Dice5 } from 'lucide-react';

export const BottomNavigation = () => {
  return (
    <div className="btm-nav relative min-h-0 flex-shrink-0">
      <Link href="/">
        <button>
          <LayoutDashboard />
        </button>
      </Link>
      <Link href="/devices">
        <Dice5 />
      </Link>
      <Link href="/devices">
        <Lamp />
      </Link>
    </div>
  );
};
