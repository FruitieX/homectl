import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { DeviceRow, DeviceQuickControls } from '@/ui/DeviceControls';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Button } from '@/ui/primitives/button';
import { SceneList } from './[id]/SceneList';
import { SensorRow } from './page';

export default function RoomPage() {
  const { id } = useParams();
  const groups = useGroupsState();
  const devices = useDevicesState();
  const { data: overrides } = useDeviceDisplayNames();
  const names = useMemo(
    () =>
      Object.fromEntries(
        overrides.map((row) => [row.device_key, row.display_name]),
      ),
    [overrides],
  );
  const group = id ? groups?.[id] : null;
  if (!groups || !devices)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading room…
      </p>
    );
  if (!group)
    return (
      <EmptyState
        title="Room not found"
        action={
          <Button asChild>
            <Link to="/groups">Back to rooms</Link>
          </Button>
        }
      />
    );
  const selected = group.device_keys.flatMap((key) =>
    devices[key] ? [devices[key]!] : [],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Scenes</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/config/scenes">Manage scenes</Link>
              </Button>
            </div>
            <SceneList deviceKeys={group.device_keys} compact />
          </section>
          <DeviceQuickControls key={id} devices={selected} />
        </div>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Devices</h2>
          {group.device_keys.map((key) => {
            const device = devices[key];
            if (!device)
              return (
                <p
                  key={key}
                  className="break-words rounded-xl border border-border p-4 text-sm text-muted-foreground"
                >
                  {names[key] ?? key} · Unavailable
                </p>
              );
            return 'Controllable' in device.data ? (
              <DeviceRow key={key} device={device} displayNames={names} />
            ) : (
              <SensorRow key={key} device={device} displayNames={names} />
            );
          })}
          {selected.length === 0 && group.device_keys.length === 0 && (
            <EmptyState
              title="No devices in this room"
              action={
                <Button asChild variant="outline">
                  <Link to="/config/groups">Manage groups</Link>
                </Button>
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}
