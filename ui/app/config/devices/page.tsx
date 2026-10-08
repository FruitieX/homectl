import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useGroupsState } from '@/hooks/useDevicesApi';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { getDeviceKey } from '@/lib/device';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { ConfigPageHeader } from '../page-header';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';
import {
  DeviceStatePreview,
  deviceSummary,
  deviceType,
  useSettingsDevices,
} from './shared';
import DeviceEditor from './detail';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { HealthBadge } from '@/ui/settings/HealthStatus';
export default function DevicesPage() {
  const params = useParams(),
    [query] = useSearchParams();
  const key = params['*'] || query.get('key') || query.get('device');
  return key ? <DeviceEditor key={key} deviceKey={key} /> : <DeviceList />;
}
function DeviceList() {
  const health = useDeviceHealth();
  const catalog = useSettingsDevices(),
    groups = useGroupsState();
  const { advanced } = useSettingsPreferences();
  const [query, setQuery] = useSearchParams();
  const [limit, setLimit] = useState(50);
  useAssistantPageContext({ kind: 'device' });
  const search = query.get('q') ?? '',
    type = query.get('type') ?? 'all',
    integration = query.get('integration') ?? '',
    group = query.get('group') ?? '',
    attentionOnly = query.get('attention') === '1';
  // Only devices that are listed here count; missing references are repaired
  // from diagnostics, which the notice below links to.
  const attentionCount = catalog.devices.filter((device) =>
    health.data?.attention_device_keys.includes(getDeviceKey(device)),
  ).length;
  const visible = catalog.devices
    .filter((device) => {
      const key = getDeviceKey(device);
      return (
        (type === 'all' || deviceType(device) === type) &&
        (!attentionOnly || health.data?.attention_device_keys.includes(key)) &&
        (!integration || device.integration_id === integration) &&
        (!group || groups[group]?.device_keys.includes(key)) &&
        `${catalog.label(device)} ${key}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())
      );
    })
    .sort((a, b) =>
      catalog
        .label(a)
        .localeCompare(catalog.label(b), undefined, { numeric: true }),
    );
  const patchQuery = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    setQuery(next, { replace: true });
    setLimit(50);
  };
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Devices"
        description="Current state, connections and device settings."
      />
      <ConfigSectionTabs />
      <ConfigListSearchBar
        value={search}
        onChange={(value) => patchQuery('q', value)}
        totalCount={catalog.devices.length}
        filteredCount={visible.length}
        placeholder="Search devices by name or ID"
      >
        <SettingsSelect
          className="w-full sm:w-48"
          aria-label="Device type"
          value={type}
          onValueChange={(value) => patchQuery('type', value)}
          options={[
            { value: 'all', label: 'All devices' },
            { value: 'controllable', label: 'Lights & controls' },
            { value: 'sensor', label: 'Sensors' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <div className="w-full sm:w-56">
          <SearchablePicker
            ariaLabel="Integration"
            value={integration}
            placeholder="All integrations"
            onChange={(value) => patchQuery('integration', value)}
            options={[
              ...new Set(
                catalog.devices.map((device) => device.integration_id),
              ),
            ]
              .sort()
              .map((id) => ({ value: id, label: id }))}
          />
        </div>
        <div className="w-full sm:w-56">
          <SearchablePicker
            ariaLabel="Room or group"
            value={group}
            placeholder="All rooms & groups"
            onChange={(value) => patchQuery('group', value)}
            options={Object.entries(groups).map(([id, row]) => ({
              value: id,
              label: row.name,
              detail: id,
            }))}
          />
        </div>
        <Button
          type="button"
          variant={attentionOnly ? 'secondary' : 'outline'}
          className="w-full sm:w-auto"
          aria-pressed={attentionOnly}
          onClick={() => patchQuery('attention', attentionOnly ? '' : '1')}
        >
          <AlertTriangle className="size-4" aria-hidden />
          Needs attention
          {attentionCount > 0 && ` (${attentionCount})`}
        </Button>
      </ConfigListSearchBar>
      {health.isError && (
        <p role="alert" className="text-xs">
          Device health is unavailable.{' '}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void health.refetch()}
          >
            Retry
          </Button>
        </p>
      )}
      {attentionOnly &&
        health.data?.attention_device_keys.some(
          (key) => !catalog.byKey[key],
        ) && (
          <p className="text-xs text-muted-foreground">
            Some referenced devices are unavailable.{' '}
            <Link className="text-primary underline" to="/config/diagnostics">
              Repair references in diagnostics
            </Link>
          </p>
        )}
      {catalog.error ? (
        <div
          role="alert"
          className="flex items-center gap-3 text-sm text-destructive"
        >
          {catalog.error.message}
          <Button variant="outline" onClick={() => void catalog.refetch()}>
            Retry
          </Button>
        </div>
      ) : catalog.loading ? (
        <p className="text-sm text-muted-foreground">Loading devices…</p>
      ) : !visible.length ? (
        <p className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
          {catalog.devices.length ? (
            'No devices match these filters.'
          ) : (
            <>
              Devices appear when an integration reports them.{' '}
              <Link className="settings-link" to="/config/integrations">
                Set up an integration
              </Link>
            </>
          )}
        </p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visible.slice(0, limit).map((device) => {
            const key = getDeviceKey(device),
              memberships = Object.entries(groups).filter(([, row]) =>
                row.device_keys.includes(key),
              );
            return (
              <div
                key={key}
                className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4"
              >
                <DeviceStatePreview device={device} />
                <Link
                  className="min-w-0 flex-1"
                  to={configItemHref('device', key)}
                >
                  <p className="truncate text-sm font-medium hover:underline">
                    {catalog.label(device)}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {deviceSummary(device)} ·{' '}
                    {memberships.map(([, row]) => row.name).join(', ') ||
                      device.integration_id}
                  </p>
                  {advanced && (
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {key}
                    </p>
                  )}
                  {/* Healthy rows stay quiet so the ones with issues stand out. */}
                  {!!health.data?.devices?.[key]?.issues.length && (
                    <HealthBadge health={health.data.devices[key]} />
                  )}
                </Link>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {deviceType(device) === 'sensor'
                    ? 'Sensor'
                    : 'Controllable' in device.data &&
                        device.data.Controllable.disabled
                      ? 'Disabled'
                      : ''}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}
      {visible.length > limit && (
        <Button
          variant="outline"
          onClick={() => setLimit((value) => value + 50)}
        >
          Show more ({visible.length - limit} remaining)
        </Button>
      )}
    </div>
  );
}
