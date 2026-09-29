import { useState } from 'react';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { resolveGroupDeviceKeys } from '@/lib/group-floorplan-preview';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { Button } from '@/ui/primitives/button';
import { useLiveDeviceControls } from '@/ui/DeviceControls';
import { useConnectionStatus } from '@/hooks/websocket';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { getPower } from '@/lib/colors';
import { SceneList } from '../groups/[id]/SceneList';
import { CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { DashboardCard } from './WidgetChrome';

export function HomeOverview({ title = 'Home' }: { title?: string }) {
  const devices = useDevicesState();
  const groups = useGroupsState();
  const keys = Object.keys(devices ?? {});
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [pending, setPending] = useState(false);
  const powered = Object.values(devices ?? {}).filter(
    (device) =>
      device &&
      'Controllable' in device.data &&
      !isDeviceReadOnly(device) &&
      getPower(device.data),
  );
  return (
    <DashboardCard>
      <CardHeader className="dashboard-home-title shrink-0 flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Button
          variant="outline"
          className="dashboard-home-power"
          disabled={!connected || powered.length === 0 || pending}
          aria-busy={pending}
          onClick={async () => {
            setPending(true);
            await Promise.all(
              powered.map((device) =>
                device ? setState(device, false) : Promise.resolve(false),
              ),
            );
            setPending(false);
          }}
        >
          All devices off
        </Button>
      </CardHeader>
      <CardContent className="dashboard-home-content min-h-0 flex-1 space-y-5 overflow-auto">
        <section className="dashboard-home-scenes space-y-3">
          <h2 className="text-sm font-medium">Scenes</h2>
          <SceneList deviceKeys={keys} compact />
        </section>
        <section className="dashboard-home-rooms space-y-2">
          <h2 className="text-sm font-medium">Rooms</h2>
          {Object.entries(groups ?? {})
            .filter(([, group]) => group && !group.hidden)
            .map(([id, group]) => {
              if (!group) return null;
              const members = resolveGroupDeviceKeys(id, groups ?? {});
              const on = members.filter(
                (key) => devices?.[key] && getPower(devices[key]!.data),
              ).length;
              return (
                <Link
                  key={id}
                  to={`/groups/${encodeURIComponent(id)}`}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <LiveStatePreview
                    states={members.flatMap((key) =>
                      !devices?.[key]
                        ? [undefined]
                        : 'Controllable' in devices[key]!.data
                          ? [devicePreviewState(devices[key]!)]
                          : [],
                    )}
                  />
                  <GroupFloorplanPreview
                    groupId={id}
                    group={group}
                    className="h-14 w-20"
                  />
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
    </DashboardCard>
  );
}
import { GroupFloorplanPreview } from '@/ui/floorplan/GroupFloorplanPreview';
