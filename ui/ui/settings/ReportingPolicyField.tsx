import type { ReportingPolicy } from '@/bindings/ReportingPolicy';
import { entityDraftStore } from '@/lib/entityDraft';
import { Input } from '@/ui/primitives/input';
export function ReportingPolicyField({
  value,
  onChange,
  scope = 'device',
  draftKey,
}: {
  value: ReportingPolicy;
  onChange: (value: ReportingPolicy) => void;
  scope?: 'device' | 'integration';
  draftKey: string;
}) {
  return (
    <div className="space-y-3">
      <label className="grid gap-2 text-xs">
        Missing-report warnings
        <select
          data-field="reporting_policy"
          aria-label="Missing-report warnings"
          className="settings-select"
          value={value.mode}
          onChange={(event) => {
            const mode = event.target.value as ReportingPolicy['mode'];
            const fallback: ReportingPolicy =
              mode === 'custom'
                ? { mode, expected_interval_seconds: 1800 }
                : { mode };
            onChange(
              entityDraftStore.switchVariant(
                draftKey,
                'reporting-policy',
                value.mode,
                value,
                mode,
                fallback,
              ),
            );
          }}
        >
          <option value="inherit">
            {scope === 'device'
              ? 'Use integration default'
              : 'Use integration behavior'}
          </option>
          <option value="custom">Expect regular reports</option>
          <option value="ignore">Ignore missing reports</option>
        </select>
      </label>
      {value.mode === 'custom' && (
        <label className="grid gap-2 text-xs">
          Expected reporting interval (seconds)
          <Input
            aria-label="Expected reporting interval (seconds)"
            type="number"
            min={1}
            max={31536000}
            step={1}
            value={value.expected_interval_seconds}
            onChange={(event) =>
              onChange({
                ...value,
                expected_interval_seconds: Number(event.target.value),
              })
            }
          />
          <span className="text-muted-foreground">
            {value.expected_interval_seconds >= 60
              ? `${Math.round((value.expected_interval_seconds / 60) * 10) / 10} minutes. `
              : ''}
            A small scheduling grace is added before warning.
          </span>
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {scope === 'integration'
          ? 'Applies to devices that inherit this default. Battery sensors and buttons may report only when they change. '
          : ''}
        Ignore only suppresses silence warnings. Explicit offline signals and
        configuration problems stay visible.
      </p>
    </div>
  );
}
export function reportingPolicyError(value: ReportingPolicy): string | null {
  return value.mode === 'custom' &&
    (!Number.isInteger(value.expected_interval_seconds) ||
      value.expected_interval_seconds < 1 ||
      value.expected_interval_seconds > 31536000)
    ? 'Expected reporting interval must be between one second and one year.'
    : null;
}
