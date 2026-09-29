import type { ComponentProps } from 'react';
import { entityDraftStore } from '@/lib/entityDraft';
import { Input } from '@/ui/primitives/input';

/** Keep unfinished text in the session draft; only complete numbers enter configuration. */
export function DraftNumberInput({
  value,
  onValueChange,
  draftKey,
  path,
  optional = false,
  validate,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined;
  onValueChange: (value: number | undefined) => void;
  draftKey: string;
  path: string;
  optional?: boolean;
  validate?: (value: number) => string | undefined;
}) {
  const input = entityDraftStore.get(draftKey)?.inputs?.[path];
  const errorId = `number-error-${encodeURIComponent(path)}`;
  return (
    <div className="min-w-0 space-y-1">
      <Input
        {...props}
        inputMode="decimal"
        data-field={path}
        value={input?.raw ?? (value == null ? '' : String(value))}
        aria-invalid={Boolean(input?.error)}
        aria-describedby={input?.error ? errorId : props['aria-describedby']}
        onChange={(event) => {
          const raw = event.target.value;
          const empty = raw.trim() === '';
          const valid =
            /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) &&
            Number.isFinite(Number(raw));
          const error =
            empty && optional
              ? undefined
              : !valid
                ? 'Enter a complete, finite number.'
                : validate?.(Number(raw));
          entityDraftStore.stageInput(draftKey, path, { raw, error });
          if (!error) onValueChange(empty ? undefined : Number(raw));
        }}
      />
      {input?.error && (
        <p id={errorId} className="text-xs text-destructive">
          {input.error}
        </p>
      )}
    </div>
  );
}
