import { useState } from 'react';
import { useDashboardSpacing } from '@/hooks/dashboardSpacing';
import { useInterval, useTimeout } from 'usehooks-ts';
import { Activity, Droplets, Thermometer } from 'lucide-react';
import { useSensorData, useTempSensorsResource } from '@/hooks/influxdb';
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
  getTrendIcon,
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
  const [now, setNow] = useState(Date.now);
  useInterval(() => setNow(Date.now()), 60000);
  const isIdle = useIdle();
  useTimeout(() => setOpen(false), open && isIdle ? 10000 : null);
  const sensorIds = getDashboardWidgetOptionStringArray(widget, 'sensorIds');
  const indoorSensorIds = getDashboardWidgetOptionStringArray(
    widget,
    'indoorSensorIds',
  );
  const prioritySensorIds = getDashboardWidgetOptionStringArray(
    widget,
    'prioritySensorIds',
  );
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
    indoorSensorIds: indoorSensorIds.length ? indoorSensorIds : undefined,
    prioritySensorIds: prioritySensorIds.length ? prioritySensorIds : undefined,
  });
  const priority = sensors.filter((s) => s.is_priority);
  const resource = useTempSensorsResource(endpointPath);
  const preview = (priority.length ? priority : sensors).slice(0, 5);
  const active = sensors.find((s) => s.device_id === activeId);
  const chosen = active
    ? [active]
    : sensors.filter(
        (s) =>
          filter === 'all' ||
          (filter === 'indoor' ? s.is_indoor : !s.is_indoor),
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
                ? 'grid grid-cols-2 gap-2 min-[600px]:grid-cols-5'
                : 'grid grid-cols-2 gap-2 min-[600px]:grid-cols-3'
              : 'flex gap-2 overflow-x-auto pb-1'
          }
        >
          {preview.map((sensor) => {
            const temp = calculateTemperatureStats(sensor.temp_data, now),
              hum = calculateHumidityStats(sensor.humidity_data, now);
            return (
              <button
                type="button"
                key={sensor.device_id}
                onClick={() => show(sensor.device_id)}
                className="min-w-0 rounded-xl border border-border/50 p-[var(--widget-tile-padding,0.75rem)] text-left transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="mb-2 truncate text-xs font-medium">
                  {sensor.device_name}
                </div>
                <div className="flex items-center gap-1.5 text-base tabular-nums">
                  <Thermometer className="size-3.5 shrink-0 text-muted-foreground" />
                  {!isOffline(sensor.latest_temp_time, 15, now) &&
                  sensor.latest_temp !== undefined
                    ? `${sensor.latest_temp.toFixed(1)}°`
                    : '—'}
                  <span
                    className="text-xs text-muted-foreground"
                    aria-label={temp ? trendLabel(temp.trend) : undefined}
                  >
                    {temp ? getTrendIcon(temp.trend) : null}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm tabular-nums">
                  <Droplets className="size-3.5 shrink-0 text-muted-foreground" />
                  {!isOffline(sensor.latest_humidity_time, 15, now) &&
                  sensor.latest_humidity !== undefined
                    ? `${sensor.latest_humidity.toFixed(0)}%`
                    : '—'}
                  <span
                    className="text-xs text-muted-foreground"
                    aria-label={hum ? trendLabel(hum.trend) : undefined}
                  >
                    {hum ? getTrendIcon(hum.trend) : null}
                  </span>
                </div>
              </button>
            );
          })}
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
          <div className="flex flex-wrap gap-2">
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
