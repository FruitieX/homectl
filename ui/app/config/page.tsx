import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Download,
  Layers3,
  Lightbulb,
  PlugZap,
  Search,
  Wand2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ConfigDiagnostics } from '@/bindings/ConfigDiagnostics';
import { useAppConfig } from '@/hooks/appConfig';
import { useRecents, useRecordRecent } from '@/hooks/preferences';
import {
  useDevicesState,
  useGroupsState,
  useScenesState,
} from '@/hooks/websocket';
import { useHelpers, useIntegrations, useRoutines } from '@/hooks/useConfig';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { configItemHref } from '@/lib/configItemHref';
import { configSections } from './sections';
import { ConfigPageHeader } from './page-header';

type Destination = {
  key: string;
  label: string;
  description: string;
  href: string;
  group: string;
  keywords?: string;
};

const sectionGroups = [
  'Your home',
  'Automations',
  'Appearance',
  'Maintenance',
] as const;
const tasks = [
  {
    key: 'new-group',
    label: 'Add a room',
    href: '/config/groups/new',
    icon: Layers3,
    keywords: 'group organize devices',
  },
  {
    key: 'new-scene',
    label: 'Create a scene',
    href: '/config/scenes/new',
    icon: Lightbulb,
    keywords: 'preset lighting',
  },
  {
    key: 'new-routine',
    label: 'Create a routine',
    href: '/config/routines/new',
    icon: Wand2,
    keywords: 'automation trigger action',
  },
  {
    key: 'connect-integration',
    label: 'Add a connection',
    href: '/config/integrations?new=1',
    icon: PlugZap,
    keywords: 'integration plugin mqtt',
  },
  {
    key: 'export-backup',
    label: 'Export a backup',
    href: '/config/import-export',
    icon: Download,
    keywords: 'save restore configuration',
  },
] as const;

const setupDismissalKey = 'homectl-settings-setup-dismissed';

export default function ConfigPage() {
  const [search, setSearch] = useState('');
  const [setupDismissed, setSetupDismissed] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.localStorage.getItem(setupDismissalKey) === '1',
  );
  const { apiEndpoint } = useAppConfig();
  const recordRecent = useRecordRecent();
  const { recents } = useRecents();
  const devices = useDevicesState();
  const groups = useGroupsState();
  const scenes = useScenesState();
  const { data: routines } = useRoutines();
  const { data: helpers } = useHelpers();
  const { data: integrations, loading: integrationsLoading } =
    useIntegrations();

  const diagnostics = useQuery({
    queryKey: ['config-diagnostics', apiEndpoint],
    queryFn: async (): Promise<ConfigDiagnostics> => {
      const response = await fetch(`${apiEndpoint}/api/v1/config/diagnostics`);
      if (!response.ok) throw new Error('Could not check configuration.');
      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Could not check configuration.');
      }
      return result.data;
    },
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  });

  const destinations = useMemo(() => {
    const entries: Destination[] = [
      ...configSections.map((section) => ({
        key: `nav:${section.href}`,
        label: section.label,
        description: section.description,
        href: section.href,
        group: 'Settings',
        keywords: `${section.group} ${section.keywords.join(' ')}`,
      })),
      ...tasks.map((task) => ({
        key: `action:${task.key}`,
        label: task.label,
        description: 'Start this task',
        href: task.href,
        group: 'Tasks',
        keywords: task.keywords,
      })),
      {
        key: 'system:appearance',
        label: 'Appearance',
        description: 'Theme, accent color, and display density',
        href: '/config/settings',
        group: 'Settings',
        keywords: 'light dark theme display',
      },
      {
        key: 'system:behavior',
        label: 'Startup & transitions',
        description: 'When automations begin and how lights change',
        href: '/config/settings?tab=core',
        group: 'Settings',
        keywords: 'warmup duration fade core',
      },
      {
        key: 'system:assistant',
        label: 'Configuration assistant',
        description: 'Provider, model, and API key',
        href: '/config/settings?tab=assistant',
        group: 'Settings',
        keywords: 'ai assistant base url token',
      },
      {
        key: 'system:about',
        label: 'App information',
        description: 'Server address and build information',
        href: '/config/settings?tab=info',
        group: 'Settings',
        keywords: 'endpoint version websocket build',
      },
    ];
    for (const [key, device] of Object.entries(devices ?? {})) {
      if (!device) continue;
      entries.push({
        key: `device:${key}`,
        label: getDeviceDisplayLabel(device),
        description: 'Device',
        href: `/config/devices/detail?key=${encodeURIComponent(key)}`,
        group: 'Devices',
        keywords: key,
      });
    }
    for (const [key, group] of Object.entries(groups ?? {})) {
      if (!group) continue;
      entries.push({
        key: `group:${key}`,
        label: group.name,
        description: 'Room',
        href: `/config/groups/${encodeURIComponent(key)}`,
        group: 'Rooms',
        keywords: key,
      });
    }
    for (const [key, scene] of Object.entries(scenes ?? {})) {
      if (!scene) continue;
      entries.push({
        key: `scene:${key}`,
        label: scene.name,
        description: 'Scene',
        href: `/config/scenes/${encodeURIComponent(key)}`,
        group: 'Scenes',
        keywords: key,
      });
    }
    for (const routine of routines ?? []) {
      entries.push({
        key: `routine:${routine.id}`,
        label: routine.name,
        description: 'Routine',
        href: `/config/routines/${encodeURIComponent(routine.id)}`,
        group: 'Routines',
        keywords: routine.id,
      });
    }
    for (const helper of helpers ?? []) {
      entries.push({
        key: `helper:${helper.id}`,
        label: helper.name || helper.id,
        description: 'Helper',
        href: `/config/helpers/${encodeURIComponent(helper.id)}`,
        group: 'Helpers',
        keywords: helper.id,
      });
    }
    for (const integration of integrations ?? []) {
      entries.push({
        key: `integration:${integration.id}`,
        label: integration.id,
        description: 'Connection or service',
        href: `/config/integrations/${encodeURIComponent(integration.id)}`,
        group: 'Connections',
        keywords: integration.id,
      });
    }
    return entries;
  }, [devices, groups, scenes, routines, helpers, integrations]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const searchResults = normalizedSearch
    ? destinations
        .filter((entry) =>
          `${entry.label} ${entry.description} ${entry.keywords ?? ''}`
            .toLocaleLowerCase()
            .includes(normalizedSearch),
        )
        .slice(0, 40)
    : [];
  const searchGroups = [...new Set(searchResults.map((entry) => entry.group))];
  const recentEntries = recents
    .map((key) => destinations.find((entry) => entry.key === key))
    .filter((entry): entry is Destination => entry !== undefined)
    // Task links already sit on the first screenful, so repeating them here
    // would show the same item twice.
    .filter((entry) => !entry.key.startsWith('action:'))
    .slice(0, 5);
  const warnings =
    diagnostics.data?.issues.filter((issue) => issue.severity === 'warning') ??
    [];
  const reviewCount = (diagnostics.data?.issues.length ?? 0) - warnings.length;
  const setupStep = integrationsLoading
    ? null
    : !integrations?.length
      ? {
          label: 'Connect your first device or service',
          detail: 'Choose an integration to bring your home into view.',
          href: '/config/integrations?new=1',
        }
      : Object.keys(devices ?? {}).length === 0
        ? {
            label: 'Waiting for devices',
            detail:
              'Your connection is set up. Check its settings if devices do not appear.',
            href: '/config/integrations',
          }
        : Object.keys(groups ?? {}).length === 0
          ? {
              label: 'Create a room',
              detail:
                'Group the devices you want to control together. Sensors can stay unassigned.',
              href: '/config/groups/new',
            }
          : Object.keys(scenes ?? {}).length === 0
            ? {
                label: 'Save a scene',
                detail:
                  'Capture a useful device state so you can recall it later.',
                href: '/config/scenes/new',
              }
            : (routines?.length ?? 0) === 0
              ? {
                  label: 'Create an automation',
                  detail:
                    'Use a sensor, schedule, or button to activate a scene automatically.',
                  href: '/config/routines/new',
                }
              : null;

  const trackedLink = (entry: Destination, className: string) => (
    <Link
      key={entry.key}
      to={entry.href}
      onClick={() => recordRecent(entry.key)}
      className={className}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {entry.label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {entry.description}
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/60"
        aria-hidden
      />
    </Link>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-8">
      <div className="space-y-5">
        <ConfigPageHeader
          backTo={null}
          title="Settings"
          description="Everything you need to set up and understand your home."
        />
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search settings, devices, rooms, or tasks"
            aria-label="Search settings, devices, rooms, or tasks"
            className="h-12 rounded-2xl bg-card pl-12 pr-10 text-base shadow-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {normalizedSearch ? (
        <div className="space-y-5">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {searchResults.length === 40
              ? 'First 40 matches'
              : `${searchResults.length} ${searchResults.length === 1 ? 'match' : 'matches'}`}{' '}
            for “{search.trim()}”
          </p>
          {searchResults.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-8 text-center">
              <CircleHelp className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="font-medium">Nothing found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a device name, room, task, or technical term.
              </p>
            </div>
          ) : (
            searchGroups.map((group) => (
              <section key={group} className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground">
                  {group}
                </h2>
                <div className="overflow-hidden rounded-2xl border bg-card divide-y divide-border/60">
                  {searchResults
                    .filter((entry) => entry.group === group)
                    .map((entry) =>
                      trackedLink(
                        entry,
                        'flex min-h-15 items-center gap-3 px-4 py-3 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      ),
                    )}
                </div>
              </section>
            ))
          )}
        </div>
      ) : (
        <>
          <section
            aria-labelledby="home-status"
            className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6"
          >
            <div className="flex items-start gap-4">
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-2xl ${diagnostics.isPending || diagnostics.isError ? 'bg-muted text-muted-foreground' : warnings.length ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary'}`}
              >
                {diagnostics.isPending ? (
                  <Activity className="size-5" />
                ) : diagnostics.isError ? (
                  <CircleHelp className="size-5" />
                ) : warnings.length ? (
                  <AlertTriangle className="size-5" />
                ) : (
                  <CheckCircle2 className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="home-status" className="text-lg font-semibold">
                  {diagnostics.isPending
                    ? 'Checking your setup…'
                    : diagnostics.isError
                      ? 'Could not check your setup'
                      : warnings.length
                        ? `${warnings.length} ${warnings.length === 1 ? 'issue needs' : 'issues need'} a look`
                        : diagnostics.data?.warming_up
                          ? 'Your home is starting up'
                          : reviewCount > 0
                            ? 'No warnings need attention'
                            : 'Your setup looks good'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {diagnostics.isPending
                    ? 'Looking for broken links and other configuration issues.'
                    : diagnostics.isError
                      ? 'The server did not return configuration checks. Try again to see current issues.'
                      : diagnostics.data?.warming_up
                        ? 'Some checks will be available after devices finish starting.'
                        : warnings.length
                          ? `${warnings[0].name}: ${warnings[0].message}`
                          : reviewCount > 0
                            ? `${reviewCount} ${reviewCount === 1 ? 'item is' : 'items are'} available for review. Automation behavior and physical device delivery are checked separately.`
                            : 'No problems found by these checks. Automation behavior and physical device delivery are checked separately.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    asChild
                    variant={warnings.length ? 'default' : 'outline'}
                    size="sm"
                  >
                    <Link
                      to={
                        warnings.length
                          ? configItemHref(
                              warnings[0].entity,
                              warnings[0].entity_id,
                            )
                          : '/config/diagnostics'
                      }
                    >
                      {warnings.length ? 'Review issue' : 'View checks'}
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  {diagnostics.isError && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void diagnostics.refetch()}
                    >
                      Try again
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/config/routine-history">Automation history</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {setupStep && !setupDismissed && (
            <section className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Wand2 className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-primary">Next step</p>
                <Link
                  to={setupStep.href}
                  className="mt-0.5 inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {setupStep.label}
                  <ArrowRight className="size-4" />
                </Link>
                <p className="text-xs leading-5 text-muted-foreground">
                  {setupStep.detail}
                </p>
              </div>
              <button
                type="button"
                aria-label="Dismiss setup suggestion"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                onClick={() => {
                  window.localStorage.setItem(setupDismissalKey, '1');
                  setSetupDismissed(true);
                }}
              >
                <X className="size-4" />
              </button>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <h2 className="text-lg font-semibold">
                What would you like to do?
              </h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tasks.map((task) => {
                const Icon = task.icon;
                return (
                  <Link
                    key={task.key}
                    to={task.href}
                    onClick={() => recordRecent(`action:${task.key}`)}
                    className="group flex min-h-16 items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm transition hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1 text-sm font-medium">
                      {task.label}
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground/60" />
                  </Link>
                );
              })}
            </div>
          </section>

          {recentEntries.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Recently visited</h2>
              <div className="flex flex-wrap gap-2">
                {recentEntries.map((entry) => (
                  <Link
                    key={entry.key}
                    to={entry.href}
                    onClick={() => recordRecent(entry.key)}
                    className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    {entry.label}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Browse settings</h2>
              <p className="text-sm text-muted-foreground">
                Choose an area to see its details.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sectionGroups.map((group) => (
                <details
                  key={group}
                  className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold transition hover:bg-accent [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">{group}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground">
                      {
                        configSections.filter(
                          (section) => section.group === group,
                        ).length
                      }{' '}
                      areas
                      <ChevronRight
                        className="size-4 transition-transform group-open:rotate-90"
                        aria-hidden
                      />
                    </span>
                  </summary>
                  <div className="divide-y divide-border/50">
                    {configSections
                      .filter((section) => section.group === group)
                      .map((section) =>
                        trackedLink(
                          {
                            key: `nav:${section.href}`,
                            label: section.label,
                            description: section.description,
                            href: section.href,
                            group,
                          },
                          'flex items-center gap-3 px-4 py-2.5 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        ),
                      )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
