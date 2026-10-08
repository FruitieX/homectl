import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SensorHistoryEntry } from '@/bindings/SensorHistoryEntry';
import { useAppConfig } from '@/hooks/appConfig';
import { useDevicesState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { sensorValueLabel } from '@/lib/sensorHistory';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SensorHistoryPanel } from '@/ui/SensorHistoryPanel';
import { ConfigPageHeader } from '../page-header';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';

export default function SensorHistoryPage() {
  const { apiEndpoint } = useAppConfig();
  const devices = useDevicesState();
  const { data: overrides } = useDeviceDisplayNames();
  const names = Object.fromEntries(
    overrides.map((row) => [row.device_key, row.display_name]),
  );
  const [params, setParams] = useSearchParams();
  const sensor = params.get('sensor') ?? '';
  const [search, setSearch] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['sensor-activity', apiEndpoint, sensor],
    initialPageParam: undefined as number | undefined,
    refetchInterval: 10000,
    queryFn: async ({ pageParam, signal }) => {
      const p = new URLSearchParams();
      if (sensor) p.set('sensor', sensor);
      if (pageParam !== undefined) p.set('before', String(pageParam));
      const r = await fetch(
        `${apiEndpoint}/api/v1/config/sensor-history?${p}`,
        { signal },
      );
      if (!r.ok) throw Error('Sensor changes could not be loaded.');
      const b = await r.json();
      if (!Array.isArray(b.data)) throw Error('Invalid sensor history.');
      return b.data as SensorHistoryEntry[];
    },
    getNextPageParam: (page) =>
      page.length === 100 ? page.at(-1)?.id : undefined,
  });
  const entries = query.data?.pages.flat() ?? [];
  const label = (key: string) =>
    devices?.[key] ? getDeviceDisplayLabel(devices[key]!, names) : key;
  const knownKeys = Object.entries(devices ?? {})
    .filter(([, d]) => d && 'Sensor' in d.data)
    .map(([key]) => key);
  const keys = [
    ...new Set([
      ...knownKeys,
      ...entries.map((e) => e.source_key),
      ...(sensor ? [sensor] : []),
    ]),
  ];
  const filtered = entries.filter((e) =>
    `${label(e.source_key)} ${e.source_key} ${sensorValueLabel(e.value)}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="Sensor activity"
        description="Recorded value changes, newest first. The latest 100 changes per sensor field are kept across server restarts; unchanged reports do not add entries."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Refresh
          </Button>
        }
      />
      <ConfigSectionTabs />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
        <SearchablePicker
          value={sensor}
          options={[
            { value: '', label: 'All sensors' },
            ...keys.map((key) => ({
              value: key,
              label: label(key),
              detail: key,
            })),
          ]}
          onChange={(value) => setParams(value ? { sensor: value } : {})}
          ariaLabel="Filter by sensor"
          placeholder="All sensors"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search sensor changes"
          placeholder="Find a sensor or value…"
        />
      </div>
      {sensor && (
        <div className="max-w-3xl rounded-lg border border-border bg-card p-4">
          <SensorHistoryPanel deviceKey={sensor} showLink={false} />
        </div>
      )}
      {query.isError && (
        <div
          role="alert"
          className="flex items-center gap-3 text-sm text-destructive"
        >
          {query.error.message}
          {entries.length ? ' Showing previously loaded changes.' : ''}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading sensor changes…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="hidden grid-cols-[11rem_minmax(10rem,1fr)_minmax(0,2fr)] gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:grid">
            <span>Changed</span>
            <span>Sensor</span>
            <span>Value</span>
          </div>
          <ol className="divide-y divide-border">
            {filtered.map((e) => (
              <li
                key={e.id}
                className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[11rem_minmax(10rem,1fr)_minmax(0,2fr)] sm:gap-4"
              >
                <time
                  className="text-xs tabular-nums text-muted-foreground"
                  dateTime={new Date(e.changed_at_ms).toISOString()}
                >
                  {new Date(e.changed_at_ms).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </time>
                <Link
                  className="truncate text-primary hover:underline"
                  to={
                    '/config/sensor-history?sensor=' +
                    encodeURIComponent(e.source_key)
                  }
                >
                  {label(e.source_key)}
                </Link>
                <span className="break-words [overflow-wrap:anywhere]">
                  {sensorValueLabel(e.value)}
                </span>
              </li>
            ))}
          </ol>
          {!filtered.length && (
            <p className="p-4 text-sm text-muted-foreground">
              {search
                ? 'No matching changes in the loaded history.'
                : 'No recorded changes yet.'}
            </p>
          )}
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older changes'}
        </Button>
      )}
      <Link className="settings-link self-start" to="/config/devices">
        Device settings ↗
      </Link>
    </div>
  );
}
