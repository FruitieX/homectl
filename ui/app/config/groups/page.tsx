import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import {
  type Group,
  useDeviceDisplayNames,
  useGroups,
} from '@/hooks/useConfig';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { matchesConfigSearch } from '@/lib/configSearch';
import { getDeviceKey } from '@/lib/device';
import {
  getDeviceDisplayLabel,
  getDeviceDisplayLabelFromKey,
} from '@/lib/deviceLabel';
import { missingGroupDevices } from '@/lib/groupGraph';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { ConfigPageHeader } from '../page-header';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';

const getGroupDeviceKey = (device: Group['devices'][number]) =>
  `${device.integration_id}/${device.device_id}`;

export default function GroupsPage() {
  const { data: groups, loading, error, refetch } = useGroups();
  const { devices: allDevices } = useDevicesApi();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const navigate = useNavigate();
  useCreateDeepLink(
    useCallback(() => navigate('/config/groups/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'group' });

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
      ),
    [allDevices],
  );
  const presentKeys = useMemo(
    () => new Set(allDevices.map((device) => getDeviceKey(device))),
    [allDevices],
  );

  const searchValues = useCallback(
    (group: Group) => {
      const deviceLabels = group.devices.map((device) => {
        const deviceKey = getGroupDeviceKey(device);
        const matchingDevice = devicesByKey[deviceKey];
        return matchingDevice
          ? getDeviceDisplayLabel(matchingDevice, deviceDisplayNameMap)
          : getDeviceDisplayLabelFromKey(
              deviceKey,
              device.device_id,
              deviceDisplayNameMap,
            );
      });

      return [
        group.id,
        group.name,
        group.hidden ? 'hidden' : 'visible',
        group.linked_groups,
        group.devices.map((device) => getGroupDeviceKey(device)),
        deviceLabels,
      ];
    },
    [deviceDisplayNameMap, devicesByKey],
  );

  const visibleGroups = groups.filter((group) =>
    matchesConfigSearch(search, ...searchValues(group)),
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>Could not load rooms: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Rooms"
        description="Organize the devices you want to control together. Sensors can stay outside a room."
        actions={
          <Button asChild>
            <Link to="/config/groups/new">Add room</Link>
          </Button>
        }
      />

      <ConfigListSearchBar
        filteredCount={visibleGroups.length}
        onChange={setSearch}
        placeholder="Search rooms or devices"
        totalCount={groups.length}
        value={search}
      />

      {visibleGroups.length === 0 ? (
        <EmptyState
          title={
            groups.length === 0
              ? 'No rooms yet'
              : 'No rooms match the current search'
          }
          description={
            groups.length === 0
              ? 'Create a room to group devices and target them from scenes and routines.'
              : 'Try another name, id, linked group, or device label.'
          }
          action={
            groups.length === 0 ? (
              <Button size="sm" asChild>
                <Link to="/config/groups/new">New room</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleGroups.map((group) => {
            const missing = missingGroupDevices(group, presentKeys);
            return (
              <Card
                key={group.id}
                className="rounded-2xl border-border/70 shadow-sm transition hover:border-primary/40 hover:bg-accent/30 hover:shadow-md"
              >
                <Link
                  to={`/config/groups/${encodeURIComponent(group.id)}`}
                  className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle>{group.name}</CardTitle>
                        <CardDescription>
                          {group.devices.length === 0
                            ? 'No devices yet'
                            : `${group.devices.length} ${
                                group.devices.length === 1
                                  ? 'device'
                                  : 'devices'
                              }`}
                          {group.linked_groups.length > 0
                            ? ` · ${group.linked_groups.length} linked ${group.linked_groups.length === 1 ? 'room' : 'rooms'}`
                            : ''}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {group.hidden && <Badge variant="muted">Hidden</Badge>}
                        {missing.length > 0 ? (
                          <Badge
                            variant="warning"
                            className="gap-1 font-medium"
                          >
                            <AlertTriangle aria-hidden className="size-3" />
                            {missing.length} missing reference
                            {missing.length === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </CardHeader>
                  {group.devices.length === 0 ? (
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        Empty room — add devices to use it in scenes and
                        routines.
                      </p>
                    </CardContent>
                  ) : null}
                </Link>
                {missing.length > 0 ? (
                  <CardContent className="pt-0">
                    <Link
                      to={`/config/groups/${encodeURIComponent(
                        group.id,
                      )}?section=devices&target=${encodeURIComponent(
                        `replace:${missing[0]}`,
                      )}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 underline-offset-4 hover:underline dark:text-amber-200"
                    >
                      {missing.length === 1
                        ? 'Replace or remove the missing device'
                        : `Replace or remove ${missing.length} missing devices`}
                    </Link>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
