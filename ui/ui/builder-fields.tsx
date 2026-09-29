import { Input } from '@/ui/primitives/input';
import { selectClassName } from '@/ui/form-styles';
import { useState } from 'react';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { entityDraftStore } from '@/lib/entityDraft';
import { parseDurationInput } from '@/lib/durationInput';

export { selectClassName };
export const durationUnits = [
  { value: 'seconds', factor: 1_000 },
  { value: 'minutes', factor: 60_000 },
  { value: 'hours', factor: 3_600_000 },
] as const;
export type DurationUnit = (typeof durationUnits)[number]['value'];
export function guessDurationUnit(ms: number | undefined): DurationUnit {
  if (ms === undefined) return 'minutes';
  if (ms % 3_600_000 === 0) return 'hours';
  if (ms % 60_000 === 0) return 'minutes';
  return 'seconds';
}
export function DurationInput({
  valueMs,
  onChange,
  placeholder,
  label = 'Duration',
  draftKey,
  path,
  required = false,
}: {
  valueMs: number | undefined;
  onChange: (ms: number | undefined) => void;
  placeholder?: string;
  label?: string;
  draftKey?: string;
  path?: string;
  required?: boolean;
}) {
  const [selectedUnit, setUnit] = useState<DurationUnit>(() =>
    guessDurationUnit(valueMs),
  );
  const input =
    draftKey && path
      ? entityDraftStore.get(draftKey)?.inputs?.[path]
      : undefined;
  const unit = durationUnits.some((entry) => entry.value === input?.unit)
    ? (input!.unit as DurationUnit)
    : selectedUnit;
  const factor = durationUnits.find((entry) => entry.value === unit)!.factor;
  const amount =
    input?.raw ?? (valueMs === undefined ? '' : String(valueMs / factor));
  const apply = (raw: string, nextUnit: DurationUnit) => {
    const result = parseDurationInput(
      raw,
      durationUnits.find((entry) => entry.value === nextUnit)!.factor,
      required,
    );
    if (draftKey && path)
      entityDraftStore.stageInput(draftKey, path, {
        raw,
        unit: nextUnit,
        error: result.error ? `${label}: ${result.error}` : undefined,
      });
    if (!result.error) onChange(result.value);
  };
  const errorId = path
    ? `duration-error-${encodeURIComponent(path)}`
    : undefined;
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 gap-2">
        <Input
          className="min-w-0 flex-1"
          type={draftKey && path ? 'text' : 'number'}
          inputMode="decimal"
          min={0}
          step="any"
          aria-label={label}
          data-field={path}
          aria-invalid={Boolean(input?.error)}
          aria-describedby={input?.error ? errorId : undefined}
          value={amount}
          placeholder={placeholder}
          onChange={(event) => apply(event.target.value, unit)}
        />
        <SettingsSelect
          className="w-auto shrink-0"
          aria-label={`${label} unit`}
          value={unit}
          onValueChange={(next) => {
            const nextUnit = next as DurationUnit;
            setUnit(nextUnit);
            if (draftKey && path) {
              if (input?.error) apply(input.raw, nextUnit);
              else
                entityDraftStore.stageInput(draftKey, path, {
                  raw:
                    valueMs === undefined
                      ? ''
                      : String(
                          valueMs /
                            durationUnits.find(
                              (entry) => entry.value === nextUnit,
                            )!.factor,
                        ),
                  unit: nextUnit,
                });
            }
          }}
          options={durationUnits.map((entry) => ({
            value: entry.value,
            label: entry.value,
          }))}
        />
      </div>
      {input?.error && (
        <p id={errorId} className="text-xs text-destructive">
          {input.error}
        </p>
      )}
    </div>
  );
}
