import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { configSections, configSectionAliases } from 'app/config/sections';

export function SettingsBreadcrumbs() {
  const { pathname } = useLocation();
  const resolved = configSectionAliases[pathname] ?? pathname;
  const section =
    configSections.find((entry) => entry.href === resolved) ??
    configSections.find((entry) => resolved.startsWith(`${entry.href}/`));
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
    >
      {pathname === '/config' ? (
        <Link to="/">Home</Link>
      ) : (
        <Link to="/config">Settings</Link>
      )}
      {section && (
        <>
          <ChevronRight aria-hidden className="size-3 shrink-0" />
          {pathname === '/config/floorplan' ? (
            <span className="truncate">Floorplan editor</span>
          ) : (
            <Link className="truncate" to={section.href}>
              {section.label}
            </Link>
          )}
        </>
      )}
    </nav>
  );
}
