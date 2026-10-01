import type { HelperDefinition } from '@/bindings/HelperDefinition';
import { useDevicesState } from '@/hooks/websocket';
import { useGroupsState } from '@/hooks/useDevicesApi';
import { useHelpers } from '@/hooks/useConfig';
import { ScriptConfiguration, newScript } from '@/ui/ScriptConfiguration';
import { ReusePreview } from '@/ui/ReusePreview';
import { ConfigField } from '@/ui/config-form';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { DraftNumberInput } from '@/ui/settings/DraftNumberInput';
import { entityDraftStore } from '@/lib/entityDraft';
import { stringifyConfig } from '@/lib/routineDraft';
import { SearchableMultiPicker } from '@/ui/SearchablePicker';

export function ComputedHelperFields({
  value,
  onChange,
  draftKey,
}: {
  value: HelperDefinition;
  onChange: (value: HelperDefinition) => void;
  draftKey: string;
}) {
  const devices = useDevicesState() ?? {},
    groups = useGroupsState() ?? {},
    helpers = useHelpers();
  const compute = value.compute;
  return (
    <div className="space-y-4">
      <ConfigField label="Value source">
        <SettingsSelect
          aria-label="Helper value source"
          value={compute ? 'computed' : 'manual'}
          options={[
            {
              value: 'manual',
              label: 'Manual value — changed by controls or routines',
            },
            {
              value: 'computed',
              label: 'Computed value — read-only JavaScript calculation',
            },
          ]}
          onValueChange={(mode) =>
            onChange({
              ...value,
              compute: entityDraftStore.switchVariant(
                draftKey,
                'compute',
                compute ? 'computed' : 'manual',
                compute,
                mode,
                mode === 'computed'
                  ? {
                      script: {
                        ...newScript('helper'),
                        source_body: `return ${stringifyConfig(value.initial_value)};`,
                      },
                      helpers: [],
                      refresh_ms: 60000n,
                      enabled: true,
                      revision: 1n,
                    }
                  : undefined,
              ),
            })
          }
        />
      </ConfigField>
      {compute && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigField label="Computation">
              <SettingsSelect
                aria-label="Enable helper computation"
                value={compute.enabled ? 'enabled' : 'disabled'}
                options={[
                  { value: 'enabled', label: 'Enabled' },
                  { value: 'disabled', label: 'Disabled' },
                ]}
                onValueChange={(enabled) =>
                  onChange({
                    ...value,
                    compute: { ...compute, enabled: enabled === 'enabled' },
                  })
                }
              />
            </ConfigField>
            <ConfigField
              label="Refresh every (seconds)"
              description="Also updates when declared inputs change."
            >
              <DraftNumberInput
                aria-label="Helper refresh seconds"
                draftKey={draftKey}
                path="compute/refresh_ms"
                validate={(seconds) =>
                  seconds >= 1 && seconds <= 86400
                    ? undefined
                    : 'Use 1–86,400 seconds.'
                }
                value={Number(compute.refresh_ms) / 1000}
                onValueChange={(seconds) => {
                  if (
                    seconds !== undefined &&
                    Number.isFinite(seconds) &&
                    seconds >= 1 &&
                    seconds <= 86400
                  )
                    onChange({
                      ...value,
                      compute: {
                        ...compute,
                        refresh_ms: BigInt(Math.round(seconds * 1000)),
                      },
                    });
                }}
              />
            </ConfigField>
          </div>
          <ConfigField
            label="Helper dependencies"
            description="Only these helper values are available through api.values.get(id). Cycles are rejected."
          >
            <SearchableMultiPicker
              options={helpers.data
                .filter((helper) => helper.id !== value.id)
                .map((helper) => ({ value: helper.id, label: helper.name }))}
              value={compute.helpers}
              onChange={(dependencies) =>
                onChange({
                  ...value,
                  compute: { ...compute, helpers: dependencies },
                })
              }
              hrefFor={(id) => `/config/helpers/${encodeURIComponent(id)}`}
            />
          </ConfigField>
          <ScriptConfiguration
            spec={compute.script}
            contract="helper"
            devices={devices}
            groups={groups}
            onChange={(script) =>
              onChange({ ...value, compute: { ...compute, script } })
            }
          />
          <ReusePreview request={{ kind: 'helper', helper: value }} />
        </>
      )}
    </div>
  );
}
