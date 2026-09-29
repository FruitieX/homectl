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
    ? 'circadian_compat'
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
    (source.aliases ?? []).some(
      (alias) => !/^\S+\/\S+$/.test(alias) || alias.split('/').length !== 2,
    )
  )
    errors.push({
      field: 'aliases',
      message: 'Each alias needs an integration/device key.',
    });
  if (new Set(source.aliases).size !== (source.aliases ?? []).length)
    errors.push({ field: 'aliases', message: 'Each alias must be unique.' });
  if (
    source.compute.kind === 'script' &&
    Boolean(source.compute.preset) ===
      Boolean(source.compute.source_body?.trim())
  )
    errors.push({
      field: 'compute',
      message: 'Choose a preset or enter a custom script.',
    });
  return errors;
}
