import type { ExecutionMode } from '@/bindings/ExecutionMode';
import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';
import { DurationInput } from '@/ui/builder-fields';
import { ConfigField } from '@/ui/config-form';
import { DraftNumberInput } from '@/ui/settings/DraftNumberInput';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';

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
  draftKey,
}: {
  policy: ExecutionPolicy | undefined;
  onChange: (policy: ExecutionPolicy) => void;
  draftKey: string;
}) {
  const current = { ...defaultExecutionPolicy, ...policy };
  const mode = modeOptions.find((option) => option.value === current.mode);
  const minIntervalMs =
    current.min_interval_ms === undefined
      ? undefined
      : Number(current.min_interval_ms);

  const update = (patch: Partial<ExecutionPolicy>) => {
    onChange({ ...policy, ...patch } as ExecutionPolicy);
  };

  return (
    <>
      <ConfigField
        label="Mode"
        description={
          mode?.description ??
          'This execution mode is unsupported. Its stored value is preserved until you choose another mode.'
        }
      >
        <SettingsSelect
          aria-label="Execution mode"
          value={current.mode}
          options={
            mode
              ? modeOptions
              : [
                  ...modeOptions,
                  {
                    value: current.mode,
                    label: `Unsupported mode: ${current.mode}`,
                  },
                ]
          }
          onValueChange={(mode) => update({ mode: mode as ExecutionMode })}
        />
      </ConfigField>

      <ConfigField
        label="Max actions"
        description="Upper bound on dispatched actions per invocation (1-64). Runs that would dispatch more are rejected whole."
        className="max-w-xs"
      >
        <DraftNumberInput
          aria-label="Max actions"
          draftKey={draftKey}
          path="execution/max_actions"
          value={current.max_actions}
          validate={(value) =>
            Number.isInteger(value) && value >= 1 && value <= 64
              ? undefined
              : 'Enter a whole number from 1 to 64.'
          }
          onValueChange={(max_actions) => update({ max_actions })}
        />
      </ConfigField>

      <ConfigField
        label="Minimum spacing"
        description="Optional rate limit between invocations. Leave empty for no minimum."
        className="max-w-xs"
      >
        <DurationInput
          label="Minimum spacing"
          draftKey={draftKey}
          path="execution/min_interval_ms"
          validate={(ms) =>
            ms === 0
              ? 'Use a positive duration, or leave empty for no minimum.'
              : undefined
          }
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
