import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { getPower } from '@/lib/colors';
import { DeviceRow, DeviceQuickControls } from '@/ui/DeviceControls';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { EmptyState } from '@/ui/primitives/empty-state';
import type { Device } from '@/bindings/Device';

export default function Page() {
  const groups = useGroupsState();
  const state = useDevicesState();
  const { data: overrides } = useDeviceDisplayNames();
  const names = useMemo(
    () =>
      Object.fromEntries(
        overrides.map((row) => [row.device_key, row.display_name]),
      ),
    [overrides],
  );
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'rooms' | 'devices'>('rooms');
  const [onOnly, setOnOnly] = useState(false);
  const devices = Object.values(state ?? {}).filter(
    (device): device is Device => Boolean(device),
  );
  const query = search.trim().toLocaleLowerCase();
  const visibleGroups = Object.entries(groups ?? {}).filter(
    ([, group]) =>
      group && !group.hidden && group.name.toLocaleLowerCase().includes(query),
  );
  const matchingDevices = devices.filter(
    (device) =>
      getDeviceDisplayLabel(device, names)
        .toLocaleLowerCase()
        .includes(query) &&
      (!onOnly || getPower(device.data)),
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1" aria-label="Browse">
            <Button
              variant={view === 'rooms' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'rooms'}
              onClick={() => setView('rooms')}
            >
              Rooms
            </Button>
            <Button
              variant={view === 'devices' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'devices'}
              onClick={() => setView('devices')}
            >
              All devices
            </Button>
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Search rooms or devices"
              placeholder={
                view === 'rooms' ? 'Search rooms…' : 'Search devices…'
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button
            variant={onOnly ? 'secondary' : 'outline'}
            aria-pressed={onOnly}
            onClick={() => setOnOnly(!onOnly)}
          >
            On only
          </Button>
        </div>
        {!state || !groups ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading devices…
          </p>
        ) : view === 'rooms' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleGroups
              .filter(
                ([, group]) =>
                  !onOnly ||
                  group!.device_keys.some(
                    (key) => state[key] && getPower(state[key]!.data),
                  ),
              )
              .map(([id, group]) => {
                if (!group) return null;
                const roomDevices = group.device_keys.flatMap((key) =>
                  state[key] ? [state[key]!] : [],
                );
                return (
                  <section
                    key={id}
                    className="space-y-3 rounded-xl border border-border bg-card p-4"
                  >
                    <Link
                      to={`/groups/${encodeURIComponent(id)}`}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">{group.name}</span>
                      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                    </Link>
                    <DeviceQuickControls devices={roomDevices} compact />
                    <p className="text-sm text-muted-foreground">
                      {roomDevices.length} devices
                      {roomDevices.length !== group.device_keys.length
                        ? ` · ${group.device_keys.length - roomDevices.length} unavailable`
                        : ''}
                    </p>
                  </section>
                );
              })}
            {visibleGroups.filter(
              ([, group]) =>
                !onOnly ||
                group!.device_keys.some(
                  (key) => state[key] && getPower(state[key]!.data),
                ),
            ).length === 0 && (
              <EmptyState
                title="No matching rooms"
                description="Try another search or filter, or create a group in Settings."
                action={
                  <Button asChild variant="outline">
                    <Link to="/config/groups">Manage groups</Link>
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {matchingDevices.map((device) =>
              'Controllable' in device.data ? (
                <DeviceRow
                  key={getDeviceKey(device)}
                  device={device}
                  displayNames={names}
                />
              ) : (
                <SensorRow
                  key={getDeviceKey(device)}
                  device={device}
                  displayNames={names}
                />
              ),
            )}
            {matchingDevices.length === 0 && (
              <EmptyState
                title="No matching devices"
                description="Try another search or clear the On only filter."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SensorRow({
  device,
  displayNames,
}: {
  device: Device;
  displayNames: Record<string, string>;
}) {
  const sensor = 'Sensor' in device.data ? device.data.Sensor : null;
  const value =
    sensor && 'value' in sensor
      ? String(sensor.value)
      : getPower(device.data)
        ? 'On'
        : 'Off';
  return (
    <div className="flex min-h-20 min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <span className="min-w-0 break-words text-sm font-medium">
        {getDeviceDisplayLabel(device, displayNames)}
      </span>
      <span className="max-w-[50%] break-words text-sm text-muted-foreground">
        {value}
      </span>
    </div>
  );
}
