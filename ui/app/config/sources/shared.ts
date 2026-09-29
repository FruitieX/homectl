import type { SourceConfig, SourceComputeConfig } from '@/hooks/useConfig';
import type { FieldError } from '@/lib/configSection';
export const sourceDefaults = (): SourceConfig => ({
  id: '',
  name: '',
  enabled: true,
  revision: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  refresh_interval_ms: 60000,
  aliases: [],
  compute: {
    kind: 'circadian_compat',
    preset_version: 1,
    params: {
      day_fade_start: '06:00',
      day_fade_duration_hours: 2,
      day_color: { ct: 3000 },
      day_brightness: 0.8,
      night_fade_start: '20:00',
      night_fade_duration_hours: 2,
      night_color: { ct: 2000 },
      night_brightness: 0.2,
    },
  },
});
export const computationLabel = (compute: SourceComputeConfig) =>
  compute.kind === 'circadian_compat'
    ? 'Circadian'
    : compute.preset
      ? `${compute.preset.id} · v${compute.preset.version}`
      : 'Custom script';
export const computationKey = (compute: SourceComputeConfig) =>
  compute.kind === 'circadian_compat'
    ? compute.preset_version === 1
      ? 'circadian_compat'
      : `circadian_compat@${compute.preset_version}`
    : compute.preset
      ? `${compute.preset.id}@${compute.preset.version}`
      : 'custom';
export function validateSourceDraft(source: SourceConfig): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of ['id', 'name', 'timezone'] as const)
    if (!source[field].trim())
      errors.push({ field, message: `Enter a ${field}.` });
  if (
    !Number.isInteger(source.refresh_interval_ms) ||
    source.refresh_interval_ms < 1000 ||
    source.refresh_interval_ms > 86400000
  )
    errors.push({
      field: 'refresh_interval_ms',
      message: 'Refresh interval must be between 1 second and 24 hours.',
    });
  if (
    source.aliases !== undefined &&
    (!Array.isArray(source.aliases) ||
      source.aliases.some(
        (alias) =>
          typeof alias !== 'string' ||
          !/^\S+\/\S+$/.test(alias) ||
          alias.split('/').length !== 2,
      ))
  )
    errors.push({
      field: 'aliases',
      message: 'Each alias needs an integration/device key.',
    });
  if (
    Array.isArray(source.aliases) &&
    new Set(source.aliases).size !== source.aliases.length
  )
    errors.push({ field: 'aliases', message: 'Each alias must be unique.' });
  if (
    source.compute.kind === 'script' &&
    ((source.compute.preset != null) === (source.compute.source_body != null) ||
      (source.compute.source_body != null &&
        (typeof source.compute.source_body !== 'string' ||
          !source.compute.source_body.trim())))
  )
    errors.push({
      field: 'compute',
      message: 'Choose a preset or enter a custom script.',
    });
  return [...errors, ...validateSourceTiming(source.compute)];
}

export const sourceParamField = (compute: SourceComputeConfig, field: string) =>
  `source-compute/${encodeURIComponent(computationKey(compute))}/params/${field}`;

/** Timing contract shared by built-in circadian v1 and the pinned script preset. */
export function validateSourceTiming(
  compute: SourceComputeConfig,
): FieldError[] {
  const known =
    compute.kind === 'circadian_compat'
      ? compute.preset_version === 1
      : compute.preset?.id === 'circadian' && compute.preset.version === 1;
  if (!known) return [];
  const params = compute.params;
  if (!params || typeof params !== 'object' || Array.isArray(params))
    return [
      { field: 'compute', message: 'Circadian parameters must be an object.' },
    ];
  const values = params as Record<string, unknown>;
  const errors: FieldError[] = [];
  const starts: Record<string, number> = {};
  const ends: Record<string, number> = {};
  for (const period of ['day', 'night']) {
    const start = values[`${period}_fade_start`],
      duration = values[`${period}_fade_duration_hours`],
      brightness = values[`${period}_brightness`];
    if (typeof start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start))
      errors.push({
        field: sourceParamField(compute, `${period}_fade_start`),
        message: `Choose a ${period} fade start in HH:MM format.`,
      });
    else
      starts[period] = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
    if (
      typeof duration !== 'number' ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 24
    )
      errors.push({
        field: sourceParamField(compute, `${period}_fade_duration_hours`),
        message: `The ${period} fade needs 1–24 whole hours.`,
      });
    else if (starts[period] !== undefined) {
      ends[period] = starts[period] + duration * 60;
      if (ends[period] >= 1440)
        errors.push({
          field: sourceParamField(compute, `${period}_fade_duration_hours`),
          message: `The ${period} fade must finish before midnight.`,
        });
    }
    if (
      brightness != null &&
      (typeof brightness !== 'number' ||
        !Number.isFinite(brightness) ||
        brightness < 0 ||
        brightness > 1)
    )
      errors.push({
        field: sourceParamField(compute, `${period}_brightness`),
        message: `The ${period} brightness must be between 0 and 100%.`,
      });
  }
  if (
    ends.day !== undefined &&
    ends.day < 1440 &&
    starts.night !== undefined &&
    ends.day > starts.night
  )
    errors.push({
      field: sourceParamField(compute, 'night_fade_start'),
      message: 'The night fade must start after the day fade finishes.',
    });
  return errors;
}
