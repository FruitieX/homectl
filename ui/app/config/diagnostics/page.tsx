import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import type { ConfigDiagnostics } from '@/bindings/ConfigDiagnostics';
import type { ConfigDiagnostic } from '@/bindings/ConfigDiagnostic';
import { useAppConfig } from '@/hooks/appConfig';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ConfigPageHeader } from '../page-header';

const sections = { group: 'groups', scene: 'scenes', device: 'devices' };
const labels = { group: 'group', scene: 'scene', device: 'device' };

function Issue({ issue }: { issue: ConfigDiagnostic }) {
  const Icon = issue.severity === 'warning' ? AlertTriangle : Info;
  return (
    <article className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <Icon
        aria-hidden
        className={`mt-1 size-5 shrink-0 ${issue.severity === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="break-words font-semibold">{issue.name}</h2>
          <span className="text-xs capitalize text-muted-foreground">
            {issue.entity}
          </span>
        </div>
        <p className="break-words text-sm">{issue.message}</p>
        <p className="text-sm text-muted-foreground">{issue.suggestion}</p>
        <Button asChild size="sm" variant="outline">
          <Link
            to={`/config/${sections[issue.entity]}?q=${encodeURIComponent(issue.entity_id)}`}
          >
            Review {labels[issue.entity]}
          </Link>
        </Button>
      </div>
    </article>
  );
}

export default function DiagnosticsPage() {
  const { apiEndpoint } = useAppConfig();
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<'all' | 'warning' | 'info'>(
    'warning',
  );
  const query = useQuery({
    queryKey: ['config-diagnostics', apiEndpoint],
    queryFn: async (): Promise<ConfigDiagnostics> => {
      const response = await fetch(`${apiEndpoint}/api/v1/config/diagnostics`);
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
    retry: false,
  });
  const issues = query.data?.issues ?? [];
  const visible = issues.filter(
    (issue) =>
      (severity === 'all' || issue.severity === severity) &&
      `${issue.name} ${issue.entity_id} ${issue.message}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const warnings = issues.filter(
    (issue) => issue.severity === 'warning',
  ).length;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <ConfigPageHeader
        title="Configuration check"
        description="Review references, scene targets, and device assignments. These checks do not change your home."
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
              checks will be included after startup; refresh then.
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
            <Input
              aria-label="Search configuration checks"
              placeholder="Search names or references…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {issues.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
              <div>
                <h2 className="font-semibold">
                  No issues found by these checks
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Checks cover groups, scene references, and current device
                  assignments. Scripts and routine behavior are not evaluated.
                </p>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {severity === 'warning' && !search
                ? 'No warnings found. Informational items are available under For review.'
                : 'No checks match this filter.'}
            </p>
          ) : (
            <div className="space-y-3">
              {visible.map((issue) => (
                <Issue key={issue.id} issue={issue} />
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
