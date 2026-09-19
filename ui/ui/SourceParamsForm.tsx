import type { DeviceColor } from '@/bindings/DeviceColor';
import { ConfigField, ConfigFormGrid } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import { SourceColorField } from '@/ui/SourceColorField';

export interface SourceCircadianParams {
  day_fade_start: string;
  day_fade_duration_hours: number;
  day_color: DeviceColor;
  day_brightness?: number | null;
  night_fade_start: string;
  night_fade_duration_hours: number;
  night_color: DeviceColor;
  night_brightness?: number | null;
}

export const DEFAULT_CIRCADIAN_PARAMS: SourceCircadianParams = {
  day_fade_start: '06:00',
  day_fade_duration_hours: 2,
  day_color: { ct: 3000 },
  day_brightness: 0.8,
  night_fade_start: '20:00',
  night_fade_duration_hours: 2,
  night_color: { ct: 2000 },
  night_brightness: 0.2,
};

export function circadianParamsFromJson(value: unknown): SourceCircadianParams {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_CIRCADIAN_PARAMS };
  }
  const record = value as Record<string, unknown>;
  const color = (candidate: unknown, fallback: DeviceColor): DeviceColor => {
    if (candidate && typeof candidate === 'object') {
      const entry = candidate as Record<string, unknown>;
      if (typeof entry.ct === 'number') return { ct: entry.ct };
      if (typeof entry.h === 'number' && typeof entry.s === 'number') {
        return { h: entry.h, s: entry.s };
      }
    }
    return fallback;
  };
  const brightness = (candidate: unknown): number | null => {
    if (typeof candidate === 'number') return candidate;
    return null;
  };
  return {
    day_fade_start:
      typeof record.day_fade_start === 'string'
        ? record.day_fade_start
        : DEFAULT_CIRCADIAN_PARAMS.day_fade_start,
    day_fade_duration_hours:
      typeof record.day_fade_duration_hours === 'number'
        ? record.day_fade_duration_hours
        : DEFAULT_CIRCADIAN_PARAMS.day_fade_duration_hours,
    day_color: color(record.day_color, DEFAULT_CIRCADIAN_PARAMS.day_color),
    day_brightness: brightness(record.day_brightness),
    night_fade_start:
      typeof record.night_fade_start === 'string'
        ? record.night_fade_start
        : DEFAULT_CIRCADIAN_PARAMS.night_fade_start,
    night_fade_duration_hours:
      typeof record.night_fade_duration_hours === 'number'
        ? record.night_fade_duration_hours
        : DEFAULT_CIRCADIAN_PARAMS.night_fade_duration_hours,
    night_color: color(record.night_color, DEFAULT_CIRCADIAN_PARAMS.night_color),
    night_brightness: brightness(record.night_brightness),
  };
}

export function circadianParamsToJson(params: SourceCircadianParams) {
  const output: Record<string, unknown> = {
    day_fade_start: params.day_fade_start,
    day_fade_duration_hours: params.day_fade_duration_hours,
    day_color: params.day_color,
    night_fade_start: params.night_fade_start,
    night_fade_duration_hours: params.night_fade_duration_hours,
    night_color: params.night_color,
  };
  if (params.day_brightness != null) {
    output.day_brightness = params.day_brightness;
  }
  if (params.night_brightness != null) {
    output.night_brightness = params.night_brightness;
  }
  return output;
}

function BrightnessField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          checked={value != null}
          className="size-4 rounded border border-input accent-primary"
          type="checkbox"
          onChange={(event) =>
            onChange(event.target.checked ? 0.5 : null)
          }
        />
        <span className="text-sm font-medium">{label}</span>
      </label>
      {value != null ? (
        <Input
          max={1}
          min={0}
          step={0.05}
          type="number"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Absent on one end keeps the published profile without brightness.
        </p>
      )}
    </div>
  );
}

export function SourceParamsForm({
  params,
  onChange,
}: {
  params: SourceCircadianParams;
  onChange: (params: SourceCircadianParams) => void;
}) {
  return (
    <div className="space-y-5">
      <ConfigFormGrid>
        <ConfigField
          label="Day fade start"
          description="Local HH:MM when the night-to-day fade starts."
        >
          <Input
            type="time"
            value={params.day_fade_start}
            onChange={(event) =>
              onChange({ ...params, day_fade_start: event.target.value })
            }
          />
        </ConfigField>
        <ConfigField
          label="Day fade duration (hours)"
          description="Whole hours; must not cross midnight or overlap the night fade."
        >
          <Input
            max={24}
            min={1}
            type="number"
            value={params.day_fade_duration_hours}
            onChange={(event) =>
              onChange({
                ...params,
                day_fade_duration_hours: Number(event.target.value),
              })
            }
          />
        </ConfigField>
        <BrightnessField
          label="Day brightness"
          value={params.day_brightness ?? null}
          onChange={(day_brightness) => onChange({ ...params, day_brightness })}
        />
      </ConfigFormGrid>

      <SourceColorField
        label="Day color"
        color={params.day_color}
        onChange={(day_color) => onChange({ ...params, day_color })}
      />

      <ConfigFormGrid>
        <ConfigField
          label="Night fade start"
          description="Local HH:MM when the day-to-night fade starts."
        >
          <Input
            type="time"
            value={params.night_fade_start}
            onChange={(event) =>
              onChange({ ...params, night_fade_start: event.target.value })
            }
          />
        </ConfigField>
        <ConfigField
          label="Night fade duration (hours)"
          description="Whole hours; must not cross midnight."
        >
          <Input
            max={24}
            min={1}
            type="number"
            value={params.night_fade_duration_hours}
            onChange={(event) =>
              onChange({
                ...params,
                night_fade_duration_hours: Number(event.target.value),
              })
            }
          />
        </ConfigField>
        <BrightnessField
          label="Night brightness"
          value={params.night_brightness ?? null}
          onChange={(night_brightness) =>
            onChange({ ...params, night_brightness })
          }
        />
      </ConfigFormGrid>

      <SourceColorField
        label="Night color"
        color={params.night_color}
        onChange={(night_color) => onChange({ ...params, night_color })}
      />
    </div>
  );
}
