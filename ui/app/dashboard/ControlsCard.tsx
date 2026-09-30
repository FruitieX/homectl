import { SlidersHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
  getDashboardWidgetOptionStringArray,
} from '@/hooks/useDashboard';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { DeviceRow } from '@/ui/DeviceControls';
import { CardContent } from '@/ui/primitives/card';
import { DashboardCard, WidgetHeading } from './WidgetChrome';
import { WidgetRecovery } from './WidgetRecovery';
import { Link } from 'react-router-dom';
import { configItemHref } from '@/lib/configItemHref';
import { resolveGroupDeviceKeys } from '@/lib/group-floorplan-preview';

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
        ? resolveGroupDeviceKeys(groupId, groups ?? {})
        : Object.keys(state ?? {});
  return (
    <DashboardCard>
      <div className="dashboard-controls-title shrink-0 px-4 pb-2 pt-4">
        <WidgetHeading
          icon={<SlidersHorizontal />}
          label={widget?.title || 'Controls'}
        />
      </div>
      <CardContent className="dashboard-controls-content min-h-0 flex-1 divide-y divide-border/60 overflow-auto px-4 pb-3">
        {!state || !groups ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading controls…
          </p>
        ) : groupId && !groups[groupId] && !configuredKeys.length ? (
          <WidgetRecovery
            widget={widget}
            message="This room or group is no longer available."
          />
        ) : keys.length === 0 ||
          keys.every(
            (key) => state[key] && !('Controllable' in state[key]!.data),
          ) ? (
          <WidgetRecovery
            widget={widget}
            message="No controllable devices in this selection."
          />
        ) : (
          keys.map((key) => {
            const device = state?.[key];
            if (!device)
              return (
                <p
                  key={key}
                  className="dashboard-controls-row break-words text-sm text-muted-foreground"
                >
                  <Link
                    className="text-primary underline"
                    to={configItemHref('device', key)}
                  >
                    {names[key] ?? key} · Unavailable
                  </Link>
                </p>
              );
            return 'Controllable' in device.data ? (
              <div key={key} className="dashboard-controls-row min-w-0">
                <DeviceRow
                  device={device}
                  displayNames={names}
                  plain
                  inlineBrightness
                />
              </div>
            ) : null;
          })
        )}
      </CardContent>
    </DashboardCard>
  );
};
