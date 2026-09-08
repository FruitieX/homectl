import { useState } from 'react';
import { useDashboardSpacing } from '@/hooks/dashboardSpacing';
import { useInterval, useTimeout } from 'usehooks-ts';
import { Activity } from 'lucide-react';
import { useSensorData, useTempSensorsResource } from '@/hooks/influxdb';
import { useSensorCatalog } from '@/hooks/sensorCatalog';
import useIdle from '@/hooks/useIdle';
import {
  type DashboardWidget,
  buildDashboardWidgetProxyPath,
  getDashboardWidgetOptionBoolean,
  getDashboardWidgetOptionString,
  getDashboardWidgetOptionStringArray,
} from '@/hooks/useDashboard';
import {
  calculateTemperatureStats,
  calculateHumidityStats,
  isOffline,
  type SensorTrend,
} from '@/lib/sensorStats';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { TimeSeriesPlot } from '@/ui/charts/TimeSeriesPlot';
import { Button } from '@/ui/primitives/button';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';
import { DetailPanel, Metric, WidgetCard, WidgetHeading } from './WidgetChrome';
import { SensorChip } from '@/ui/SensorChip';

const trendLabel = (trend: SensorTrend) =>
  ({
    up: 'Rising',
    down: 'Falling',
    stable: 'Steady',
    unknown: 'Not enough recent data',
  })[trend];
export const SensorsCard = ({ widget }: { widget?: DashboardWidget }) => {
  const [spacing] = useDashboardSpacing();
  const [open, setOpen] = useState(false),
    [activeId, setActiveId] = useState<string>('all'),
    [filter, setFilter] = useState('all');
  // Age readings even without a data update, but evaluate incoming samples
  // against this render's time rather than the preceding timer tick.
  const [, setClockTick] = useState(0);
  useInterval(() => setClockTick((tick) => tick + 1), 60000);
  const now = Date.now();
  const isIdle = useIdle();
  useTimeout(() => setOpen(false), open && isIdle ? 10000 : null);
  const sensorIds = getDashboardWidgetOptionStringArray(widget, 'sensorIds');
  const { catalog } = useSensorCatalog();
  const sensorGroups = catalog?.groups ?? [];
  const url = getDashboardWidgetOptionString(widget, 'influxUrl', ''),
    token = getDashboardWidgetOptionString(widget, 'influxToken', '');
  const range = getDashboardWidgetOptionString(widget, 'range', '-6h'),
    window = getDashboardWidgetOptionString(widget, 'window', '10m');
  const custom =
    url || token || sensorIds.length || range !== '-6h' || window !== '10m';
  const endpointPath = custom
    ? buildDashboardWidgetProxyPath('/api/influxdb/temp-sensors', {
        url,
        token,
        device_ids: sensorIds.join(','),
        range,
        window,
      })
    : getDashboardWidgetOptionString(
        widget,
        'sensorPath',
        '/api/influxdb/temp-sensors',
      );
  const sensors = useSensorData({
    endpointPath,
    sensorIds,
  });
  const resource = useTempSensorsResource(endpointPath);
  // The settings picker is the source of truth. Keep every selected sensor in
  // the preview so a valid selection is never hidden by an arbitrary cap.
  const preview = sensorIds.length
    ? sensors.filter((sensor) => sensorIds.includes(sensor.device_id))
    : sensors;
  const active = sensors.find((s) => s.device_id === activeId);
  const chosen = active
    ? [active]
    : sensors.filter(
        (s) =>
          filter === 'all' ||
          (filter === 'indoor'
            ? s.is_indoor
            : sensorGroups.find((group) => group.id === filter)
              ? sensorGroups.find((group) => group.id === filter)?.sensorIds.includes(s.device_id)
              : !s.is_indoor),
      );
  const temperature = active
      ? calculateTemperatureStats(active.temp_data, now)
      : null,
    humidity = active
      ? calculateHumidityStats(active.humidity_data, now)
      : null;
  const show = (id: string) => {
    setActiveId(id);
    setOpen(true);
  };
  return (
    <>
      <WidgetCard className="p-[var(--widget-padding,1rem)]">
        <div className="mb-3 flex items-center gap-2">
          <WidgetHeading icon={<Activity />} label="Climate sensors" />
          <Button size="sm" variant="ghost" onClick={() => show('all')}>
            All
          </Button>
        </div>
        <div
          className={
            getDashboardWidgetOptionBoolean(widget, 'wrapPreview', true)
              ? spacing === 'compact'
                ? 'grid grid-cols-2 gap-2 min-[600px]:grid-cols-4'
                : 'grid grid-cols-2 gap-2 min-[600px]:grid-cols-3'
              : 'flex gap-2 overflow-x-auto pb-1'
          }
        >
          {preview.map((sensor) => (
            <SensorChip
              key={sensor.device_id}
              sensor={sensor}
              now={now}
              onOpen={() => show(sensor.device_id)}
            />
          ))}
        </div>
        {(resource.isPending ||
          resource.isError ||
          resource.rows.length === 0) && (
          <p role="status" className="pt-3 text-xs text-muted-foreground">
            {resource.isPending
              ? 'Loading sensor readings…'
              : resource.isError
                ? 'Sensor readings could not be refreshed.'
                : 'No sensor readings available.'}
          </p>
        )}
      </WidgetCard>
      <ResponsiveOverlay
        open={open}
        onOpenChange={setOpen}
        title={active?.device_name ?? 'Climate sensors'}
        description="Sensor history and recent trends."
        className="max-w-5xl"
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          <div className="flex flex-wrap gap-2 p-1">
            <Select value={activeId} onValueChange={setActiveId}>
              <SelectTrigger aria-label="Sensor" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Compare sensors</SelectItem>
                {sensors.map((s) => (
                  <SelectItem key={s.device_id} value={s.device_id}>
                    {s.device_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!active && (
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger aria-label="Sensor location" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  <SelectItem value="indoor">Indoor</SelectItem>
                  <SelectItem value="outdoor">Outdoor</SelectItem>
                  {sensorGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {active && (
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: 'Temperature',
                  stats: temperature,
                  unit: '°C',
                  time: active.latest_temp_time,
                },
                {
                  label: 'Humidity',
                  stats: humidity,
                  unit: '%',
                  time: active.latest_humidity_time,
                },
              ].map(({ label, stats, unit, time }) => (
                <DetailPanel key={label}>
                  <Metric
                    label={label}
                    value={
                      stats && !isOffline(time, 15, now)
                        ? `${stats.current.toFixed(1)}${unit}`
                        : 'No recent reading'
                    }
                    hint={stats ? trendLabel(stats.trend) : 'No data'}
                  />
                  {stats && (
                    <>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Range {stats.min.toFixed(1)}–{stats.max.toFixed(1)}
                        {unit}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Average {stats.avg.toFixed(1)}
                        {unit}
                      </p>
                      {(stats.trend === 'up' || stats.trend === 'down') && (
                        <p className="mt-1 text-xs">
                          {stats.slopePerHour > 0 ? '+' : ''}
                          {stats.slopePerHour.toFixed(2)}
                          {unit}/h
                        </p>
                      )}
                    </>
                  )}
                </DetailPanel>
              ))}
            </div>
          )}
          {(['temperature', 'humidity'] as const).map((metric) => (
            <DetailPanel key={metric} className="p-2 sm:p-3">
              <h3 className="px-1 pb-1 text-sm font-medium">
                {metric === 'temperature' ? 'Temperature (°C)' : 'Humidity (%)'}
              </h3>
              <ResponsiveChart height={260}>
                {({ width, height }) => (
                  <TimeSeriesPlot
                    label={`${metric} history`}
                    unit={metric === 'temperature' ? '°C' : '%'}
                    width={width}
                    height={height}
                    series={chosen
                      .filter(
                        (s) =>
                          (metric === 'temperature'
                            ? s.temp_data
                            : s.humidity_data
                          ).length > 0,
                      )
                      .map((s) => ({
                        name: s.device_name,
                        gapMs: 3600000,
                        points: (metric === 'temperature'
                          ? s.temp_data
                          : s.humidity_data
                        ).map((p) => ({
                          time: p.time.getTime(),
                          value: p.value,
                        })),
                      }))}
                  />
                )}
              </ResponsiveChart>
            </DetailPanel>
          ))}
        </div>
      </ResponsiveOverlay>
    </>
  );
};
