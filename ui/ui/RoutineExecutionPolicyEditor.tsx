import type { ExecutionMode } from '@/bindings/ExecutionMode';
import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';
import { DurationInput, selectClassName } from '@/ui/builder-fields';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';

export const defaultExecutionPolicy: ExecutionPolicy = {
  mode: 'queued',
  max_actions: 16,
};

const modeOptions: Array<{
  value: ExecutionMode;
  label: string;
  description: string;
}> = [
  {
    value: 'queued',
    label: 'Queue (default)',
    description:
      'Invocations run in arrival order. The pending queue is bounded; overflow is rejected visibly.',
  },
  {
    value: 'single',
    label: 'Reject while pending',
    description:
      'A new invocation is rejected while a previous one is still pending or running.',
  },
  {
    value: 'restart',
    label: 'Restart',
    description:
      'A new invocation supersedes pending ones; only the newest run finishes.',
  },
];

export function RoutineExecutionPolicyEditor({
  policy,
  onChange,
}: {
  policy: ExecutionPolicy | undefined;
  onChange: (policy: ExecutionPolicy) => void;
}) {
  const current = policy ?? defaultExecutionPolicy;
  const mode =
    modeOptions.find((option) => option.value === current.mode) ??
    modeOptions[0];
  const minIntervalMs =
    current.min_interval_ms === undefined
      ? undefined
      : Number(current.min_interval_ms);

  const update = (patch: Partial<ExecutionPolicy>) => {
    onChange({ ...current, ...patch });
  };

  return (
    <>
      <ConfigField label="Mode" description={mode.description}>
        <select
          className={selectClassName}
          value={current.mode}
          onChange={(event) =>
            update({ mode: event.target.value as ExecutionMode })
          }
        >
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ConfigField>

      <ConfigField
        label="Max actions"
        description="Upper bound on dispatched actions per invocation (1-64). Runs that would dispatch more are rejected whole."
        className="max-w-xs"
      >
        <Input
          type="number"
          min={1}
          max={64}
          value={current.max_actions}
          onChange={(event) => {
            const parsed = event.target.valueAsNumber;
            update({
              max_actions: Number.isNaN(parsed)
                ? defaultExecutionPolicy.max_actions
                : Math.min(64, Math.max(1, Math.round(parsed))),
            });
          }}
        />
      </ConfigField>

      <ConfigField
        label="Minimum spacing"
        description="Optional rate limit between invocations. Leave empty for no minimum."
        className="max-w-xs"
      >
        <DurationInput
          valueMs={minIntervalMs}
          placeholder="No minimum"
          onChange={(ms) =>
            update({
              min_interval_ms:
                ms === undefined ? undefined : (ms as unknown as bigint),
            })
          }
        />
      </ConfigField>
    </>
  );
}
