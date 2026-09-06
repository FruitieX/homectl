import { useMemo } from 'react';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
  getDashboardWidgetOptionStringArray,
} from '@/hooks/useDashboard';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { DeviceRow } from '@/ui/DeviceControls';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';

export const ControlsCard = ({ widget }: { widget?: DashboardWidget }) => {
  const state = useDevicesState();
  const groups = useGroupsState();
  const { data: overrides } = useDeviceDisplayNames();
  const names = useMemo(
    () =>
      Object.fromEntries(
        overrides.map((row) => [row.device_key, row.display_name]),
      ),
    [overrides],
  );
  const groupId = getDashboardWidgetOptionString(widget, 'groupId', '');
  const configuredKeys = getDashboardWidgetOptionStringArray(
    widget,
    'deviceKeys',
  );
  const keys =
    configuredKeys.length > 0
      ? configuredKeys
      : groupId
        ? (groups?.[groupId]?.device_keys ?? [])
        : Object.keys(state ?? {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>{widget?.title || 'Controls'}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Choose devices in dashboard settings.
          </p>
        ) : (
          keys.map((key) => {
            const device = state?.[key];
            if (!device)
              return (
                <p
                  key={key}
                  className="break-words text-sm text-muted-foreground"
                >
                  {names[key] ?? key} · Unavailable
                </p>
              );
            return 'Controllable' in device.data ? (
              <DeviceRow key={key} device={device} displayNames={names} />
            ) : null;
          })
        )}
      </CardContent>
    </Card>
  );
};
