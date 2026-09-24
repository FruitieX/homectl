import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, X } from 'lucide-react';

import { type Device } from '@/bindings/Device';
import { type Group, useDeviceDisplayNames } from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { getDeviceKey } from '@/lib/device';
import { BoundedList } from '@/ui/config/BoundedList';
import {
  getDeviceDisplayLabel,
  getDeviceDisplayLabelFromKey,
} from '@/lib/deviceLabel';
import {
  findExistingPath,
  findNestedCycle,
  groupDeviceKey,
} from '@/lib/groupGraph';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

export type GroupDeviceRef = { integration_id: string; device_id: string };

/** Device labels and keys, resolved once per page. */
export function useDeviceLookups() {
  const { devices: allDevices } = useDevicesApi();
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
  onChange,
  labelFor,
  presentKeys,
  replaceTarget,
  onStartReplace,
  onCancelReplace,
}: {
  devices: readonly GroupDeviceRef[];
  onChange: (devices: GroupDeviceRef[]) => void;
  labelFor: (ref: GroupDeviceRef | string) => string;
  presentKeys: ReadonlySet<string>;
  replaceTarget?: string | null;
  onStartReplace?: (key: string) => void;
  onCancelReplace?: () => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  if (devices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No devices in this room yet.
      </p>
    );
  }

  return (
    <BoundedList
      items={devices}
      keyOf={groupDeviceKey}
      revealKey={replaceTarget}
      moreLabel={(remaining) =>
        `Show ${Math.min(remaining, 30)} more saved members`
      }
      renderItem={(device) => {
        const key = groupDeviceKey(device);
        const missing = !presentKeys.has(key);
        const replacing = replaceTarget === key;
        return (
          <div
            data-target-key={key}
            className="flex flex-wrap items-center gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{labelFor(device)}</p>
              <p
                className={
                  missing
                    ? 'break-all text-xs text-muted-foreground'
                    : 'truncate text-xs text-muted-foreground'
                }
              >
                {key}
              </p>
            </div>
            {missing ? (
              <Badge variant="warning" className="shrink-0 gap-1">
                <AlertTriangle aria-hidden className="size-3" />
                Missing
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              aria-expanded={activeKey === key}
              onClick={() =>
                setActiveKey((current) => (current === key ? null : key))
              }
            >
              {activeKey === key ? 'Done' : 'Manage member'}
            </Button>
            {activeKey === key && missing && onStartReplace ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() =>
                  replacing ? onCancelReplace?.() : onStartReplace(key)
                }
              >
                {replacing ? 'Cancel' : 'Replace'}
              </Button>
            ) : null}
            {/* A labelled action rather than a bare ×, so it reads and is
                reachable the same way for everyone. */}
            {activeKey === key ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 text-destructive hover:text-destructive"
                aria-label={`Remove ${labelFor(device)} from this room`}
                onClick={() =>
                  onChange(
                    devices.filter((entry) => groupDeviceKey(entry) !== key),
                  )
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        );
      }}
    />
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
  options: { key: string; label: string; detail?: string; device: Device }[];
  selectedKeys: ReadonlySet<string>;
  onAdd: (device: Device) => void;
  onReplace?: (device: Device) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();

  const matchingOptions = useMemo(() => {
    if (trimmed === '') return [];
    return options.filter(({ key, label, detail, device }) =>
      `${label} ${detail ?? ''} ${device.name} ${device.id} ${device.integration_id} ${key}`
        .toLowerCase()
        .includes(trimmed),
    );
  }, [options, trimmed]);
  const matches = matchingOptions.slice(0, 20);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-xl border border-input bg-background px-3">
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
        <>
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
            {matches.map(({ key, label, detail, device }) => {
              const selected = selectedKeys.has(key);
              return (
                <li key={key} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {detail ?? key}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={selected}
                    onClick={() =>
                      onReplace ? onReplace(device) : onAdd(device)
                    }
                  >
                    <Plus aria-hidden />
                    {selected
                      ? 'Already in room'
                      : onReplace
                        ? 'Use here'
                        : 'Add'}
                  </Button>
                </li>
              );
            })}
          </ul>
          {matchingOptions.length > matches.length ? (
            <p className="text-xs text-muted-foreground">
              Showing {matches.length} of {matchingOptions.length} matches.
              Refine the search to narrow the results.
            </p>
          ) : null}
        </>
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
  if (ids.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No linked rooms. Devices from linked rooms become part of this room.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
      {ids.map((id) => {
        const group = groups.find((entry) => entry.id === id);
        return (
          <li
            key={id}
            data-target-key={id}
            className="flex items-center gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{group?.name ?? id}</p>
              <p className="truncate text-xs text-muted-foreground">{id}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove linked room ${group?.name ?? id}`}
              onClick={() => onChange(ids.filter((entry) => entry !== id))}
            >
              <X aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Search-first linked-room adder with nesting validation beside the choice:
 * rooms that would create a loop are offered with the reason and disabled,
 * rooms already reachable through another link are marked as redundant.
 */
export function RoomAdder({
  groups,
  groupId,
  selectedIds,
  onAdd,
}: {
  groups: readonly Group[];
  groupId: string | undefined;
  selectedIds: readonly string[];
  onAdd: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();

  const candidates = useMemo(() => {
    return groups
      .filter(
        (group) => group.id === groupId || !selectedIds.includes(group.id),
      )
      .map((group) => {
        const isSelf = group.id === groupId;
        const cycle =
          groupId && !isSelf
            ? findNestedCycle(groups, groupId, group.id)
            : null;
        const existing =
          groupId && !isSelf
            ? findExistingPath(groups, groupId, group.id)
            : null;
        return { group, cycle, existing, isSelf };
      })
      .filter(({ group }) =>
        trimmed === ''
          ? true
          : `${group.name} ${group.id}`.toLowerCase().includes(trimmed),
      );
  }, [groupId, groups, selectedIds, trimmed]);

  const shown =
    trimmed === '' ? candidates.slice(0, 8) : candidates.slice(0, 20);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-xl border border-input bg-background px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search rooms"
          aria-label="Search rooms to link"
          className="h-10 border-0 bg-transparent px-0 focus-visible:ring-0"
        />
      </label>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No other rooms available to link.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
          {shown.map(({ group, cycle, existing, isSelf }) => (
            <li key={group.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{group.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {isSelf
                    ? 'A room cannot link to itself'
                    : cycle
                      ? `Would create a loop: ${cycle.join(' → ')}`
                      : existing
                        ? `Already included through ${existing.slice(0, -1).join(' → ')}`
                        : group.id}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSelf || Boolean(cycle)}
                aria-describedby={
                  isSelf || cycle ? `link-cycle-${group.id}` : undefined
                }
                onClick={() => onAdd(group.id)}
              >
                <Plus aria-hidden />
                {existing ? 'Link anyway' : 'Link'}
              </Button>
              {cycle ? (
                <span id={`link-cycle-${group.id}`} className="sr-only">
                  {isSelf
                    ? `Linking ${group.name} to itself is not allowed`
                    : `Linking ${group.name} would create a nesting loop through ${cycle?.join(', ')}`}
                </span>
              ) : null}
            </li>
          ))}
          {trimmed === '' && candidates.length > shown.length ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {candidates.length - shown.length} more rooms — type to search.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
