import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, House, Menu, Search } from 'lucide-react';
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
} from '@/ui/primitives/dialog';

function Categories({ close }: { close?: () => void }) {
  return (
    <nav aria-label="Settings categories" className="settings-categories">
      <NavLink end to="/config" onClick={close}>
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
  const section = configSections.find((entry) =>
    resolved.startsWith(`${entry.href}/`),
  );
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 lg:hidden"
        aria-label="Settings categories"
        onClick={() => setOpen(true)}
      >
        <Menu />
      </Button>
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
            <Link className="truncate" to={section.href}>
              {section.label}
            </Link>
          </>
        )}
      </nav>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Choose a category.</DialogDescription>
          </DialogHeader>
          <Categories close={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
