import { useSensorHistory } from '@/hooks/useSensorHistory';
import { sensorHistoryFields } from '@/lib/sensorHistory';
import { TimeSeriesPlot } from './charts/TimeSeriesPlot';
import { ResponsiveChart } from './charts/ResponsiveChart';
import { Button } from './primitives/button';
import { Link } from 'react-router-dom';
export function SensorHistoryPanel({
  deviceKey,
  showLink = true,
}: {
  deviceKey: string;
  showLink?: boolean;
}) {
  const query = useSensorHistory(deviceKey);
  const fields = sensorHistoryFields(query.data ?? []);
  const latest = query.data?.[0];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Value history</h3>
        {showLink && (
          <Link
            className="text-xs text-primary hover:underline"
            to={
              '/config/sensor-history?sensor=' + encodeURIComponent(deviceKey)
            }
          >
            All sensor changes ↗
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {latest
          ? `Last changed ${new Date(Number(latest.changed_at_ms)).toLocaleString()}`
          : query.isPending
            ? 'Loading changes…'
            : query.isError
              ? 'History is unavailable.'
              : 'No recorded value changes yet.'}
      </p>
      {query.isError && (
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          History could not be refreshed
          {query.data?.length ? '; showing saved results.' : '.'}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {fields.map((field) => {
        const numeric = field.samples.every((s) => typeof s.value === 'number');
        const boolean = field.samples.every(
          (s) => typeof s.value === 'boolean',
        );
        const categories = [
          ...new Set(field.samples.map((s) => String(s.value))),
        ];
        const labels = numeric
          ? undefined
          : boolean
            ? { 0: 'Off', 1: 'On' }
            : Object.fromEntries(categories.map((name, i) => [i, name]));
        const points = field.samples.map((s) => ({
          time: s.time,
          value: numeric
            ? Number(s.value)
            : boolean
              ? s.value
                ? 1
                : 0
              : categories.indexOf(String(s.value)),
        }));
        if (!numeric && points.length)
          points.push({
            ...points.at(-1)!,
            time: Math.max(Date.now(), points.at(-1)!.time + 1),
          });
        return (
          <div
            key={field.name}
            className="rounded-lg border border-border bg-card p-2"
          >
            <p className="px-2 pt-1 text-xs font-medium">{field.name}</p>
            <ResponsiveChart height={170}>
              {({ width, height }) => (
                <TimeSeriesPlot
                  width={width}
                  height={height}
                  label={`${field.name} history`}
                  unit=""
                  valueLabels={labels}
                  showLegend={false}
                  showUnit={false}
                  series={[{ name: field.name, step: !numeric, points }]}
                />
              )}
            </ResponsiveChart>
          </div>
        );
      })}
    </section>
  );
}
