import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { GroupId } from '@/bindings/GroupId';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';

import { Link } from 'react-router-dom';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import Color from 'color';
import { excludeUndefined } from 'utils/excludeUndefined';
import Preview from './Preview';
import { Card, CardContent } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';

export default function Page() {
  const liveGroups = useGroupsState();
  const liveDevices = useDevicesState();

  const groups: [GroupId, FlattenedGroupConfig][] = Object.entries(
    excludeUndefined(liveGroups ?? undefined),
  );

  const filteredGroups = groups.filter(([, group]) => !group.hidden);
  filteredGroups.sort((a, b) => a[1].name.localeCompare(b[1].name));

  const devices: Device[] = Object.values(
    excludeUndefined(liveDevices ?? undefined),
  );

  return (
    <div className="flex-1 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
      {filteredGroups.length === 0 ? (
        <EmptyState
          title="No visible groups"
          description="Groups configured as visible will appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredGroups.map(([groupId, group]) => {
            const filteredDevices = devices.filter((device) =>
              group.device_keys.includes(getDeviceKey(device)),
            );

            return (
              <Link key={groupId} to={`/groups/${groupId}`}>
                <Card className="overflow-hidden transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-semibold tracking-tight">
                        {group.name}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {group.device_keys.length}{' '}
                        {group.device_keys.length === 1 ? 'device' : 'devices'}
                      </p>
                    </div>
                    <div className="h-24 w-28 shrink-0 overflow-hidden rounded-2xl bg-muted">
                      <Preview
                        devices={filteredDevices}
                        overrideColor={Color({ h: 35, s: 50, v: 100 })}
                      />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
