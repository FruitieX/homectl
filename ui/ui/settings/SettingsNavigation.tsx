import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, House, Menu, Search, LayoutGrid } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { configSections, configSectionAliases } from 'app/config/sections';
import { commandPaletteOpenAtom } from '@/ui/CommandPalette';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/ui/primitives/dialog';

function Categories({ close }: { close?: () => void }) {
  return (
    <nav aria-label="Settings categories" className="settings-categories">
      <NavLink end to="/config" onClick={close}>
        <LayoutGrid aria-hidden className="size-4 shrink-0" />
        Overview
      </NavLink>
      {(['Your home', 'Automations', 'Appearance', 'Maintenance'] as const).map(
        (group) => (
          <div key={group}>
            <p className="mb-1 mt-5 px-3 text-xs font-medium text-muted-foreground">
              {group}
            </p>
            {configSections
              .filter((section) => section.group === group)
              .map((section) => (
                <NavLink key={section.href} to={section.href} onClick={close}>
                  <section.icon aria-hidden className="size-4 shrink-0" />
                  {section.label}
                </NavLink>
              ))}
          </div>
        ),
      )}
    </nav>
  );
}
export function SettingsNavigation() {
  const openPalette = useSetAtom(commandPaletteOpenAtom);
  return (
    <aside className="settings-rail hidden w-[214px] shrink-0 flex-col border-r border-border bg-background p-3 lg:flex">
      <Link
        to="/"
        className="mb-3 flex h-11 items-center gap-2 px-3 text-sm font-semibold"
      >
        <House className="size-4" />
        homectl
      </Link>
      <Button
        variant="outline"
        className="mb-2 justify-start"
        onClick={() => openPalette(true)}
      >
        <Search className="size-4" />
        Search<span className="ml-auto text-xs text-muted-foreground">⌘ K</span>
      </Button>
      <div className="min-h-0 flex-1 overflow-auto">
        <Categories />
      </div>
    </aside>
  );
}
export function SettingsBreadcrumbs() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const resolved = configSectionAliases[pathname] ?? pathname;
  const section =
    pathname === '/config/floorplan'
      ? configSections.find((entry) => entry.href === resolved)
      : configSections.find((entry) => resolved.startsWith(`${entry.href}/`));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          aria-label="Settings categories"
        >
          <Menu />
        </Button>
      </DialogTrigger>
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
      <DialogContent className="flex max-h-[min(85dvh,calc(var(--app-visual-viewport-height,100dvh)-2rem))] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Choose a category.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <Categories close={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
