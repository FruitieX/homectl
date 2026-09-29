import { useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import {
  useIntegrations,
  useIntegrationConfigSchemas,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigPageHeader } from '../page-header';
export default function IntegrationsPage() {
  const api = useIntegrations(),
    schemas = useIntegrationConfigSchemas(),
    catalog = useDevicesApi();
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    search = params.get('q') ?? '';
  useCreateDeepLink(
    useCallback(() => navigate('/config/integrations/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'integration' });
  const rows = api.data.filter((row) =>
    `${row.id} ${row.plugin}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Connections & services"
        description="Integrations that discover devices and provide values."
        actions={
          <Button asChild>
            <Link to="/config/integrations/new">
              <Plus className="size-4" />
              Add connection
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        value={search}
        totalCount={api.data.length}
        filteredCount={rows.length}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          if (value) next.set('q', value);
          else next.delete('q');
          setParams(next, { replace: true });
        }}
        placeholder="Search connections"
      />
      {api.error ? (
        <div role="alert" className="text-sm text-destructive">
          {api.error}
          <Button variant="outline" onClick={() => void api.refetch()}>
            Retry
          </Button>
        </div>
      ) : api.loading ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : !rows.length ? (
        <p className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
          {search
            ? 'No matching connections.'
            : 'Add a connection to discover devices.'}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((row) => (
            <Link
              key={row.id}
              to={configItemHref('integration', row.id)}
              className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/30"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${row.enabled ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                aria-label={row.enabled ? 'Enabled' : 'Disabled'}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.id}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {schemas.data.find((schema) => schema.plugin === row.plugin)
                    ?.name ?? row.plugin}{' '}
                  · {row.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                  {catalog.error
                    ? 'Device count unavailable'
                    : `${catalog.devices.filter((device) => device.integration_id === row.id).length} devices`}
                  {['cron', 'timer', 'circadian'].includes(row.plugin)
                    ? ' · Legacy'
                    : ''}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
