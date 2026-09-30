import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Cog,
  House,
  Layers3,
  LayoutGrid,
  Map,
  Menu,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { configSections, configSectionAliases } from 'app/config/sections';
import { useDeveloperMode } from '@/hooks/developerMode';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { commandPaletteOpenAtom } from '@/ui/CommandPalette';
import { HomectlLogo } from '@/ui/HomectlLogo';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/ui/primitives/dialog';
import { cn } from '@/lib/cn';

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

// Shared across desktop and the phone menu; navigating does not replace the shell.
const settingsExpandedAtom = atom<boolean | null>(null);
const linkClass = (active: boolean) =>
  cn(
    'flex min-h-10 min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:min-h-[44px]',
    active &&
      'bg-primary/10 font-medium text-primary hover:bg-primary/12 hover:text-primary',
  );

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
  active?: boolean;
  close?: () => void;
}) {
  const { pathname } = useLocation();
  const current =
    active ??
    (pathname === to ||
      (to !== '/' && to !== '/config' && pathname.startsWith(to + '/')));
  return (
    <Link
      to={to}
      onClick={close}
      className={linkClass(current)}
      aria-current={current ? 'page' : undefined}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0">{label}</span>
    </Link>
  );
}

/** One composition for every application page, including the editor. */
function NavigationContent({ close }: { close?: () => void }) {
  const { pathname } = useLocation();
  const inSettings = primaryNavigationActive('/config', pathname);
  const [settingsExpanded, setSettingsExpanded] = useAtom(settingsExpandedAtom);
  const expanded = settingsExpanded ?? inSettings;
  const [developerMode] = useDeveloperMode();
  const openPalette = useSetAtom(commandPaletteOpenAtom);
  useEffect(() => {
    if (inSettings) setSettingsExpanded(true);
  }, [inSettings, setSettingsExpanded]);
  return (
    <>
      <Link
        to="/"
        onClick={close}
        aria-label="homectl home"
        className="flex h-14 shrink-0 items-center gap-3 px-3 text-base font-semibold"
      >
        <HomectlLogo className="size-6" />
        <span>homectl</span>
      </Link>
      <Button
        variant="outline"
        aria-label="Search"
        className="mb-3 min-h-11 shrink-0 justify-start gap-3 px-3"
        onClick={() => {
          close?.();
          openPalette(true);
        }}
      >
        <Search aria-hidden className="size-4" />
        Search
        <kbd className="ml-auto hidden text-[10px] text-muted-foreground lg:inline">
          Ctrl K
        </kbd>
      </Button>
      <nav aria-label="Primary navigation" className="shrink-0 space-y-1">
        {primaryNavigationItems.map((item) =>
          item.to === '/config' ? (
            <div key={item.to} className="relative">
              <NavigationLink
                to={item.to}
                label={item.label}
                Icon={item.icon}
                active={inSettings}
                close={close}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
                aria-label={
                  expanded
                    ? 'Collapse settings categories'
                    : 'Expand settings categories'
                }
                aria-expanded={expanded}
                aria-controls={
                  close
                    ? 'mobile-settings-navigation'
                    : 'desktop-settings-navigation'
                }
                onClick={() => setSettingsExpanded(!expanded)}
              >
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform',
                    !expanded && '-rotate-90',
                  )}
                />
              </Button>
            </div>
          ) : (
            <NavigationLink
              key={item.to}
              to={item.to}
              label={item.label}
              Icon={item.icon}
              active={primaryNavigationActive(item.to, pathname)}
              close={close}
            />
          ),
        )}
      </nav>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-3 [scrollbar-width:thin]">
        {expanded && (
          <nav
            aria-label="Settings categories"
            id={
              close
                ? 'mobile-settings-navigation'
                : 'desktop-settings-navigation'
            }
            className="space-y-1"
          >
            <NavigationLink
              to="/config"
              label="Overview"
              Icon={LayoutGrid}
              close={close}
            />
            {(
              ['Your home', 'Automations', 'Appearance', 'Maintenance'] as const
            ).map((group) => (
              <div key={group}>
                <p className="mb-1 mt-4 px-3 text-xs font-medium text-muted-foreground">
                  {group}
                </p>
                {configSections
                  .filter((section) => section.group === group)
                  .map((section) => (
                    <NavigationLink
                      key={section.href}
                      to={section.href}
                      label={section.label}
                      Icon={section.icon}
                      active={
                        (configSectionAliases[pathname] ?? pathname) ===
                          section.href ||
                        (configSectionAliases[pathname] ?? pathname).startsWith(
                          section.href + '/',
                        )
                      }
                      close={close}
                    />
                  ))}
              </div>
            ))}
          </nav>
        )}
      </div>
      {developerMode && (
        <Button
          variant="ghost"
          className="mt-2 min-h-11 shrink-0 justify-start gap-3 px-3"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      )}
    </>
  );
}

export function AppSidebar() {
  const [fullscreen] = useIsFullscreen();
  if (fullscreen) return null;
  return (
    <aside
      aria-label="Application navigation"
      className="relative z-30 hidden w-60 shrink-0 flex-col border-r border-border bg-background px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[env(safe-area-inset-top)] lg:flex"
    >
      <NavigationContent />
    </aside>
  );
}

export function AppNavigationMenu() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const paletteOpen = useAtomValue(commandPaletteOpenAtom);
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
        className="left-0 top-[var(--app-visual-viewport-top,0px)] flex h-[var(--app-visual-viewport-height,100dvh)] max-h-none w-[min(20rem,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 bg-background px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[env(safe-area-inset-top)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:p-3"
        onCloseAutoFocus={(event) => {
          if (paletteOpen) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <DialogDescription className="sr-only">
          Navigate your home and settings.
        </DialogDescription>
        <NavigationContent close={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
