import { Link } from 'react-router-dom';
import type { DeviceHealth } from '@/bindings/DeviceHealth';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';
export function healthLabel(health?: DeviceHealth): string {
  if (!health) return 'Health not available';
  return (
    (
      {
        healthy: 'No reporting issues',
        late: 'Report overdue',
        offline: 'Reported offline',
        waiting: 'Waiting for a fresh report',
        cached: 'Cached state only',
        unknown: 'No fresh report observed',
        ignored: 'Silence warnings ignored',
        disabled: 'Disabled',
        error: 'Computation error',
      } as Record<string, string>
    )[health.status] ?? health.status
  );
}
export function HealthBadge({ health }: { health?: DeviceHealth }) {
  return (
    <span
      className={`text-xs ${health?.issues.length ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
    >
      {healthLabel(health)}
    </span>
  );
}
export function HealthEvidence({ deviceKey }: { deviceKey: string }) {
  const query = useDeviceHealth(),
    health = query.data?.devices?.[deviceKey];
  if (query.isError)
    return (
      <div role="alert" className="text-xs">
        Device health is unavailable.{' '}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  if (!health)
    return (
      <p className="text-xs text-muted-foreground">
        {query.isLoading ? 'Checking reports…' : 'No report observations yet.'}
      </p>
    );
  const policy = health.effective_policy;
  return (
    <div className="space-y-3 text-xs">
      <HealthBadge health={health} />
      {health.issues.map((issue) => (
        <p key={issue.code} className="text-amber-700 dark:text-amber-400">
          {issue.message}
        </p>
      ))}
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Last fresh report</dt>
          <dd>
            {health.last_fresh_report_ms == null
              ? 'None observed this session'
              : new Date(health.last_fresh_report_ms).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Saved effective policy</dt>
          <dd>
            {policy.description}
            {policy.policy.mode === 'custom'
              ? ` · every ${policy.policy.expected_interval_seconds} seconds`
              : policy.policy.mode === 'ignore'
                ? ' · Ignore missing reports'
                : ''}
          </dd>
        </div>
        {health.expected_by_ms != null && (
          <div>
            <dt className="text-muted-foreground">
              Next report deadline, including grace
            </dt>
            <dd>{new Date(health.expected_by_ms).toLocaleString()}</dd>
          </div>
        )}
        {health.last_cached_report_ms != null && (
          <div>
            <dt className="text-muted-foreground">
              Last cached receipt (not a heartbeat)
            </dt>
            <dd>{new Date(health.last_cached_report_ms).toLocaleString()}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-3">
        <Link
          className="text-primary underline"
          to={`/config/logs?device=${encodeURIComponent(deviceKey)}`}
        >
          Related logs
        </Link>
        <Link
          className="text-primary underline"
          to={configItemHref(
            health.integration_id === 'computed' ? 'source' : 'integration',
            health.integration_id === 'computed'
              ? deviceKey.slice('computed/'.length)
              : health.integration_id,
          )}
        >
          Reporting source
        </Link>
      </div>
    </div>
  );
}
export function AttentionDevices({ integration }: { integration?: string }) {
  const query = useDeviceHealth();
  const keys = (query.data?.attention_device_keys ?? []).filter(
    (key) => !integration || key.startsWith(integration + '/'),
  );
  const includesSources = keys.some((key) => key.startsWith('computed/'));
  const itemKind = includesSources
    ? keys.every((key) => key.startsWith('computed/'))
      ? 'source'
      : 'item'
    : 'device';
  if (query.isError)
    return (
      <p role="alert" className="text-sm">
        Device health checks are unavailable.{' '}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </p>
    );
  if (query.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Checking device reports…</p>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {keys.length
            ? `${keys.length} ${itemKind}${keys.length === 1 ? ' needs' : 's need'} attention`
            : 'No device warnings'}
        </h2>
        <Link
          className="text-xs text-primary underline"
          to={
            includesSources
              ? '/config/diagnostics'
              : `/config/devices?attention=1${integration ? `&integration=${encodeURIComponent(integration)}` : ''}`
          }
        >
          {includesSources ? 'View issues' : 'View devices'}
        </Link>
      </div>
      {query.data?.warming_up && (
        <p className="text-xs text-muted-foreground">
          Starting up. Missing-report warnings wait for the observation grace
          period.
        </p>
      )}
      <div className="divide-y divide-border">
        {keys.slice(0, 5).map((key) => {
          const health = query.data?.devices?.[key];
          return (
            <Link
              key={key}
              className="flex items-start gap-3 py-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={
                health
                  ? health.integration_id === 'computed'
                    ? configItemHref('source', key.slice('computed/'.length))
                    : configItemHref('device', key)
                  : `/config/diagnostics?q=${encodeURIComponent(key)}`
              }
            >
              <span className="min-w-0">
                <strong className="block text-sm">{health?.name ?? key}</strong>
                <span className="block text-xs text-muted-foreground">
                  {health?.issues[0]?.message ??
                    'A configuration reference needs repair. Open diagnostics to review it.'}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
