import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Download,
  Layers3,
  LayoutGrid,
  Lightbulb,
  MonitorCog,
  Plus,
  Search,
  Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { ConfigDiagnostics } from '@/bindings/ConfigDiagnostics';
import { useAppConfig } from '@/hooks/appConfig';
import { useRecents, useRecordRecent } from '@/hooks/preferences';
import {
  useDevicesState,
  useGroupsState,
  useScenesState,
} from '@/hooks/websocket';
import { useHelpers, useIntegrations, useRoutines } from '@/hooks/useConfig';
import { formatBuildInfoSummary, normalizeBuildInfo } from '@/lib/buildInfo';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import {
  configSections,
  matchesConfigSectionSearch,
  type ConfigSection,
} from './sections';
import { ConfigPageHeader } from './page-header';

const sectionGroups = [
  'Core',
  'Automation',
  'Interface',
  'Operations',
] as const;

const groupIcons = {
  Core: LayoutGrid,
  Automation: Wand2,
  Interface: MonitorCog,
  Operations: Activity,
} as const;

const staticNavItems = [
  {
    key: 'nav:/',
    label: 'Dashboard',
    description: 'Live home controls and widgets',
    href: '/',
  },
  {
    key: 'nav:/map',
    label: 'Floorplan',
    description: 'Spatial device map',
    href: '/map',
  },
  {
    key: 'nav:/groups',
    label: 'Rooms',
    description: 'Room pages and scene lists',
    href: '/groups',
  },
];

const quickActions = [
  {
    key: 'action:new-routine',
    label: 'New routine',
    href: '/config/routines?new=1',
    icon: Wand2,
  },
  {
    key: 'action:new-scene',
    label: 'New scene',
    href: '/config/scenes?new=1',
    icon: Lightbulb,
  },
  {
    key: 'action:new-group',
    label: 'New room',
    href: '/config/groups?new=1',
    icon: Layers3,
  },
  {
    key: 'action:connect-integration',
    label: 'Add integration',
    href: '/config/integrations',
    icon: LayoutGrid,
  },
  {
    key: 'action:export-backup',
    label: 'Export backup',
    href: '/config/import-export',
    icon: Download,
  },
] as const;

const buildInfo = normalizeBuildInfo({
  version: import.meta.env.VITE_APP_VERSION,
  gitCommit: import.meta.env.VITE_GIT_COMMIT,
  buildDate: import.meta.env.VITE_BUILD_DATE,
});

export default function ConfigPage() {
  const [search, setSearch] = useState('');
  const { apiEndpoint } = useAppConfig();
  const navigate = useNavigate();
  const recordRecent = useRecordRecent();
  const { recents } = useRecents();

  const devicesState = useDevicesState();
  const groupsState = useGroupsState();
  const scenesState = useScenesState();
  const { data: routines } = useRoutines();
  const { data: helpers } = useHelpers();
  const { data: integrations } = useIntegrations();

  const diagnostics = useQuery({
    queryKey: ['config-diagnostics', apiEndpoint],
    queryFn: async (): Promise<ConfigDiagnostics> => {
      const response = await fetch(`${apiEndpoint}/api/v1/config/diagnostics`);
      if (!response.ok) {
        throw new Error('Could not load configuration checks.');
      }
      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Could not load configuration checks.');
      }
      return result.data;
    },
    staleTime: 30_000,
    retry: false,
  });

  const open = (key: string, href: string) => {
    recordRecent(key);
    navigate(href);
  };

  const linkIndex = useMemo(() => {
    const index = new Map<string, { label: string; href: string }>();
    for (const item of staticNavItems) {
      index.set(item.key, { label: item.label, href: item.href });
    }
    for (const section of configSections) {
      index.set(`nav:${section.href}`, {
        label: section.label,
        href: section.href,
      });
    }
    for (const [key, device] of Object.entries(devicesState ?? {})) {
      if (!device) continue;
      index.set(`device:${key}`, {
        label: getDeviceDisplayLabel(device),
        href: `/config/devices?device=${encodeURIComponent(key)}`,
      });
    }
    for (const [key, scene] of Object.entries(scenesState ?? {})) {
      if (!scene) continue;
      index.set(`scene:${key}`, {
        label: scene.name,
        href: `/config/scenes?scene=${encodeURIComponent(key)}`,
      });
    }
    for (const [key, group] of Object.entries(groupsState ?? {})) {
      if (!group) continue;
      index.set(`group:${key}`, {
        label: group.name,
        href: `/groups/${encodeURIComponent(key)}`,
      });
    }
    for (const routine of routines ?? []) {
      index.set(`routine:${routine.id}`, {
        label: routine.name,
        href: `/config/routines?q=${encodeURIComponent(routine.name)}`,
      });
    }
    for (const helper of helpers ?? []) {
      index.set(`helper:${helper.id}`, {
        label: helper.name || helper.id,
        href: `/config/helpers?q=${encodeURIComponent(helper.name || helper.id)}`,
      });
    }
    for (const integration of integrations ?? []) {
      index.set(`integration:${integration.id}`, {
        label: integration.id,
        href: `/config/integrations?q=${encodeURIComponent(integration.id)}`,
      });
    }
    return index;
  }, [
    devicesState,
    groupsState,
    helpers,
    integrations,
    routines,
    scenesState,
  ]);

  const recentEntries = useMemo(
    () =>
      recents
        .map((key) => ({ key, entry: linkIndex.get(key) }))
        .filter(
          (item): item is { key: string; entry: { label: string; href: string } } =>
            item.entry !== undefined,
        )
        .slice(0, 6),
    [linkIndex, recents],
  );

  const attentionItems = useMemo(() => {
    const items: {
      key: string;
      title: string;
      detail: string;
      href: string;
      severity: 'warning' | 'info';
    }[] = [];

    const warnings =
      diagnostics.data?.issues.filter((issue) => issue.severity === 'warning') ??
      [];
    if (warnings.length > 0) {
      const first = warnings[0];
      items.push({
        key: 'diagnostics',
        title:
          warnings.length === 1
            ? '1 configuration warning'
            : `${warnings.length} configuration warnings`,
        detail: `${first.name}: ${first.message}`,
        href: `/config/diagnostics?q=${encodeURIComponent(first.entity_id)}`,
        severity: 'warning',
      });
    }

    const assignedKeys = new Set<string>();
    for (const group of Object.values(groupsState ?? {})) {
      for (const key of group?.device_keys ?? []) {
        assignedKeys.add(key);
      }
    }
    const unassigned = Object.keys(devicesState ?? {}).filter(
      (key) => !assignedKeys.has(key),
    );
    if (unassigned.length > 0) {
      items.push({
        key: 'unassigned-devices',
        title:
          unassigned.length === 1
            ? '1 device is not in a room'
            : `${unassigned.length} devices are not in a room`,
        detail: 'Assign them to rooms so scenes and routines can target them.',
        href: '/config/devices',
        severity: 'info',
      });
    }

    const legacyRoutines = (routines ?? []).filter(
      (routine) => routine.semantics_version !== 2,
    );
    if (legacyRoutines.length > 0) {
      items.push({
        key: 'legacy-routines',
        title:
          legacyRoutines.length === 1
            ? '1 routine still uses the legacy engine'
            : `${legacyRoutines.length} routines still use the legacy engine`,
        detail: 'Convert them to unlock conditions, programs, and dry runs.',
        href: '/config/routines',
        severity: 'info',
      });
    }

    return items;
  }, [devicesState, diagnostics.data, groupsState, routines]);

  const visibleSections = configSections.filter((section) =>
    matchesConfigSectionSearch(section, search),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <ConfigPageHeader
          backTo={null}
          title="Settings"
          description="Set up your home, tune automations, and keep an eye on health."
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search settings…"
            aria-label="Search configuration sections"
            className="pl-9"
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => open(action.key, action.href)}
                className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-3 text-left text-sm font-medium transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                <Plus className="size-3.5 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </section>

      {attentionItems.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs attention
          </h2>
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <Link
                key={item.key}
                to={item.href}
                onClick={() => recordRecent(`nav:${item.href}`)}
                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 transition hover:bg-accent"
              >
                <AlertTriangle
                  className={
                    item.severity === 'warning'
                      ? 'mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400'
                      : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {recentEntries.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent
          </h2>
          <div className="flex flex-wrap gap-2">
            {recentEntries.map(({ key, entry }) => (
              <Link
                key={key}
                to={entry.href}
                onClick={() => recordRecent(key)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm transition hover:bg-accent"
              >
                {entry.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {visibleSections.length === 0 ? (
        <EmptyState
          title="No settings found"
          description="Try searching for a plugin, automation, dashboard, backup, or runtime term."
        />
      ) : (
        <div className="space-y-3">
          {sectionGroups.map((group) => {
            const groupSections = visibleSections.filter(
              (section) => section.group === group,
            );
            if (groupSections.length === 0) return null;
            return (
              <CollapsibleSection
                key={group}
                group={group}
                sections={groupSections}
                forceOpen={search.trim().length > 0}
              />
            );
          })}
        </div>
      )}

      <footer className="border-t border-border/50 pt-4 text-center text-xs text-muted-foreground/70">
        <p className="break-words leading-relaxed">
          {formatBuildInfoSummary(buildInfo)}
        </p>
      </footer>
    </div>
  );
}

function CollapsibleSection({
  group,
  sections,
  forceOpen,
}: {
  group: (typeof sectionGroups)[number];
  sections: ConfigSection[];
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = groupIcons[group];
  const expanded = open || forceOpen;

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/60"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{group}</span>
          <span className="block text-xs text-muted-foreground">
            {sections.length} {sections.length === 1 ? 'page' : 'pages'}
          </span>
        </span>
        <ChevronRight
          className={
            expanded
              ? 'size-4 shrink-0 rotate-90 text-muted-foreground transition-transform'
              : 'size-4 shrink-0 text-muted-foreground transition-transform'
          }
        />
      </button>
      {expanded ? (
        <div className="grid gap-2 border-t border-border/60 p-3 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <Link
              key={section.href}
              to={section.href}
              className="rounded-2xl border border-border/70 bg-background/70 p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="text-sm font-semibold">{section.label}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {section.description}
              </p>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
