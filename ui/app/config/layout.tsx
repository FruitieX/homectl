'use client';

import { Navbar } from '@/ui/Navbar';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const configTabs = [
  { href: '/config/integrations', label: 'Integrations' },
  { href: '/config/groups', label: 'Groups' },
  { href: '/config/scenes', label: 'Scenes' },
  { href: '/config/routines', label: 'Routines' },
  { href: '/config/dashboard', label: 'Dashboard' },
  { href: '/config/floorplan', label: 'Floorplan' },
  { href: '/config/devices', label: 'Devices' },
  { href: '/config/logs', label: 'Logs' },
  { href: '/config/settings', label: 'Settings' },
  { href: '/config/import-export', label: 'Import/Export' },
  { href: '/config/migration', label: 'TOML Migration' },
];

export default function ConfigLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      <Navbar />

      {/* Tab navigation */}
      <div className="tabs tabs-boxed bg-base-200 p-2 gap-1">
        {configTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab ${pathname?.startsWith(tab.href) ? 'tab-active' : ''}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
