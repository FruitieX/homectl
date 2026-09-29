import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useGroupsState } from '@/hooks/useDevicesApi';
import { BulkCalibrationAssignment } from '@/ui/settings/CalibrationAssignment';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { getDeviceKey } from '@/lib/device';
import { canCalibrateDevice } from '@/lib/colorCalibration';
import { isDimmableDevice } from '@/lib/brightnessCalibration';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { ConfigPageHeader } from '../page-header';
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
  const selectionMode = query.get('calibration') === 'bulk';
  const [selected, setSelected] = useState<string[]>([]);
  useAssistantPageContext({ kind: 'device' });
  const search = query.get('q') ?? '',
    type = query.get('type') ?? 'all',
    integration = query.get('integration') ?? '',
    group = query.get('group') ?? '';
  const visible = catalog.devices
    .filter((device) => {
      const key = getDeviceKey(device);
      return (
        (type === 'all' || deviceType(device) === type) &&
        (query.get('attention') !== '1' ||
          health.data?.attention_device_keys.includes(key)) &&
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
  const eligible = (device: (typeof catalog.devices)[number]) =>
    canCalibrateDevice(device) || isDimmableDevice(device);
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Devices"
        description="Current state, connections and device settings."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              patchQuery('calibration', selectionMode ? '' : 'bulk')
            }
          >
            {selectionMode ? 'Close selection' : 'Select devices'}
          </Button>
        }
      />
      <ConfigListSearchBar
        value={search}
        onChange={(value) => patchQuery('q', value)}
        totalCount={catalog.devices.length}
        filteredCount={visible.length}
        placeholder="Search devices by name or ID"
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={query.get('attention') === '1'}
          onChange={(event) =>
            patchQuery('attention', event.target.checked ? '1' : '')
          }
        />
        Needs attention only
      </label>
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
      {query.get('attention') === '1' &&
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
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="settings-select max-w-full"
          aria-label="Device type"
          value={type}
          onChange={(event) => patchQuery('type', event.target.value)}
        >
          <option value="all">All devices</option>
          <option value="controllable">Lights & controls</option>
          <option value="sensor">Sensors</option>
          <option value="other">Other</option>
        </select>
        <select
          className="settings-select max-w-full"
          aria-label="Integration"
          value={integration}
          onChange={(event) => patchQuery('integration', event.target.value)}
        >
          <option value="">All integrations</option>
          {[...new Set(catalog.devices.map((device) => device.integration_id))]
            .sort()
            .map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
        </select>
        <select
          className="settings-select max-w-full"
          aria-label="Room or group"
          value={group}
          onChange={(event) => patchQuery('group', event.target.value)}
        >
          <option value="">All rooms & groups</option>
          {Object.entries(groups).map(([id, row]) => (
            <option key={id} value={id}>
              {row.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {visible.length} devices
        </span>
      </div>
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
                {selectionMode && (
                  <input
                    type="checkbox"
                    className="size-4"
                    aria-label={`Select ${catalog.label(device)}`}
                    disabled={!eligible(device)}
                    checked={selected.includes(key)}
                    onChange={(event) =>
                      setSelected((values) =>
                        event.target.checked
                          ? [...values, key]
                          : values.filter((value) => value !== key),
                      )
                    }
                  />
                )}
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
                  {health.data?.devices?.[key] && (
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
      {selectionMode && (
        <section
          className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-3 shadow-sm"
          aria-label="Bulk calibration"
        >
          <span className="text-xs font-medium">
            {selected.length} selected
            {selected.some(
              (key) => !visible.some((device) => getDeviceKey(device) === key),
            )
              ? ' · Includes hidden devices'
              : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSelected((values) => [
                ...new Set([
                  ...values,
                  ...visible.filter(eligible).map(getDeviceKey),
                ]),
              ])
            }
          >
            Select matching lights
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear
          </Button>
          <BulkCalibrationAssignment selected={selected} />
        </section>
      )}
    </div>
  );
}
