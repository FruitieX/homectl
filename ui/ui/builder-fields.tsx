import { Input } from '@/ui/primitives/input';
import { selectClassName } from '@/ui/form-styles';
import { useState } from 'react';

export { selectClassName };

export const durationUnits = [
  { value: 'seconds', factor: 1_000 },
  { value: 'minutes', factor: 60_000 },
  { value: 'hours', factor: 3_600_000 },
] as const;

export type DurationUnit = (typeof durationUnits)[number]['value'];

export function guessDurationUnit(ms: number | undefined): DurationUnit {
  if (ms === undefined) {
    return 'minutes';
  }
  if (ms % 3_600_000 === 0) {
    return 'hours';
  }
  if (ms % 60_000 === 0) {
    return 'minutes';
  }
  return 'seconds';
}

export function DurationInput({
  valueMs,
  onChange,
  placeholder,
}: {
  valueMs: number | undefined;
  onChange: (ms: number | undefined) => void;
  placeholder?: string;
}) {
  const [unit, setUnit] = useState<DurationUnit>(() =>
    guessDurationUnit(valueMs),
  );
  const factor = durationUnits.find((entry) => entry.value === unit)!.factor;
  const amount =
    valueMs === undefined
      ? ''
      : String(Math.round((valueMs / factor) * 1000) / 1000);

  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min={0}
        step="any"
        value={amount}
        placeholder={placeholder}
        onChange={(event) => {
          if (event.target.value === '') {
            onChange(undefined);
            return;
          }
          const parsed = event.target.valueAsNumber;
          onChange(Number.isNaN(parsed) ? undefined : parsed * factor);
        }}
      />
      <select
        className={selectClassName}
        value={unit}
        onChange={(event) => setUnit(event.target.value as DurationUnit)}
      >
        {durationUnits.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.value}
          </option>
        ))}
      </select>
    </div>
  );
}
