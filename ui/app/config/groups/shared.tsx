import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { StatePreview } from '@/ui/settings/StatePreview';
import { configItemHref } from '@/lib/configItemHref';
import { Link } from 'react-router-dom';
import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';

import { type Device } from '@/bindings/Device';
import { type Group, useDeviceDisplayNames } from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { getDeviceKey } from '@/lib/device';
import {
  getDeviceDisplayLabel,
  getDeviceDisplayLabelFromKey,
} from '@/lib/deviceLabel';
import { groupDeviceKey } from '@/lib/groupGraph';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

export type GroupDeviceRef = { integration_id: string; device_id: string };

/** Device labels and keys, resolved once per page. */
export function useDeviceLookups() {
  const { devices: allDevices, loading, error, refetch } = useDevicesApi();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();

  const deviceDisplayNameMap = useMemo(
    () =>
      Object.fromEntries(
        deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
      ),
    [deviceDisplayNames],
  );

  const devicesByKey = useMemo(
    () =>
      Object.fromEntries(
        allDevices.map((device) => [getDeviceKey(device), device]),
      ) as Record<string, Device>,
    [allDevices],
  );

  const labelFor = useCallback(
    (ref: GroupDeviceRef | string) => {
      const key = typeof ref === 'string' ? ref : groupDeviceKey(ref);
      const device = devicesByKey[key];
      if (device) {
        return getDeviceDisplayLabel(device, deviceDisplayNameMap);
      }
      const deviceId =
        typeof ref === 'string' ? (key.split('/').pop() ?? key) : ref.device_id;
      return getDeviceDisplayLabelFromKey(key, deviceId, deviceDisplayNameMap);
    },
    [deviceDisplayNameMap, devicesByKey],
  );

  const options = useMemo(
    () =>
      allDevices
        .map((device) => ({
          key: getDeviceKey(device),
          label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
          device,
        }))
        .sort(
          (a, b) =>
            a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
        ),
    [allDevices, deviceDisplayNameMap],
  );

  const presentKeys = useMemo(
    () => new Set(allDevices.map((device) => getDeviceKey(device))),
    [allDevices],
  );

  return {
    allDevices,
    loading,
    error,
    refetch,
    devicesByKey,
    deviceDisplayNameMap,
    labelFor,
    options,
    presentKeys,
  };
}

/**
 * Compact rows for the currently selected devices. Unresolved members stay
 * visible with repair actions instead of silently disappearing.
 */
export function SelectedDeviceRows({
  devices,
  devicesByKey,
  catalogReady = true,
  onChange,
  labelFor,
  presentKeys,
  replaceTarget,
  onStartReplace,
  onCancelReplace,
}: {
  devices: readonly GroupDeviceRef[];
  devicesByKey: Record<string, Device>;
  catalogReady?: boolean;
  onChange: (devices: GroupDeviceRef[]) => void;
  labelFor: (ref: GroupDeviceRef | string) => string;
  presentKeys: ReadonlySet<string>;
  replaceTarget?: string | null;
  onStartReplace?: (key: string) => void;
  onCancelReplace?: () => void;
}) {
  const { advanced } = useSettingsPreferences();
  if (devices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No direct devices yet.</p>
    );
  }

  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
      {devices.map((device) => {
        const key = groupDeviceKey(device);
        const missing = catalogReady && !presentKeys.has(key);
        const replacing = replaceTarget === key;
        const data = devicesByKey[key]?.data;
        const state =
          data && 'Controllable' in data ? data.Controllable.state : undefined;
        return (
          <li
            key={key}
            data-target-key={key}
            className="flex flex-wrap items-center gap-3 px-3 py-2"
          >
            {state && <StatePreview {...state} source="Requested" />}
            <div className={`min-w-0 flex-1 ${missing ? 'basis-[140px]' : ''}`}>
              <Link
                className={`block text-sm hover:underline ${missing ? 'break-words' : 'truncate'}`}
                to={configItemHref('device', key)}
              >
                {labelFor(device)}
              </Link>
              {(advanced || missing) && (
                <p
                  className={`text-xs text-muted-foreground ${missing ? 'break-all' : 'truncate'}`}
                >
                  {key}
                </p>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {missing ? (
                <Badge variant="warning" className="shrink-0 gap-1">
                  <AlertTriangle aria-hidden className="size-3" />
                  Missing
                </Badge>
              ) : null}
              {missing && onStartReplace ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    replacing ? onCancelReplace?.() : onStartReplace(key)
                  }
                >
                  {replacing ? 'Cancel' : 'Replace'}
                </Button>
              ) : null}
              {/* A labelled action rather than a bare ×, so it reads and is
                reachable the same way for everyone. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${labelFor(device)} from this group`}
                onClick={() =>
                  onChange(
                    devices.filter((entry) => groupDeviceKey(entry) !== key),
                  )
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Search-first device adder. Results are bounded and only listed as the user
 * types, so a 300-device home never renders hundreds of choices at once.
 */
export function DeviceAdder({
  options,
  selectedKeys,
  onAdd,
  onReplace,
  placeholder = 'Search devices by name, id, or integration',
}: {
  options: { key: string; label: string; device: Device }[];
  selectedKeys: ReadonlySet<string>;
  onAdd: (device: Device) => void;
  onReplace?: (device: Device) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (trimmed === '') return [];
    return options
      .filter(({ key, label, device }) =>
        `${label} ${device.name} ${device.id} ${device.integration_id} ${key}`
          .toLowerCase()
          .includes(trimmed),
      )
      .slice(0, 20);
  }, [options, trimmed]);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 border-0 bg-transparent px-0 focus-visible:ring-0"
        />
      </label>
      {trimmed === '' ? (
        <p className="text-xs text-muted-foreground">
          Type to search all {options.length} devices.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No devices match “{query}”.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {matches.map(({ key, label, device }) => {
            const selected = selectedKeys.has(key);
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {key}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selected && !onReplace}
                  onClick={() =>
                    selected && onReplace ? onReplace(device) : onAdd(device)
                  }
                >
                  <Plus aria-hidden />
                  {selected ? (onReplace ? 'Use here' : 'Added') : 'Add'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Selected linked rooms as compact rows. */
export function SelectedRoomRows({
  ids,
  groups,
  onChange,
}: {
  ids: readonly string[];
  groups: readonly Group[];
  onChange: (ids: string[]) => void;
}) {
  const { advanced } = useSettingsPreferences();
  if (ids.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No linked groups yet.</p>
    );
  }
  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
      {ids.map((id) => {
        const group = groups.find((entry) => entry.id === id);
        return (
          <li
            key={id}
            data-target-key={id}
            className="flex items-center gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <Link
                className="block truncate text-sm hover:underline"
                to={`/config/groups/${encodeURIComponent(id)}`}
              >
                {group?.name ?? id}
              </Link>
              {(advanced || !group) && (
                <p className="truncate text-xs text-muted-foreground">
                  {id}
                  {!group && ' · Missing group'}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove linked group ${group?.name ?? id}`}
              onClick={() => onChange(ids.filter((entry) => entry !== id))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
