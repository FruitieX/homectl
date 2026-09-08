import { Droplets, Thermometer } from 'lucide-react';
import type { SensorDataRow } from '@/hooks/influxdb';
import {
  calculateHumidityStats,
  calculateTemperatureStats,
  getTrendIcon,
  type SensorTrend,
} from '@/lib/sensorStats';
import { isOffline } from '@/lib/sensorStats';
import { cn } from '@/lib/cn';

const trendLabel = (trend: SensorTrend) =>
  ({
    up: 'Rising',
    down: 'Falling',
    stable: 'Steady',
    unknown: 'Not enough recent data',
  })[trend];

export function SensorChip({
  sensor,
  now,
  checked,
  onCheckedChange,
  onOpen,
}: {
  sensor: SensorDataRow;
  now?: number;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onOpen?: () => void;
}) {
  const current = now ?? Date.now();
  const temp = calculateTemperatureStats(sensor.temp_data, current);
  const humidity = calculateHumidityStats(sensor.humidity_data, current);
  const content = (
    <>
      <div className="mb-2 truncate text-xs font-medium">
        {sensor.device_name}
      </div>
      <div className="flex items-center gap-1.5 text-sm tabular-nums">
        <Thermometer className="size-3.5 shrink-0 text-muted-foreground" />
        {sensor.latest_temp === undefined ||
        isOffline(sensor.latest_temp_time, 15, current)
          ? '—'
          : `${sensor.latest_temp.toFixed(1)}°`}
        <span
          className="text-xs text-muted-foreground"
          aria-label={temp ? trendLabel(temp.trend) : undefined}
        >
          {temp ? getTrendIcon(temp.trend) : null}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-sm tabular-nums">
        <Droplets className="size-3.5 shrink-0 text-muted-foreground" />
        {sensor.latest_humidity === undefined ||
        isOffline(sensor.latest_humidity_time, 15, current)
          ? '—'
          : `${sensor.latest_humidity.toFixed(0)}%`}
        <span
          className="text-xs text-muted-foreground"
          aria-label={humidity ? trendLabel(humidity.trend) : undefined}
        >
          {humidity ? getTrendIcon(humidity.trend) : null}
        </span>
      </div>
    </>
  );
  const selectable = Boolean(onCheckedChange);
  const toggle = () => onCheckedChange?.(!checked);
  return (
    <div
      className={cn(
        'relative min-w-28 rounded-xl border border-border/50 p-[var(--widget-tile-padding,0.75rem)]',
        selectable && 'cursor-pointer transition hover:border-primary/60',
      )}
      onClick={selectable ? toggle : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
              }
            }
          : undefined
      }
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable ? checked : undefined}
    >
      {onCheckedChange && (
        <input
          type="checkbox"
          aria-label={`Show ${sensor.device_name}`}
          className="absolute left-2 top-2 z-10 size-4 accent-primary"
          checked={checked}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
      )}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn('w-full text-left', onCheckedChange && 'pl-5')}
        >
          {content}
        </button>
      ) : (
        <div className={onCheckedChange ? 'pl-5' : undefined}>{content}</div>
      )}
    </div>
  );
}
