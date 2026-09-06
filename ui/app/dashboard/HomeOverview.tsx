import { Button } from '@/ui/primitives/button';
import { useLiveDeviceControls } from '@/ui/DeviceControls';
import { useConnectionStatus } from '@/hooks/websocket';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { getPower } from '@/lib/colors';
import { SceneList } from '../groups/[id]/SceneList';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';

export function HomeOverview() {
  const devices = useDevicesState();
  const groups = useGroupsState();
  const keys = Object.keys(devices ?? {});
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const powered = Object.values(devices ?? {}).filter(
    (device) =>
      device && 'Controllable' in device.data && getPower(device.data),
  );
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Home</CardTitle>
        <Button
          variant="outline"
          disabled={!connected || powered.length === 0}
          onClick={() =>
            powered.forEach((device) => {
              if (device) setState(device, false);
            })
          }
        >
          All devices off
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Scenes</h2>
          <SceneList deviceKeys={keys} compact />
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Rooms</h2>
          {Object.entries(groups ?? {})
            .filter(([, group]) => group && !group.hidden)
            .map(([id, group]) => {
              if (!group) return null;
              const on = group.device_keys.filter(
                (key) => devices?.[key] && getPower(devices[key]!.data),
              ).length;
              return (
                <Link
                  key={id}
                  to={`/groups/${encodeURIComponent(id)}`}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {group.name}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-sm text-muted-foreground">
                    {on} on
                  </span>
                  <ChevronRight className="size-4 shrink-0" />
                </Link>
              );
            })}
        </section>
      </CardContent>
    </Card>
  );
}
