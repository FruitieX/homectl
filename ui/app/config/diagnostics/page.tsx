import { Link, useSearchParams } from 'react-router-dom';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import type { ConfigDiagnostics } from '@/bindings/ConfigDiagnostics';
import type { ConfigDiagnostic } from '@/bindings/ConfigDiagnostic';
import { useAppConfig } from '@/hooks/appConfig';
import { useSearchParamState } from '@/hooks/useDeepLink';
import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ConfigPageHeader } from '../page-header';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';

const labels = {
  group: 'room',
  scene: 'scene',
  device: 'device',
  source: 'source',
};

function Issue({
  issue,
  advanced,
}: {
  issue: ConfigDiagnostic;
  advanced: boolean;
}) {
  const Icon = issue.severity === 'warning' ? AlertTriangle : Info;
  return (
    <article className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0">
      <Icon
        aria-hidden
        className={`mt-0.5 size-4 shrink-0 ${issue.severity === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="break-words text-sm font-medium">{issue.name}</h2>
          <span className="text-xs text-muted-foreground">
            {labels[issue.entity] ?? issue.entity}
          </span>
        </div>
        <p className="break-words text-sm">{issue.message}</p>
        <p className="break-words text-xs text-muted-foreground">
          {issue.suggestion}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Link
            className="settings-link"
            to={configItemHref(issue.entity, issue.entity_id)}
          >
            Open {labels[issue.entity] ?? issue.entity}
          </Link>
          {(issue.entity === 'device' || issue.entity === 'source') && (
            <Link
              className="settings-link"
              to={`/config/logs?device=${encodeURIComponent(issue.entity === 'source' ? `computed/${issue.entity_id}` : issue.entity_id)}`}
            >
              Related logs
            </Link>
          )}
          {advanced && (
            <span className="break-all font-mono text-[11px] text-muted-foreground">
              {issue.entity_id} · {issue.code}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export default function DiagnosticsPage() {
  const { apiEndpoint } = useAppConfig();
  const { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useSearchParamState();
  const severity = ['all', 'warning', 'info'].includes(
    params.get('severity') ?? '',
  )
    ? params.get('severity')!
    : search
      ? 'all'
      : 'warning';
  const setSeverity = (value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('severity', value);
        return next;
      },
      { replace: true },
    );
  const query = useQuery({
    queryKey: ['config-diagnostics', apiEndpoint],
    queryFn: async ({ signal }): Promise<ConfigDiagnostics> => {
      const response = await fetch(`${apiEndpoint}/api/v1/config/diagnostics`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'Configuration checks need the updated backend.'
            : 'Could not load configuration checks.',
        );
      const result = await response.json();
      if (!result.success || !result.data)
        throw new Error(result.error || 'Could not load configuration checks.');
      return result.data;
    },
    staleTime: 0,
    refetchInterval: 5000,
    retry: false,
  });
  const issues = query.data?.issues ?? [];
  const visible = issues.filter(
    (issue) =>
      (severity === 'all' || issue.severity === severity) &&
      `${issue.name} ${issue.entity_id} ${issue.message} ${(issue.device_keys ?? []).join(' ')}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const warnings = issues.filter(
    (issue) => issue.severity === 'warning',
  ).length;
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="Check for problems"
        description="See what is affected, why it needs attention, and where to fix it. Checks do not change your home."
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />
      <ConfigSectionTabs />
      {query.isPending ? (
        <p role="status">Checking configuration…</p>
      ) : query.isError ? (
        <p role="alert" className="rounded-xl border border-destructive p-4">
          {query.error.message}
        </p>
      ) : (
        <>
          {query.data.warming_up && (
            <p
              role="status"
              className="rounded-xl border border-border p-4 text-sm"
            >
              Devices are still starting up. Availability and active-scene
              checks update automatically after startup.
            </p>
          )}
          <div className="flex flex-wrap gap-2" aria-label="Filter checks">
            {(['all', 'warning', 'info'] as const).map((value) => (
              <Button
                key={value}
                variant={severity === value ? 'secondary' : 'ghost'}
                aria-pressed={severity === value}
                onClick={() => setSeverity(value)}
              >
                {value === 'all'
                  ? `All (${issues.length})`
                  : value === 'warning'
                    ? `Warnings (${warnings})`
                    : `For review (${issues.length - warnings})`}
              </Button>
            ))}
          </div>
          {issues.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Search configuration checks"
                placeholder="Search names or references…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="max-w-sm"
              />
              {search ? (
                <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                  Clear
                </Button>
              ) : null}
            </div>
          )}
          {issues.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
              <div>
                <h2 className="font-semibold">
                  No issues found by these checks
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Checks cover groups, scene references, current assignments and
                  device/source health. These checks do not execute scripts or
                  routines.
                </p>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              title="No checks match this filter"
              description={
                severity === 'warning' && !search
                  ? 'No warnings found. Informational items are available under For review.'
                  : 'Adjust the search or severity filter to see more checks.'
              }
              action={
                search || severity !== 'all' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setParams(
                        (previous) => {
                          const next = new URLSearchParams(previous);
                          next.delete('q');
                          next.set('severity', 'all');
                          return next;
                        },
                        { replace: true },
                      );
                    }}
                  >
                    Show all checks
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {visible.map((issue) => (
                <Issue key={issue.id} issue={issue} advanced={advanced} />
              ))}
            </div>
          )}
          {issues.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Scripts and routine behavior are not evaluated. “For review” items
              may be intentional.
            </p>
          )}
        </>
      )}
    </div>
  );
}
