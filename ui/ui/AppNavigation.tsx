import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Cog,
  House,
  Layers3,
  LayoutGrid,
  Map,
  Menu,
  RefreshCw,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { configSections, configSectionAliases } from 'app/config/sections';
import { useDeveloperMode } from '@/hooks/developerMode';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { useConnectionStatus } from '@/hooks/websocket';
import { commandPaletteOpenAtom } from '@/ui/CommandPalette';
import { HomectlLogo } from '@/ui/HomectlLogo';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/ui/primitives/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/primitives/tooltip';
import { cn } from '@/lib/cn';
import './app-navigation.css';

export const primaryNavigationItems = [
  { to: '/', label: 'Home', icon: House },
  { to: '/map', label: 'Floorplan', icon: Map },
  { to: '/groups', label: 'Rooms', icon: Layers3 },
  { to: '/config', label: 'Settings', icon: Cog },
] as const;

export function primaryNavigationActive(to: string, pathname: string) {
  if (to === '/') return pathname === '/' || pathname === '/dashboard';
  if (to === '/config' && pathname === '/settings') return true;
  return pathname === to || pathname.startsWith(to + '/');
}

const settingsPanelOpenAtom = atom(true);
const navigationGroups = [
  'Your home',
  'Automations',
  'Appearance',
  'Maintenance',
] as const;
// Order by task rather than when each category was added to the catalog.
const sectionOrder = [
  '/config/groups',
  '/config/devices',
  '/config/integrations',
  '/config/sensors',
  '/config/widget-sources',
  '/config/scenes',
  '/config/routines',
  '/config/timers',
  '/config/blocks',
  '/config/helpers',
  '/config/sources',
  '/config/routine-history',
  '/config/floorplan',
  '/config/dashboard',
  '/config/settings',
  '/config/diagnostics',
  '/config/sensor-history',
  '/config/logs',
  '/config/import-export',
];
const orderedSections = [...configSections].sort((a, b) => {
  const rank = (href: string) => {
    const index = sectionOrder.indexOf(href);
    return index < 0 ? Infinity : index;
  };
  return rank(a.href) - rank(b.href);
});

function NavigationLink({
  to,
  label,
  Icon,
  active,
  close,
}: {
  to: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  close?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={close}
      className={cn('app-category-link', active && 'is-current')}
      aria-current={active ? 'page' : undefined}
    >
      <Icon aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

/** Shared catalog and row treatment for the desktop panel and phone drawer. */
function SettingsCategories({
  mobile = false,
  close,
}: {
  mobile?: boolean;
  close?: () => void;
}) {
  const { pathname } = useLocation();
  const path =
    pathname === '/settings'
      ? '/config'
      : (configSectionAliases[pathname] ?? pathname);
  const scroller = useRef<HTMLElement>(null);
  const currentGroup = orderedSections.find(
    (section) => path === section.href || path.startsWith(section.href + '/'),
  )?.group;
  useLayoutEffect(() => {
    const container = scroller.current;
    const active = container?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (!active || !container) return;
    const bounds = container.getBoundingClientRect(),
      row = active.getBoundingClientRect();
    if (row.top < bounds.top || row.bottom > bounds.bottom) {
      container.scrollTop +=
        row.top < bounds.top
          ? row.top - bounds.top
          : row.bottom - bounds.bottom;
    }
  }, [pathname]);
  const jump = (group: string) => {
    const container = scroller.current;
    const section = container?.querySelector<HTMLElement>(
      `[data-navigation-group="${group}"]`,
    );
    if (!container || !section) return;
    container.scrollTo({
      top:
        container.scrollTop +
        section.getBoundingClientRect().top -
        container.getBoundingClientRect().top,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  return (
    <>
      {mobile && (
        <div
          className="app-navigation-jumps"
          role="group"
          aria-label="Jump to settings group"
        >
          {navigationGroups.map((group) => (
            <button
              key={group}
              className={cn(currentGroup === group && 'is-current')}
              aria-label={`Jump to ${group}`}
              onClick={() => jump(group)}
            >
              {group === 'Your home' ? 'Home' : group}
            </button>
          ))}
        </div>
      )}
      <nav
        ref={scroller}
        aria-label="Settings categories"
        className="app-settings-categories"
      >
        <NavigationLink
          to="/config"
          label="Overview"
          Icon={LayoutGrid}
          active={path === '/config'}
          close={close}
        />
        {navigationGroups.map((group) => (
          <section key={group} data-navigation-group={group}>
            <h3>{group}</h3>
            {orderedSections
              .filter((section) => section.group === group)
              .map((section) => (
                <NavigationLink
                  key={section.href}
                  to={section.href}
                  label={section.label}
                  Icon={section.icon}
                  active={
                    path === section.href || path.startsWith(section.href + '/')
                  }
                  close={close}
                />
              ))}
          </section>
        ))}
      </nav>
    </>
  );
}

function NavigationStatus({ compact = false }: { compact?: boolean }) {
  const connection = useConnectionStatus();
  const label =
    connection === 'connected'
      ? 'Connected'
      : connection === 'connecting'
        ? 'Connecting…'
        : connection === 'reconnecting'
          ? 'Reconnecting…'
          : 'Disconnected';
  return (
    <div
      className={cn('app-navigation-status', compact && 'is-compact')}
      role="status"
      title={`Live connection: ${label}`}
    >
      <span
        className={cn(
          'app-navigation-status-dot',
          connection !== 'connected' && 'is-offline',
        )}
        aria-hidden
      />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </div>
  );
}

/** The rail stays in the same position on every page. Only settings add a panel. */
export function AppSidebar() {
  const { pathname } = useLocation();
  const inSettings = primaryNavigationActive('/config', pathname);
  const [panelOpen, setPanelOpen] = useAtom(settingsPanelOpenAtom);
  const [fullscreen] = useIsFullscreen();
  const [developerMode] = useDeveloperMode();
  const openPalette = useSetAtom(commandPaletteOpenAtom);
  const settingsTrigger = useRef<HTMLAnchorElement>(null);
  // Reset at the settings boundary, before paint. Category navigation preserves
  // a deliberate collapse; entering settings (also via Back/deep links) opens it.
  useLayoutEffect(() => setPanelOpen(inSettings), [inSettings, setPanelOpen]);
  const expanded = inSettings && panelOpen;
  const closePanel = () => {
    setPanelOpen(false);
    settingsTrigger.current?.focus();
  };
  const settingsClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (inSettings) {
      event.preventDefault();
      setPanelOpen(!panelOpen);
    } else setPanelOpen(true);
  };
  if (fullscreen) return null;
  return (
    <aside
      aria-label="Application navigation"
      className="app-navigation hidden lg:flex"
    >
      <div className="app-navigation-rail">
        <Link to="/" aria-label="homectl home" className="app-navigation-mark">
          <HomectlLogo />
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="app-rail-search"
              aria-label="Search"
              onClick={() => openPalette(true)}
            >
              <Search aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Search your home · Ctrl K
          </TooltipContent>
        </Tooltip>
        <nav aria-label="Primary navigation" className="app-rail-links">
          {primaryNavigationItems.map((item) => (
            <Link
              key={item.to}
              ref={item.to === '/config' ? settingsTrigger : undefined}
              to={item.to}
              onClick={item.to === '/config' ? settingsClick : undefined}
              className={cn(
                'app-rail-link',
                primaryNavigationActive(item.to, pathname) && 'is-current',
              )}
              aria-current={
                primaryNavigationActive(item.to, pathname) ? 'page' : undefined
              }
              aria-expanded={item.to === '/config' ? expanded : undefined}
              aria-controls={
                item.to === '/config' && expanded
                  ? 'desktop-settings-panel'
                  : undefined
              }
            >
              <item.icon aria-hidden />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="app-rail-footer">
          {developerMode && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => window.location.reload()}
            >
              <RefreshCw aria-hidden />
            </Button>
          )}
          <NavigationStatus compact />
        </div>
      </div>
      {expanded && (
        <section
          id="desktop-settings-panel"
          aria-label="Settings panel"
          className="app-settings-panel"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              closePanel();
            }
          }}
        >
          <header className="app-settings-panel-header">
            <h2>Settings</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close settings panel"
              title="Close settings panel"
              onClick={closePanel}
            >
              <X aria-hidden />
            </Button>
          </header>
          <SettingsCategories />
          <footer className="app-settings-panel-footer">
            <span>Configuration</span>
            <span>{configSections.length} sections</span>
          </footer>
        </section>
      )}
    </aside>
  );
}

export function AppNavigationMenu() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const inSettings = primaryNavigationActive('/config', pathname);
  const setPanelOpen = useSetAtom(settingsPanelOpenAtom);
  const paletteOpen = useAtomValue(commandPaletteOpenAtom);
  const openPalette = useSetAtom(commandPaletteOpenAtom);
  const [developerMode] = useDeveloperMode();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className="shrink-0 lg:hidden"
        >
          <Menu />
        </Button>
      </DialogTrigger>
      <DialogContent
        showClose={false}
        className="app-navigation-drawer left-0 top-[var(--app-visual-viewport-top,0px)] flex h-[var(--app-visual-viewport-height,100dvh)] max-h-none w-[min(340px,calc(100vw-44px))] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:p-0"
        onCloseAutoFocus={(event) => {
          if (paletteOpen) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <DialogDescription className="sr-only">
          Navigate your home and settings.
        </DialogDescription>
        <header className="app-drawer-header">
          <Link
            to="/"
            className="app-drawer-brand"
            aria-label="homectl home"
            onClick={() => setOpen(false)}
          >
            <span className="app-navigation-mark">
              <HomectlLogo />
            </span>
            homectl
          </Link>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close navigation">
              <X />
            </Button>
          </DialogClose>
        </header>
        <Button
          variant="outline"
          className="app-drawer-search"
          aria-label="Search"
          onClick={() => {
            setOpen(false);
            openPalette(true);
          }}
        >
          <Search aria-hidden />
          <span>Search your home</span>
        </Button>
        <nav aria-label="Primary navigation" className="app-drawer-primary">
          {primaryNavigationItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'app-rail-link',
                primaryNavigationActive(item.to, pathname) && 'is-current',
              )}
              aria-current={
                primaryNavigationActive(item.to, pathname) ? 'page' : undefined
              }
              onClick={() => {
                if (item.to === '/config') setPanelOpen(true);
                setOpen(false);
              }}
            >
              <item.icon aria-hidden />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        {inSettings ? (
          <SettingsCategories mobile close={() => setOpen(false)} />
        ) : (
          <div className="min-h-0 flex-1" />
        )}
        <footer className="app-drawer-footer">
          <NavigationStatus />
          {developerMode && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              onClick={() => window.location.reload()}
            >
              <RefreshCw aria-hidden />
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
