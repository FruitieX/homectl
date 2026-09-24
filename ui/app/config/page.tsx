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
  Plus,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
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

/**
 * The four places a person looks for their configuration. Everything in
 * Settings belongs to one of them, and each one keeps its own creation
 * actions so the home screen does not need a wall of shortcuts.
 */
const homeDestinations = [
  {
    key: 'rooms-and-devices',
    label: 'Rooms and devices',
    description: 'What you control, where it is, and how it is laid out.',
    hrefs: ['/config/groups', '/config/devices', '/config/floorplan'],
    actions: [
      { label: 'Add a room', href: '/config/groups/new' },
      { label: 'Rename or move a device', href: '/config/devices' },
    ],
  },
  {
    key: 'scenes-and-routines',
    label: 'Scenes and routines',
    description: 'What happens, when it happens, and what it last did.',
    hrefs: [
      '/config/scenes',
      '/config/routines',
      '/config/helpers',
      '/config/sources',
      '/config/routine-history',
    ],
    actions: [
      { label: 'Create a scene', href: '/config/scenes/new' },
      { label: 'Create a routine', href: '/config/routines/new' },
      { label: 'See automation history', href: '/config/routine-history' },
    ],
  },
  {
    key: 'connections-and-data',
    label: 'Connections and data',
    description: 'Where readings come from and how your setup is kept.',
    hrefs: ['/config/integrations', '/config/logs', '/config/import-export'],
    actions: [
      { label: 'Add a connection', href: '/config/integrations?new=1' },
      { label: 'Export a backup', href: '/config/import-export' },
    ],
  },
  {
    key: 'app-and-system',
    label: 'App and system',
    description: 'How the app looks, and checks on this server.',
    hrefs: ['/config/settings', '/config/diagnostics'],
    actions: [{ label: 'Check for problems', href: '/config/diagnostics' }],
  },
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

type DiagnosticIssue = {
  entity: string;
  entity_id: string;
  name: string;
  code: string;
  message: string;
  suggestion: string;
};

/**
 * A short, human consequence for one issue: what will not happen, without raw
 * device keys or a truncated sentence. Counts come from the same issue list.
 */
function describeIssueConsequence(
  issue: DiagnosticIssue,
  all: DiagnosticIssue[],
): string {
  const sameScene = all.filter(
    (other) =>
      other.entity === issue.entity && other.entity_id === issue.entity_id,
  ).length;
  switch (issue.code) {
    case 'missing_scene_device':
    case 'missing_scene_group':
      return sameScene > 1
        ? `${sameScene} targets will be skipped when you activate it.`
        : 'A target will be skipped when you activate it.';
    case 'missing_group_device':
      return sameScene > 1
        ? `${sameScene} saved device references are missing.`
        : 'A saved device reference is missing.';
    case 'empty_group':
      return 'This room has no devices or nested rooms.';
    case 'unavailable_group':
      return 'This room has a member that is not available right now.';
    default:
      return issue.message.replace(/\s+/g, ' ').trim();
  }
}

export default function ConfigHomePage() {
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
        group:
          homeDestinations.find((destination) =>
            (destination.hrefs as readonly string[]).includes(section.href),
          )?.label ?? 'Settings',
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
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      <div className="space-y-4">
        <ConfigPageHeader
          backTo={null}
          title="Set up your home"
          description="Find anything, or start something new."
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4" aria-hidden />
                  Create
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {tasks.map((task) => {
                  const Icon = task.icon;
                  return (
                    <DropdownMenuItem key={task.key} asChild>
                      <Link
                        to={task.href}
                        onClick={() => recordRecent(`action:${task.key}`)}
                      >
                        <Icon className="size-4" aria-hidden />
                        {task.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search settings and devices"
            aria-label="Search settings and devices"
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
                Try a device name, room, or task.
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
          {/* Is anything wrong? One line, one action. */}
          <section
            aria-labelledby="home-status"
            className="rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-xl ${diagnostics.isPending || diagnostics.isError ? 'bg-muted text-muted-foreground' : warnings.length ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary'}`}
              >
                {diagnostics.isPending ? (
                  <Activity className="size-4" />
                ) : diagnostics.isError ? (
                  <CircleHelp className="size-4" />
                ) : warnings.length ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="home-status" className="text-sm font-semibold">
                  {diagnostics.isPending ? (
                    'Checking your setup…'
                  ) : diagnostics.isError ? (
                    'Could not check your setup'
                  ) : warnings.length ? (
                    <Link
                      to="/config/diagnostics"
                      className="underline-offset-4 hover:underline"
                    >
                      {`${warnings.length} ${warnings.length === 1 ? 'issue needs' : 'issues need'} a look`}
                    </Link>
                  ) : diagnostics.data?.warming_up ? (
                    'Your home is starting up'
                  ) : reviewCount > 0 ? (
                    'No warnings need attention'
                  ) : (
                    'Your setup looks good'
                  )}
                </h2>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {diagnostics.isPending
                    ? 'Looking for broken links and other configuration issues.'
                    : diagnostics.isError
                      ? 'The server did not return configuration checks.'
                      : diagnostics.data?.warming_up
                        ? 'Some checks will be available after devices finish starting.'
                        : warnings.length
                          ? `${warnings[0].name} ${warnings[0].entity}: ${describeIssueConsequence(warnings[0], warnings)}`
                          : reviewCount > 0
                            ? `${reviewCount} ${reviewCount === 1 ? 'item is' : 'items are'} available for review.`
                            : 'No problems found by these checks.'}
                </p>
              </div>
              {diagnostics.isError ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void diagnostics.refetch()}
                >
                  Try again
                </Button>
              ) : (
                <Button
                  asChild
                  size="sm"
                  variant={warnings.length ? 'default' : 'outline'}
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
                    {warnings.length
                      ? `Review ${warnings[0].entity}`
                      : 'View checks'}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              )}
            </div>
          </section>

          {/* Where do I go? Four destinations, actions kept inside. */}
          <section aria-label="Settings areas" className="space-y-2">
            {homeDestinations.map((destination) => {
              const areas = configSections.filter((section) =>
                (destination.hrefs as readonly string[]).includes(section.href),
              );
              return (
                <details
                  key={destination.key}
                  className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-accent [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {destination.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {destination.description}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {areas.length} areas
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                  </summary>
                  <div className="divide-y divide-border/50 border-t border-border/60">
                    {areas.map((section) =>
                      trackedLink(
                        {
                          key: `nav:${section.href}`,
                          label: section.label,
                          description: section.description,
                          href: section.href,
                          group: destination.label,
                        },
                        'flex items-center gap-3 px-4 py-2.5 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      ),
                    )}
                    {destination.actions.map((action) => (
                      <Link
                        key={action.href + action.label}
                        to={action.href}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <Plus className="size-4 shrink-0" aria-hidden />
                        {action.label}
                      </Link>
                    ))}
                  </div>
                </details>
              );
            })}
          </section>

          {recentEntries.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground">
                Recently visited
              </h2>
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
        </>
      )}
    </div>
  );
}
