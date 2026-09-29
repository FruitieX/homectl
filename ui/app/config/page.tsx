import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ConfigDiagnostics } from '@/bindings/ConfigDiagnostics';
import { useAppConfig } from '@/hooks/appConfig';
import { useDevicesState } from '@/hooks/websocket';
import {
  useGroups,
  useScenes,
  useHelpers,
  useIntegrations,
  useRoutines,
  readApiResponse,
} from '@/hooks/useConfig';
import { useRecents, useRecordRecent } from '@/hooks/preferences';
import { configItemHref } from '@/lib/configItemHref';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { AttentionDevices } from '@/ui/settings/HealthStatus';
import { configSections, matchesConfigSectionSearch } from './sections';
import { ConfigPageHeader } from './page-header';

export default function ConfigHomePage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const { apiEndpoint } = useAppConfig();
  const devices = useDevicesState();
  const groups = useGroups();
  const scenes = useScenes();
  const routines = useRoutines();
  const helpers = useHelpers();
  const integrations = useIntegrations();
  const { recents } = useRecents();
  const recordRecent = useRecordRecent();
  const diagnostics = useQuery({
    queryKey: ['config-diagnostics', apiEndpoint],
    queryFn: async () => {
      const response = await fetch(`${apiEndpoint}/api/v1/config/diagnostics`);
      return (
        await readApiResponse<ConfigDiagnostics>(
          response,
          'Could not check configuration',
        )
      ).data;
    },
    refetchInterval: 30000,
  });
  const entities = useMemo(
    () => [
      ...Object.entries(devices ?? {}).flatMap(([id, device]) =>
        device
          ? [{ kind: 'device', id, name: getDeviceDisplayLabel(device) }]
          : [],
      ),
      ...groups.data.map((row) => ({
        kind: 'group',
        id: row.id,
        name: row.name,
      })),
      ...scenes.data.map((row) => ({
        kind: 'scene',
        id: row.id,
        name: row.name,
      })),
      ...routines.data.map((row) => ({
        kind: 'routine',
        id: row.id,
        name: row.name,
      })),
      ...helpers.data.map((row) => ({
        kind: 'helper',
        id: row.id,
        name: row.name ?? row.id,
      })),
      ...integrations.data.map((row) => ({
        kind: 'integration',
        id: row.id,
        name: row.id,
      })),
    ],
    [
      devices,
      groups.data,
      scenes.data,
      routines.data,
      helpers.data,
      integrations.data,
    ],
  );
  const counts: Record<string, number | undefined> = {
    '/config/groups': groups.loading ? undefined : groups.data.length,
    '/config/devices': devices ? Object.keys(devices).length : undefined,
    '/config/scenes': scenes.loading ? undefined : scenes.data.length,
    '/config/routines': routines.loading ? undefined : routines.data.length,
    '/config/helpers': helpers.loading ? undefined : helpers.data.length,
    '/config/integrations': integrations.loading
      ? undefined
      : integrations.data.length,
  };
  const normalized = search.toLowerCase().trim();
  const results = normalized
    ? entities
        .filter((row) =>
          `${row.name} ${row.id} ${row.kind}`
            .toLowerCase()
            .includes(normalized),
        )
        .slice(0, 40)
    : [];
  const recent = recents
    .map((key) => entities.find((row) => `${row.kind}:${row.id}` === key))
    .filter((row) => row !== undefined)
    .slice(0, 5);
  const issues = (diagnostics.data?.issues ?? []).filter(
    (issue) =>
      !['missing_report', 'offline', 'source_error'].includes(issue.code),
  );
  const sectionGroups = [
    'Your home',
    'Automations',
    'Appearance',
    'Maintenance',
  ] as const;
  return (
    <div className="mx-auto grid max-w-[1600px] gap-5">
      <ConfigPageHeader
        title="Settings"
        description="Configure your home and see what needs attention."
      />
      <label className="relative block max-w-xl">
        <Search
          aria-hidden
          className="absolute left-3 top-3 size-4 text-muted-foreground"
        />
        <Input
          className="pl-9"
          value={search}
          aria-label="Search settings and configuration"
          placeholder="Find a setting, device, scene, or routine…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {!normalized && (
        <>
          <SettingsSection title="Device health">
            <AttentionDevices />
          </SettingsSection>
          {diagnostics.isError ? (
            <div className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
              <span className="flex-1">
                Configuration checks are unavailable.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void diagnostics.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : (
            issues.length > 0 && (
              <SettingsSection
                title={`${issues.length} configuration ${issues.length === 1 ? 'item needs' : 'items need'} attention`}
                actions={
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/config/diagnostics">
                      View all
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                }
              >
                {diagnostics.data?.warming_up && (
                  <p className="text-xs text-muted-foreground">
                    Starting up. Device availability is still settling.
                  </p>
                )}
                <ul className="divide-y divide-border">
                  {issues.slice(0, 4).map((issue) => (
                    <li key={issue.id}>
                      <Link
                        to={configItemHref(issue.entity, issue.entity_id)}
                        className="flex min-h-12 items-start gap-3 py-3"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                        <span className="min-w-0 flex-1">
                          <strong className="text-sm font-medium">
                            {issue.name || issue.entity_id}
                          </strong>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {issue.message}
                          </span>
                        </span>
                        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </SettingsSection>
            )
          )}
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="text-muted-foreground">Recent</span>
              {recent.map((row) => (
                <Link
                  key={`${row.kind}/${row.id}`}
                  className="underline underline-offset-4"
                  to={configItemHref(row.kind, row.id)}
                >
                  {row.name}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {sectionGroups.map((group) => {
          const sections = configSections.filter(
            (section) =>
              section.group === group &&
              matchesConfigSectionSearch(section, search),
          );
          if (!sections.length) return null;
          return (
            <SettingsSection key={group} title={group}>
              <div className="divide-y divide-border">
                {sections.map((section) => (
                  <Link
                    key={section.href}
                    to={section.href}
                    className="flex items-center gap-4 rounded-sm py-3 first:pt-0 last:pb-0 hover:text-primary"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-medium">
                        {section.label}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {section.description}
                      </span>
                    </span>
                    {counts[section.href] !== undefined && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {counts[section.href]}
                      </span>
                    )}
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </SettingsSection>
          );
        })}
      </div>
      {normalized && (
        <SettingsSection title="Matching configuration">
          <ul className="divide-y divide-border">
            {results.map((row) => (
              <li key={`${row.kind}:${row.id}`}>
                <Link
                  className="flex min-h-12 items-center justify-between gap-3 py-2"
                  to={configItemHref(row.kind, row.id)}
                  onClick={() => recordRecent(`${row.kind}:${row.id}`)}
                >
                  <span className="truncate">
                    {row.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.kind}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
          {!results.length && (
            <p className="text-sm text-muted-foreground">No matching items.</p>
          )}
          {results.length === 40 && (
            <p className="text-xs text-muted-foreground">
              Showing 40 matches. Refine your search to find more.
            </p>
          )}
        </SettingsSection>
      )}
    </div>
  );
}
