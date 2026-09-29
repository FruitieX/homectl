import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Droplets, Thermometer } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import { useTempSensorsResource } from '@/hooks/influxdb';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { configItemHref } from '@/lib/configItemHref';
import { LiveSensorRow } from '@/ui/LiveSensorRow';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { TimeSeriesPlot } from '@/ui/charts/TimeSeriesPlot';
import { Button } from '@/ui/primitives/button';

/** Match history by its full source identity; numeric sensor values have no unit. */
function useRoomReadings(deviceKeys: string[]) {
  const resource = useTempSensorsResource();
  const readings = useMemo(() => {
    const members = new Set(deviceKeys);
    const sources = new Map<string, typeof resource.rows>();
    for (const row of resource.rows) {
      const key = `${row.integration_id}/${row.device_id}`;
      if (members.has(key)) {
        if (!sources.has(key)) sources.set(key, []);
        sources.get(key)!.push(row);
      }
    }
    return [...sources]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({
        key,
        temperature: rows
          .filter((row) => row._field === 'tempc')
          .sort((a, b) => a._time.getTime() - b._time.getTime()),
        humidity: rows
          .filter((row) => row._field === 'hum')
          .sort((a, b) => a._time.getTime() - b._time.getTime()),
      }));
  }, [deviceKeys, resource.rows]);
  return { resource, readings };
}

/** Compact room-card summary; never invent an aggregate across several sources. */
export function RoomClimateSummary({ deviceKeys }: { deviceKeys: string[] }) {
  const { readings, resource } = useRoomReadings(deviceKeys);
  if (!readings.length) return null;
  if (readings.length > 1)
    return (
      <p className="text-xs text-muted-foreground">
        {readings.length} climate sources · Open room for readings
      </p>
    );
  const { temperature, humidity } = readings[0];
  const latestTemp = temperature.at(-1),
    latestHumidity = humidity.at(-1);
  const latest = [latestTemp, latestHumidity]
    .filter((sample) => sample !== undefined)
    .sort((a, b) => b._time.getTime() - a._time.getTime())[0];
  return (
    <p
      className="text-xs text-muted-foreground"
      title={`Last sample: ${latest._time.toLocaleString()}${resource.isError ? ' · Could not refresh' : ''}`}
    >
      {[
        latestTemp ? `${latestTemp._value.toFixed(1)} °C` : '',
        latestHumidity ? `${Math.round(latestHumidity._value)}% humidity` : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      {resource.isError && ' · Last available'}
      <span className="ml-2 text-[10px]">
        Sample{' '}
        <time dateTime={latest._time.toISOString()}>
          {latest._time.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </span>
    </p>
  );
}

export function RoomConditions({
  deviceKeys,
  sensors,
  displayNames,
}: {
  deviceKeys: string[];
  sensors: Device[];
  displayNames: Record<string, string>;
}) {
  const { resource, readings } = useRoomReadings(deviceKeys);
  const climateKeys = new Set(readings.map((reading) => reading.key));
  const otherSensors = sensors.filter(
    (sensor) => !climateKeys.has(getDeviceKey(sensor)),
  );
  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5"
      aria-label="Room conditions"
    >
      <h2 className="text-base font-semibold">Conditions</h2>
      {readings.map(({ key, temperature, humidity }) => {
        const device = sensors.find((sensor) => getDeviceKey(sensor) === key);
        const name = device
          ? getDeviceDisplayLabel(device, displayNames)
          : (displayNames[key] ?? key);
        const history = temperature.length ? temperature : humidity;
        const metric = temperature.length ? 'temperature' : 'humidity';
        return (
          <div
            key={key}
            className="space-y-3"
            aria-label={`${name} climate readings`}
          >
            <Link
              to={configItemHref('device', key)}
              className="text-xs font-medium text-primary underline"
            >
              {name}
            </Link>
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: 'Temperature',
                  unit: '°C',
                  samples: temperature,
                  Icon: Thermometer,
                },
                {
                  label: 'Humidity',
                  unit: '%',
                  samples: humidity,
                  Icon: Droplets,
                },
              ].map(({ label, unit, samples, Icon }) => {
                const latest = samples.at(-1);
                return (
                  <div
                    key={label}
                    className="min-w-0 rounded-md bg-muted/35 p-3"
                    aria-label={`${name} ${label.toLowerCase()}`}
                  >
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon className="size-3.5" />
                      {label}
                    </p>
                    <p className="mt-2 text-2xl font-medium tabular-nums">
                      {latest
                        ? latest._value.toFixed(unit === '°C' ? 1 : 0)
                        : '—'}{' '}
                      <span className="text-sm text-muted-foreground">
                        {unit}
                      </span>
                    </p>
                    {latest ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Last sample
                        <br />
                        <time
                          dateTime={latest._time.toISOString()}
                          title={latest._time.toLocaleString()}
                        >
                          {latest._time.toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No reading
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {history.length > 1 && (
              <ResponsiveChart height={145}>
                {({ width, height }) => (
                  <TimeSeriesPlot
                    width={width}
                    height={height}
                    unit={temperature.length ? '°C' : '%'}
                    label={`${name} ${metric} history`}
                    showLegend={false}
                    series={[
                      {
                        name,
                        gapMs: 1800000,
                        points: history.map((row) => ({
                          time: row._time.getTime(),
                          value: row._value,
                        })),
                      },
                    ]}
                  />
                )}
              </ResponsiveChart>
            )}
          </div>
        );
      })}
      {readings.length > 0 && resource.isError && (
        <p role="status" className="text-xs text-muted-foreground">
          Readings could not be refreshed. Showing the last available samples.{' '}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void resource.refetch()}
          >
            Retry readings
          </Button>
        </p>
      )}
      {otherSensors.length > 0 && (
        <div className="space-y-2">
          {otherSensors.map((device) => (
            <LiveSensorRow
              key={getDeviceKey(device)}
              device={device}
              displayNames={displayNames}
            />
          ))}
        </div>
      )}
      {!readings.length && !sensors.length && (
        <p className="text-sm text-muted-foreground">
          No sensors assigned to this room.
        </p>
      )}
    </section>
  );
}
