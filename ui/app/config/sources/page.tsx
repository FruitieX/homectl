import { useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { useSources } from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { matchesConfigSearch } from '@/lib/configSearch';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { StatePreview } from '@/ui/settings/StatePreview';
import { ConfigPageHeader } from '../page-header';
import { computationLabel } from './shared';
export default function SourcesConfigPage() {
  const api = useSources(),
    health = useDeviceHealth(),
    devices = useDevicesState(),
    { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    query = params.get('q') ?? '';
  useCreateDeepLink(
    useCallback(() => navigate('/config/sources/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'computed_source' });
  const visible = api.data.filter((row) =>
    matchesConfigSearch(
      query,
      row.name,
      row.id,
      computationLabel(row.compute),
      ...(row.aliases ?? []),
    ),
  );
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Computed sources"
        description="Light profiles that change with time and can be followed by scenes."
        actions={
          <Button asChild>
            <Link to="/config/sources/new">
              <Plus className="size-4" />
              Add source
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        value={query}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          if (value) next.set('q', value);
          else next.delete('q');
          setParams(next, { replace: true });
        }}
        totalCount={api.data.length}
        filteredCount={visible.length}
        placeholder="Search computed sources"
      />
      {health.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          Source health is unavailable.
          <Button
            variant="outline"
            size="sm"
            onClick={() => void health.refetch()}
          >
            Retry health
          </Button>
        </div>
      )}
      {api.error ? (
        <div role="alert">
          {api.error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void api.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : api.loading ? (
        <Skeleton className="h-40" />
      ) : !visible.length ? (
        <EmptyState
          title={
            api.data.length ? 'No matching sources' : 'No computed sources yet'
          }
          description="Use Add source to create a light profile."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {visible.map((row) => {
            const data = devices?.[`computed/${row.id}`]?.data;
            const profile =
              data && 'Sensor' in data && 'color' in data.Sensor
                ? data.Sensor
                : null;
            return (
              <Link
                key={row.id}
                to={configItemHref('source', row.id)}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <StatePreview
                  color={profile?.color}
                  brightness={profile?.brightness}
                  power={profile?.power}
                  certainty={profile ? 'known' : 'unresolved'}
                />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{row.name}</strong>
                  <span className="text-xs text-muted-foreground">
                    {computationLabel(row.compute)} ·{' '}
                    {row.enabled ? 'Enabled' : 'Disabled'}
                    {advanced ? ` · ${row.id}` : ''}
                  </span>
                  {health.data?.devices?.[`computed/${row.id}`]?.issues.map(
                    (issue) => (
                      <p
                        key={issue.code}
                        className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                      >
                        {issue.message}
                      </p>
                    ),
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
