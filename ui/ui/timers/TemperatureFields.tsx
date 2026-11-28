import type { Device } from '@/bindings/Device';
import type { HeatingModel } from '@/bindings/HeatingModel';
import type { ReadyByTemperature } from '@/bindings/ReadyByTemperature';
import { useDevicesState } from '@/hooks/websocket';
import { Input } from '@/ui/primitives/input';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { Field } from './Field';

/** Numeric readings of a sensor, by reading name. */
export function numericReadings(device?: Device): Record<string, number> {
  if (!device || !('Sensor' in device.data)) return {};
  const sensor = device.data.Sensor;
  if ('readings' in sensor)
    return Object.fromEntries(
      Object.entries(sensor.readings).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
  if ('value' in sensor && typeof sensor.value === 'number')
    return { value: sensor.value };
  return {};
}

export function readingValue(
  devices: Record<string, Device | undefined> | null | undefined,
  t: Pick<ReadyByTemperature, 'sensor_key' | 'reading'>,
): number | undefined {
  const readings = numericReadings(devices?.[t.sensor_key]);
  return readings[t.reading] ?? readings.value;
}

export function formatRate(model: HeatingModel) {
  return `${model.rate_per_minute.toFixed(2)} °C/min after ${Math.round(model.lag_minutes)} min`;
}

export function TemperatureFields({
  value,
  change,
  model,
}: {
  value?: ReadyByTemperature;
  change: (value?: ReadyByTemperature) => void;
  model?: HeatingModel;
}) {
  const devices = useDevicesState();
  const sensors = Object.entries(devices ?? {}).flatMap(([key, device]) =>
    Object.entries(numericReadings(device)).map(([reading, current]) => ({
      value: `${key}|${reading}`,
      label: `${device!.name} · ${reading} (${current})`,
    })),
  );
  // Single-value sensors list their value as `value`, whatever was stored.
  const single =
    value && 'value' in numericReadings(devices?.[value.sensor_key]);
  const selected = value
    ? `${value.sensor_key}|${single ? 'value' : value.reading}`
    : '';
  const current = value ? readingValue(devices, value) : undefined;
  return (
    <div className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            change(
              e.target.checked
                ? {
                    sensor_key: '',
                    reading: 'temperature',
                    target: 5,
                    max_warmup_minutes: 150,
                  }
                : undefined,
            )
          }
        />
        Warm up to a temperature
      </label>
      {value && (
        <>
          <p className="text-xs text-muted-foreground">
            The start time follows the sensor: colder means an earlier start,
            and no warm-up runs when it is already warm enough. The warm-up rate
            is learned from the device’s own runs.
          </p>
          <Field label="Temperature sensor">
            <SettingsSelect
              aria-label="Temperature sensor"
              value={selected}
              onValueChange={(v) => {
                const at = v.lastIndexOf('|');
                change({
                  ...value,
                  sensor_key: v.slice(0, at),
                  reading: v.slice(at + 1),
                });
              }}
              options={[
                ...(selected && !sensors.some((o) => o.value === selected)
                  ? [{ value: selected, label: `Unavailable · ${selected}` }]
                  : []),
                ...sensors,
              ]}
              placeholder="Choose a sensor"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Target temperature (°C)">
              <Input
                type="number"
                step={0.5}
                min={-40}
                max={60}
                value={Number.isFinite(value.target) ? value.target : ''}
                onChange={(e) =>
                  change({ ...value, target: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Longest warm-up (minutes)">
              <Input
                type="number"
                min={1}
                max={10080}
                value={value.max_warmup_minutes || ''}
                onChange={(e) =>
                  change({
                    ...value,
                    max_warmup_minutes: Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {current !== undefined && `Now ${current} °C. `}
            {model && model.runs > 0
              ? `Learned ${formatRate(model)} from ${model.runs} run${model.runs === 1 ? '' : 's'}.`
              : 'No runs learned yet; assumes a slow 0.15 °C/min after 10 min until the first run.'}
          </p>
        </>
      )}
    </div>
  );
}
