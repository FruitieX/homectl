import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GroupFloorplanPreview } from '@/ui/floorplan/GroupFloorplanPreview';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import {
  useDevicesState,
  useGroupsState,
  useScenesState,
} from '@/hooks/websocket';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { useSensorData, useTempSensorsResource } from '@/hooks/influxdb';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import {
  type DashboardWidget,
  buildDashboardWidgetProxyPath,
  getDashboardWidgetOptionBoolean,
  getDashboardWidgetOptionString,
  getDashboardWidgetOptionStringArray,
} from '@/hooks/useDashboard';
import { resolveGroupDeviceKeys } from '@/lib/group-floorplan-preview';
import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';
import { DevicePowerToggle } from '@/ui/DeviceControls';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { TimeSeriesPlot } from '@/ui/charts/TimeSeriesPlot';
import { SceneList } from '../groups/[id]/SceneList';
import { DashboardCard } from './WidgetChrome';

function WidgetFrame({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashboardCard className="rounded-lg">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-4 pt-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </DashboardCard>
  );
}

export function RoomsCard({ widget }: { widget: DashboardWidget }) {
  const groups = useGroupsState();
  const state = useDevicesState();
  const health = useDeviceHealth();
  const selected = getDashboardWidgetOptionStringArray(widget, 'groupIds');
  const ids =
    widget.options.roomSelection === 'selected'
      ? selected
      : Object.entries(groups ?? {})
          .filter(([, g]) => g && !g.hidden)
          .sort(([, a], [, b]) => a!.name.localeCompare(b!.name))
          .map(([id]) => id);
  const showPower = getDashboardWidgetOptionBoolean(widget, 'showPower', true);
  const showAttention = getDashboardWidgetOptionBoolean(
    widget,
    'showAttention',
    true,
  );
  const attention = new Set(
    health.isError ? [] : (health.data?.attention_device_keys ?? []),
  );
  return (
    <WidgetFrame
      title={widget.title || 'Rooms'}
      action={
        <Link to="/groups" className="text-xs text-primary underline">
          All rooms
        </Link>
      }
    >
      {!groups || !state ? (
        <p role="status" className="py-3 text-xs text-muted-foreground">
          Loading rooms…
        </p>
      ) : ids.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No rooms selected. Choose rooms in widget settings.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {ids.map((id) => {
            const group = groups[id];
            if (!group)
              return (
                <Link
                  key={id}
                  to={configItemHref('group', id)}
                  className="block py-3 text-xs text-muted-foreground"
                >
                  {id} · Room unavailable
                </Link>
              );
            const keys = resolveGroupDeviceKeys(id, groups);
            const devices = keys.flatMap((key) =>
              state[key] ? [state[key]!] : [],
            );
            const controls = devices.filter((d) => 'Controllable' in d.data);
            const enabled = controls.filter(
              (d) => 'Controllable' in d.data && !d.data.Controllable.disabled,
            );
            const on = enabled.filter(
              (d) =>
                'Controllable' in d.data && d.data.Controllable.state.power,
            ).length;
            const issues = keys.filter((key) => attention.has(key)).length;
            return (
              <div
                key={id}
                className="dashboard-room-row flex items-center gap-2 py-2"
              >
                <Link
                  to={`/groups/${encodeURIComponent(id)}`}
                  aria-label={`Open ${group.name}. ${on} of ${enabled.length} on${controls.length > enabled.length ? `, ${controls.length - enabled.length} disabled` : ''}${keys.length !== devices.length ? `, ${keys.length - devices.length} unavailable` : ''}${showAttention && issues ? `, ${issues} need attention` : ''}`}
                  data-attention={showAttention && issues > 0}
                  className="dashboard-room-link flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <LiveStatePreview
                    states={[
                      ...controls.map(devicePreviewState),
                      ...keys.filter((key) => !state[key]).map(() => undefined),
                    ]}
                  />
                  {getDashboardWidgetOptionBoolean(
                    widget,
                    'showFloorplan',
                    true,
                  ) && (
                    <div className="dashboard-room-preview shrink-0 empty:hidden">
                      <GroupFloorplanPreview
                        groupId={id}
                        group={group}
                        className="h-14 w-20"
                      />
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <strong className="dashboard-room-name block truncate text-sm font-medium">
                      {group.name}
                    </strong>
                    <span className="dashboard-room-summary block text-xs text-muted-foreground">
                      {controls.length
                        ? `${on} of ${enabled.length} on${controls.length > enabled.length ? ` · ${controls.length - enabled.length} disabled` : ''}`
                        : `${devices.length} sensors`}
                      {keys.length !== devices.length
                        ? ` · ${keys.length - devices.length} unavailable`
                        : ''}
                    </span>
                    {showAttention && issues > 0 && (
                      <span className="dashboard-room-attention block text-xs text-amber-700 dark:text-amber-400">
                        {issues}{' '}
                        {issues === 1 ? 'device needs' : 'devices need'}{' '}
                        attention
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
                {showPower && (
                  <DevicePowerToggle devices={controls} label={group.name} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {showAttention && health.isError && (
        <p role="status" className="text-xs text-muted-foreground">
          Reporting status could not be refreshed.
        </p>
      )}
    </WidgetFrame>
  );
}

export function ScenesCard({ widget }: { widget: DashboardWidget }) {
  const groups = useGroupsState(),
    devices = useDevicesState(),
    scenes = useScenesState();
  const scope = getDashboardWidgetOptionString(widget, 'scope', 'home');
  const groupId = getDashboardWidgetOptionString(widget, 'groupId', '');
  const selected =
    widget.options.sceneSelection === 'selected'
      ? getDashboardWidgetOptionStringArray(widget, 'sceneIds')
      : undefined;
  const keys =
    scope === 'group'
      ? resolveGroupDeviceKeys(groupId, groups ?? {})
      : scope === 'devices'
        ? getDashboardWidgetOptionStringArray(widget, 'deviceKeys')
        : scope === 'home'
          ? Object.keys(devices ?? {})
          : [];
  const scopeLabel =
    scope === 'group'
      ? (groups?.[groupId]?.name ?? 'Unavailable room')
      : scope === 'devices'
        ? `${keys.length} selected devices`
        : scope === 'home'
          ? 'Whole home'
          : 'Unknown scope';
  return (
    <WidgetFrame
      title={widget.title || 'Scenes'}
      action={
        <Link to="/config/scenes" className="text-xs text-primary underline">
          Manage
        </Link>
      }
    >
      <p className="py-2 text-xs text-muted-foreground">
        Activation scope: {scopeLabel}
      </p>
      <SceneList
        deviceKeys={keys}
        sceneIds={selected}
        allowPins={false}
        layout="tiles"
        compact
      />
      {scenes &&
        selected
          ?.filter((id) => !scenes[id])
          .map((id) => (
            <Link
              key={id}
              to={configItemHref('scene', id)}
              className="block py-2 text-xs text-muted-foreground"
            >
              {id} · Scene unavailable
            </Link>
          ))}
    </WidgetFrame>
  );
}

/** Uses the shared sensor source; this widget stores no duplicate connection credentials. */
export function IndoorClimateCard({ widget }: { widget: DashboardWidget }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const { advanced } = useSettingsPreferences();
  const temperatureId = getDashboardWidgetOptionString(
    widget,
    'temperatureSensorId',
    '',
  );
  const humidityId =
    getDashboardWidgetOptionString(widget, 'humiditySensorId', '') ||
    temperatureId;
  const range = getDashboardWidgetOptionString(widget, 'range', '-24h');
  const ids = useMemo(
    () => [...new Set([temperatureId, humidityId].filter(Boolean))],
    [temperatureId, humidityId],
  );
  const endpoint = buildDashboardWidgetProxyPath('/api/influxdb/temp-sensors', {
    device_ids: ids.join(','),
    range,
    window: range === '-7d' ? '1h' : '10m',
  });
  const sensors = useSensorData({
    endpointPath: endpoint,
    sensorIds: ids,
    selectionMode: 'selected',
  });
  const resource = useTempSensorsResource(endpoint);
  const temperature = sensors.find((s) => s.device_id === temperatureId);
  const humidity = sensors.find((s) => s.device_id === humidityId);
  const points = temperature?.temp_data ?? [];
  const title = widget.title || 'Indoor climate';
  const updated = temperature?.latest_temp_time;
  const age = updated
    ? Math.max(0, Math.floor((Date.now() - updated.getTime()) / 60000))
    : null;
  const metrics = (
    <div className="grid grid-cols-2 gap-4 py-3">
      <div>
        <p className="text-xs text-muted-foreground">Temperature</p>
        <p className="mt-1 text-2xl font-medium tabular-nums">
          {temperature?.latest_temp === undefined
            ? '—'
            : temperature.latest_temp.toFixed(1)}{' '}
          <span className="text-sm text-muted-foreground">°C</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {temperature?.device_name ??
            (temperatureId ? 'Source unavailable' : 'No source selected')}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Humidity</p>
        <p className="mt-1 text-2xl font-medium tabular-nums">
          {humidity?.latest_humidity === undefined
            ? '—'
            : Math.round(humidity.latest_humidity)}{' '}
          <span className="text-sm text-muted-foreground">%</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {humidity?.device_name ?? 'No readings'}
        </p>
      </div>
    </div>
  );
  const plot = (height: number) =>
    points.length ? (
      <ResponsiveChart height={height}>
        {({ width, height }) => (
          <TimeSeriesPlot
            width={width}
            height={height}
            unit="°C"
            label={`${temperature?.device_name ?? 'Temperature'} history`}
            showLegend={false}
            series={[
              {
                name: temperature?.device_name ?? 'Temperature',
                points: points.map((p) => ({
                  time: p.time.getTime(),
                  value: p.value,
                })),
                gapMs: range === '-7d' ? 7200000 : 1800000,
              },
            ]}
          />
        )}
      </ResponsiveChart>
    ) : (
      <p className="py-3 text-xs text-muted-foreground">
        No temperature history available.
      </p>
    );
  const status = (
    <p role="status" className="text-xs text-muted-foreground">
      {resource.isError
        ? 'Readings could not be refreshed. Showing available samples.'
        : resource.isPending
          ? 'Loading readings…'
          : updated
            ? `Temperature updated ${age === 0 ? 'just now' : `${age} min ago`}`
            : 'No temperature readings.'}
    </p>
  );
  return (
    <>
      <WidgetFrame
        title={title}
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open ${title} details`}
            onClick={() => setOpen(true)}
          >
            <ArrowUpRight />
          </Button>
        }
      >
        {metrics}
        {plot(125)}
        {status}
      </WidgetFrame>
      <ResponsiveOverlay
        open={open}
        onOpenChange={setOpen}
        title={title}
        description="Temperature and humidity from the selected sources."
        className="max-w-3xl"
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          {metrics}
          {plot(230)}
          {status}
          <p className="text-xs text-muted-foreground">
            Humidity updated:{' '}
            {humidity?.latest_humidity_time?.toLocaleString() ?? 'No readings'}
          </p>
          <details>
            <summary className="cursor-pointer py-2 text-sm">
              Recent temperature readings
            </summary>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th className="py-2">Time</th>
                    <th>Temperature</th>
                  </tr>
                </thead>
                <tbody>
                  {points
                    .slice(-48)
                    .reverse()
                    .map((p) => (
                      <tr
                        key={p.time.getTime()}
                        className="border-t border-border"
                      >
                        <td className="py-2">{p.time.toLocaleString()}</td>
                        <td>{p.value.toFixed(1)} °C</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
          {advanced && (
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              Temperature: {temperatureId || 'Not selected'} · Humidity:{' '}
              {humidityId || 'Not selected'} · Range: {range}
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <Link
              onClick={() => setOpen(false)}
              className="text-sm text-primary underline"
              to="/config/sensors"
            >
              Sensor catalog
            </Link>
            <Link
              onClick={() => setOpen(false)}
              className="text-sm text-primary underline"
              to="/config/widget-sources/influxdb"
            >
              Reporting source
            </Link>
          </div>
        </div>
      </ResponsiveOverlay>
    </>
  );
}
