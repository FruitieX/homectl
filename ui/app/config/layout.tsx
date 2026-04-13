'use client';

import { useRuntimeStatus } from '@/hooks/useConfig';
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
  const { data: runtimeStatus } = useRuntimeStatus(5000);

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

      {runtimeStatus?.memory_only_mode && (
        <div className="mx-4 mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                Memory-only runtime
              </p>
              <p className="mt-1 text-sm leading-6">
                Config changes are live, but a restart will drop them unless you export a JSON backup.
              </p>
            </div>
            <Link className="btn btn-sm border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200" href="/config/import-export">
              Export backup
            </Link>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
