import { atom, useAtom, useSetAtom } from 'jotai';
import {
  Activity,
  ArrowRight,
  Cog,
  Compass,
  Download,
  LayoutGrid,
  Layers3,
  Lightbulb,
  ListTree,
  MonitorCog,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { openAssistantPanelAtom } from '@/assistant/state';
import { configSections } from '../app/config/sections';
import {
  densityAtom,
  useFavoriteKeys,
  useRecents,
  useRecordRecent,
} from '@/hooks/preferences';
import { useTheme, type ThemeMode } from '@/hooks/theme';
import {
  useDevicesState,
  useGroupsState,
  useScenesState,
} from '@/hooks/websocket';
import { useHelpers, useIntegrations, useRoutines } from '@/hooks/useConfig';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { rankByPreference } from '@/lib/preferences';
import { cn } from '@/lib/cn';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/ui/primitives/command';
import { DialogTitle } from '@/ui/primitives/dialog';

export const commandPaletteOpenAtom = atom(false);

type PaletteItem = {
  key: string;
  label: string;
  description?: string;
  group: string;
  keywords?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  run: () => void;
};

const staticNavItems = [
  {
    key: 'nav:/',
    label: 'Dashboard',
    description: 'Live home controls and widgets',
    keywords: 'home overview widgets',
    href: '/',
  },
  {
    key: 'nav:/map',
    label: 'Floorplan',
    description: 'Spatial device map',
    keywords: 'map floorplan rooms devices',
    href: '/map',
  },
  {
    key: 'nav:/groups',
    label: 'Rooms',
    description: 'Room pages and scene lists',
    keywords: 'rooms groups scenes',
    href: '/groups',
  },
  ...configSections.map((section) => ({
    key: `nav:${section.href}`,
    label: section.label,
    description: section.description,
    keywords: `${section.group} ${section.keywords.join(' ')}`,
    href: section.href,
  })),
  {
    key: 'nav:/config/settings?tab=core',
    label: 'Startup & transitions',
    description: 'When automations begin and how lights change',
    keywords: 'warmup behavior fade core',
    href: '/config/settings?tab=core',
  },
  {
    key: 'nav:/config/settings?tab=assistant',
    label: 'Configuration assistant',
    description: 'Provider, model, and API key',
    keywords: 'assistant ai provider model token',
    href: '/config/settings?tab=assistant',
  },
  {
    key: 'nav:/config/settings?tab=info',
    label: 'App information',
    description: 'Server address and build information',
    keywords: 'endpoint version websocket build',
    href: '/config/settings?tab=info',
  },
];

export function CommandPalette() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const recordRecent = useRecordRecent();
  const favorites = useFavoriteKeys();
  const { recents } = useRecents();
  const [themeMode, setThemeMode] = useTheme();
  const [density, setDensity] = useAtom(densityAtom);
  const openAssistant = useSetAtom(openAssistantPanelAtom);

  const devicesState = useDevicesState();
  const scenesState = useScenesState();
  const groupsState = useGroupsState();
  const { data: routines } = useRoutines();
  const { data: helpers } = useHelpers();
  const { data: integrations } = useIntegrations();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const go = useCallback(
    (key: string, href: string) => {
      recordRecent(key);
      setOpen(false);
      navigate(href);
    },
    [navigate, recordRecent, setOpen],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const result: PaletteItem[] = [];

    for (const item of staticNavItems) {
      result.push({
        key: item.key,
        label: item.label,
        description: item.description,
        keywords: item.keywords,
        group: 'Go to',
        icon: <Compass />,
        run: () => go(item.key, item.href),
      });
    }

    result.push(
      {
        key: 'action:new-routine',
        label: 'New routine',
        description: 'Automate a trigger, condition, and program',
        group: 'Create',
        icon: <Wand2 />,
        run: () => go('action:new-routine', '/config/routines/new'),
      },
      {
        key: 'action:new-scene',
        label: 'New scene',
        description: 'Capture or compose a scene',
        group: 'Create',
        icon: <Lightbulb />,
        run: () => go('action:new-scene', '/config/scenes/new'),
      },
      {
        key: 'action:new-group',
        label: 'New room',
        description: 'Group devices into a room',
        group: 'Create',
        icon: <Layers3 />,
        run: () => go('action:new-group', '/config/groups/new'),
      },
      {
        key: 'action:new-helper',
        label: 'New helper',
        description: 'Typed state for routines and widgets',
        group: 'Create',
        icon: <Cog />,
        run: () => go('action:new-helper', '/config/helpers?new=1'),
      },
      {
        key: 'action:connect-integration',
        label: 'Connect an integration',
        description: 'MQTT, circadian, timers, and more',
        group: 'Create',
        icon: <LayoutGrid />,
        run: () => go('action:connect-integration', '/config/integrations'),
      },
      {
        key: 'action:ask-assistant',
        label: 'Ask the assistant',
        description: 'Plan a configuration change in natural language',
        group: 'Create',
        icon: <Sparkles />,
        run: () => {
          setOpen(false);
          openAssistant();
        },
      },
    );

    const themeOptions: {
      mode: ThemeMode;
      label: string;
      icon: React.ReactNode;
    }[] = [
      { mode: 'light', label: 'Theme: Light', icon: <Sun /> },
      { mode: 'dark', label: 'Theme: Dark', icon: <Moon /> },
      { mode: 'auto', label: 'Theme: Auto', icon: <MonitorCog /> },
    ];
    for (const option of themeOptions) {
      result.push({
        key: `theme:${option.mode}`,
        label: option.label,
        description:
          themeMode === option.mode ? 'Current theme' : 'Switch theme',
        group: 'Appearance',
        icon: option.icon,
        run: () => {
          setThemeMode(option.mode);
          setOpen(false);
        },
      });
    }

    result.push({
      key: 'appearance:density',
      label:
        density === 'comfortable'
          ? 'Density: Switch to compact'
          : 'Density: Switch to comfortable',
      description: 'Fit more rows on screen or keep larger touch targets',
      group: 'Appearance',
      icon: <ListTree />,
      run: () => {
        setDensity(density === 'comfortable' ? 'compact' : 'comfortable');
        setOpen(false);
      },
    });

    result.push(
      {
        key: 'action:diagnostics',
        label: 'Open configuration check',
        description: 'Missing references, loops, and unresolved targets',
        group: 'Tools',
        icon: <Activity />,
        run: () => go('action:diagnostics', '/config/diagnostics'),
      },
      {
        key: 'action:export-backup',
        label: 'Export a backup',
        description: 'Download the current configuration as JSON',
        group: 'Tools',
        icon: <Download />,
        run: () => go('action:export-backup', '/config/import-export'),
      },
    );

    for (const [key, device] of Object.entries(devicesState ?? {})) {
      if (!device) continue;
      const label = getDeviceDisplayLabel(device);
      result.push({
        key: `device:${key}`,
        label,
        description: `${device.integration_id} · ${device.id}`,
        keywords: `${key} ${device.id} ${device.integration_id} device`,
        group: 'Devices',
        icon: <Lightbulb />,
        run: () =>
          go(
            `device:${key}`,
            `/config/devices/detail?key=${encodeURIComponent(key)}`,
          ),
      });
    }

    for (const [key, scene] of Object.entries(scenesState ?? {})) {
      if (!scene) continue;
      result.push({
        key: `scene:${key}`,
        label: scene.name,
        description: `Scene · ${key}`,
        keywords: `${key} scene`,
        group: 'Scenes',
        icon: <Lightbulb />,
        run: () =>
          go(`scene:${key}`, `/config/scenes/${encodeURIComponent(key)}`),
      });
    }

    for (const [key, group] of Object.entries(groupsState ?? {})) {
      if (!group) continue;
      result.push({
        key: `group:${key}`,
        label: group.name,
        description: `Room · ${key}`,
        keywords: `${key} room group`,
        group: 'Rooms',
        icon: <Layers3 />,
        run: () => go(`group:${key}`, `/groups/${encodeURIComponent(key)}`),
      });
    }

    for (const routine of routines ?? []) {
      result.push({
        key: `routine:${routine.id}`,
        label: routine.name,
        description: `Routine · ${routine.id}`,
        keywords: `${routine.id} routine automation`,
        group: 'Routines',
        icon: <Wand2 />,
        run: () =>
          go(
            `routine:${routine.id}`,
            `/config/routines/${encodeURIComponent(routine.id)}`,
          ),
      });
    }

    for (const helper of helpers ?? []) {
      result.push({
        key: `helper:${helper.id}`,
        label: helper.name || helper.id,
        description: `Helper · ${helper.id}`,
        keywords: `${helper.id} helper value`,
        group: 'Helpers',
        icon: <Cog />,
        run: () =>
          go(
            `helper:${helper.id}`,
            `/config/helpers/${encodeURIComponent(helper.id)}`,
          ),
      });
    }

    for (const integration of integrations ?? []) {
      result.push({
        key: `integration:${integration.id}`,
        label: integration.id,
        description: `Integration · ${integration.plugin}`,
        keywords: `${integration.id} ${integration.plugin} plugin`,
        group: 'Integrations',
        icon: <LayoutGrid />,
        run: () =>
          go(
            `integration:${integration.id}`,
            `/config/integrations/${encodeURIComponent(integration.id)}`,
          ),
      });
    }

    return result;
  }, [
    density,
    devicesState,
    go,
    groupsState,
    helpers,
    integrations,
    openAssistant,
    routines,
    scenesState,
    setDensity,
    setOpen,
    setThemeMode,
    themeMode,
  ]);

  const ranked = useMemo(() => {
    const favoriteList = Array.from(favorites);
    return rankByPreference(items, (item) => item.key, favoriteList, recents);
  }, [favorites, items, recents]);

  const recentItems = useMemo(() => {
    const byKey = new Map(items.map((item) => [item.key, item]));
    return recents
      .map((key) => byKey.get(key))
      .filter((item): item is PaletteItem => item !== undefined)
      .slice(0, 5);
  }, [items, recents]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const item of ranked) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [ranked]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search settings, devices, scenes, routines, actions…"
      />
      <CommandList className="max-h-[min(70dvh,32rem)]">
        <CommandEmpty>No matches found.</CommandEmpty>

        {recentItems.length > 0 ? (
          <CommandGroup heading="Recent">
            {recentItems.map((item) => (
              <PaletteRow key={`recent-${item.key}`} item={item} />
            ))}
          </CommandGroup>
        ) : null}

        {Array.from(groups.entries()).map(([group, groupItems]) => (
          <CommandGroup key={group} heading={group}>
            {groupItems.slice(0, 40).map((item) => (
              <PaletteRow key={item.key} item={item} />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[0.7rem] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ArrowRight className="size-3" />
          Select to open
        </span>
        <span className="flex items-center gap-2">
          <span>
            <kbd className="rounded border border-border px-1.5 py-0.5 font-sans">
              Ctrl
            </kbd>{' '}
            +{' '}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-sans">
              K
            </kbd>{' '}
            or{' '}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-sans">
              P
            </kbd>
          </span>
        </span>
      </div>
    </CommandDialog>
  );
}

function PaletteRow({ item }: { item: PaletteItem }) {
  return (
    <CommandItem
      value={`${item.label} ${item.description ?? ''} ${item.keywords ?? ''} ${item.key}`}
      onSelect={item.run}
    >
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground [&_svg]:size-3.5',
        )}
      >
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.description ? (
          <span className="block truncate text-xs text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
      {item.shortcut ? (
        <CommandShortcut>{item.shortcut}</CommandShortcut>
      ) : null}
    </CommandItem>
  );
}
