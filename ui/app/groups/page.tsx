import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { getPower } from '@/lib/colors';
import { DeviceRow, DevicePowerToggle } from '@/ui/DeviceControls';
import { Button } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';
import { Input } from '@/ui/primitives/input';
import { EmptyState } from '@/ui/primitives/empty-state';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/primitives/popover';
import { GroupFloorplanPreview } from '@/ui/floorplan/GroupFloorplanPreview';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import type { Device } from '@/bindings/Device';

const roomPath = (id: string) => `/groups/${encodeURIComponent(id)}`;

// Controls inside a room card keep their own behaviour; a tap anywhere else on
// the card (including the floorplan preview) follows the room link.
const interactiveTargetSelector =
  'a, button, input, select, textarea, [role="button"], [contenteditable="true"]';

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(interactiveTargetSelector) !== null;

export default function Page() {
  const navigate = useNavigate();
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
  const [showHidden, setShowHidden] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useAssistantPageContext({ kind: 'group' });
  const devices = Object.values(state ?? {}).filter(
    (device): device is Device => Boolean(device),
  );
  const query = search.trim().toLocaleLowerCase();
  const visibleGroups = Object.entries(groups ?? {}).filter(
    ([, group]) =>
      group &&
      (showHidden || !group.hidden) &&
      group.name.toLocaleLowerCase().includes(query),
  );
  const activeFilterCount = Number(onOnly) + Number(showHidden);
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
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
                size="icon"
                aria-label="Filters"
                title="Filters"
                className="relative"
              >
                <SlidersHorizontal />
                {activeFilterCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-1">
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
                On only
                <Checkbox
                  checked={onOnly}
                  onCheckedChange={(value) => setOnOnly(value === true)}
                />
              </label>
              {view === 'rooms' ? (
                <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
                  Show hidden rooms
                  <Checkbox
                    checked={showHidden}
                    onCheckedChange={(value) => setShowHidden(value === true)}
                  />
                </label>
              ) : null}
              {activeFilterCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setOnOnly(false);
                    setShowHidden(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
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
                    className="flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4"
                    onClick={(event) => {
                      // The header link and the power toggle handle their own
                      // clicks; every other tap opens the room.
                      if (event.defaultPrevented) return;
                      if (isInteractiveTarget(event.target)) return;
                      navigate(roomPath(id));
                    }}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <Link
                        to={roomPath(id)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{group.name}</span>
                          <span className="block text-xs font-normal text-muted-foreground">
                            {roomDevices.length}{' '}
                            {roomDevices.length === 1 ? 'device' : 'devices'}
                            {roomDevices.length !== group.device_keys.length
                              ? ` · ${group.device_keys.length - roomDevices.length} unavailable`
                              : ''}
                          </span>
                        </span>
                        <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                      </Link>
                      <DevicePowerToggle
                        devices={roomDevices}
                        label={group.name}
                      />
                    </div>
                    <GroupFloorplanPreview
                      groupId={id}
                      group={group}
                      className="h-40"
                    />
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
