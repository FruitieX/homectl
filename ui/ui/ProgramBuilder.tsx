import { BlockCallEditor } from '@/ui/BlockCallEditor';
import {
  Palette,
  Power,
  Timer,
  GitBranch,
  SlidersHorizontal,
  Play,
  Code2,
} from 'lucide-react';
import { DraftNumberInput } from '@/ui/settings/DraftNumberInput';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import {
  FlowBlock,
  AddFlowBlock,
  UnknownFlowValue,
  useRoutineAuthoring,
} from '@/ui/settings/FlowBlock';
import { createUuid } from '@/lib/uuid';
import {
  moveSibling,
  duplicateRoutineNode,
  isEditableSceneSelection,
} from '@/lib/routineDraft';
import { entityDraftStore, remapArrayEditorPath } from '@/lib/entityDraft';
import type { ChooseBranch } from '@/bindings/ChooseBranch';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { InvokeMode } from '@/bindings/InvokeMode';
import type { NativeAction } from '@/bindings/NativeAction';
import type { Program } from '@/bindings/Program';
import type { RolloutSpec } from '@/bindings/RolloutSpec';
import type { ScriptSpec } from '@/bindings/ScriptSpec';
import type { SceneSelection } from '@/bindings/SceneSelection';
import type { TargetSpec } from '@/bindings/TargetSpec';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { DurationInput } from '@/ui/builder-fields';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import {
  DeviceMultiSelect,
  DeviceSelect,
  GroupMultiSelect,
  GroupSelect,
  RoutineSelect,
  SceneSelect,
  ReferenceField,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { ConfigField } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SearchablePicker } from '@/ui/SearchablePicker';
import RoutineScriptEditor from '@/ui/RoutineScriptEditor';
import { RoutineScriptDeclarations } from '@/ui/RoutineScriptDeclarations';

type StepKind = NativeAction['action'];

const stepKindOptions: Array<{ value: StepKind; label: string }> = [
  { value: 'call_block', label: 'Run reusable block' },
  { value: 'activate_scene', label: 'Activate scene' },
  { value: 'cycle_scenes', label: 'Cycle scenes' },
  { value: 'set_power', label: 'Set device power' },
  { value: 'dim', label: 'Dim targets' },
  { value: 'randomize_color', label: 'Randomize colors' },
  { value: 'schedule_timer', label: 'Start named timer' },
  { value: 'replace_timer', label: 'Restart named timer' },
  { value: 'cancel_timer', label: 'Cancel named timer' },
  { value: 'set_helper', label: 'Set helper value' },
  { value: 'invoke_routine', label: 'Invoke another routine' },
  { value: 'choose', label: 'Choose a branch' },
  { value: 'run_script', label: 'Sandboxed script' },
];

function useStepKindOptions() {
  const { blockId } = useRoutineAuthoring();
  return blockId === undefined
    ? stepKindOptions
    : stepKindOptions.filter(
        (o) =>
          ![
            'schedule_timer',
            'replace_timer',
            'cancel_timer',
            'run_script',
            'invoke_routine',
          ].includes(o.value),
      );
}

function defaultStep(kind: StepKind, id: string): NativeAction {
  switch (kind) {
    case 'call_block':
      return { action: 'call_block', id, block_id: '', inputs: {} };
    case 'run_script':
      return {
        action: 'run_script',
        id,
        spec: {
          api_version: 1,
          source_body: 'return { actions: [] };',
          declarations: [],
          limits_profile: 'default',
        },
      };
    case 'activate_scene':
      return {
        action: 'activate_scene',
        id,
        scene_id: '',
        targets: {},
        use_scene_transition: true,
      };
    case 'cycle_scenes':
      return {
        action: 'cycle_scenes',
        id,
        scenes: [],
        nowrap: false,
        detection: {},
      };
    case 'set_power':
      return {
        action: 'set_power',
        id,
        device: { integration_id: '', device_id: '' },
        power: true,
      };
    case 'dim':
      return { action: 'dim', id, targets: {}, step: -0.1 };
    case 'randomize_color':
      return { action: 'randomize_color', id, targets: {} };
    case 'schedule_timer':
      return {
        action: 'schedule_timer',
        id,
        timer: '',
        delay_ms: 600_000,
      } as unknown as NativeAction;
    case 'replace_timer':
      return {
        action: 'replace_timer',
        id,
        timer: '',
        delay_ms: 600_000,
      } as unknown as NativeAction;
    case 'cancel_timer':
      return { action: 'cancel_timer', id, timer: '' };
    case 'set_helper':
      return { action: 'set_helper', id, helper: '', value: null };
    case 'invoke_routine':
      return {
        action: 'invoke_routine',
        id,
        routine_id: '',
        mode: 'fire_and_forget',
      };
    case 'choose':
      return { action: 'choose', id, branches: [] };
  }
}

function collectStepIds(steps: NativeAction[]): string[] {
  const ids: string[] = [];
  const visit = (step: NativeAction) => {
    if (!step || typeof step !== 'object') return;
    ids.push(step.id);
    if (step.action === 'choose' && Array.isArray(step.branches)) {
      for (const branch of step.branches) {
        for (const nested of Array.isArray(branch?.steps) ? branch.steps : []) {
          visit(nested);
        }
      }
    }
  };
  steps.forEach(visit);
  return ids;
}

function deviceRefKey(ref: { integration_id: string; device_id: string }) {
  return `${ref.integration_id}/${ref.device_id}`;
}

function keyToDeviceRef(key: string) {
  const split = splitDeviceKey(key);
  return split ?? { integration_id: '', device_id: key };
}

function TargetSpecEditor({
  targets = {},
  devices,
  groups,
  onChange,
  label = 'Targets',
  description = 'Devices and groups this step acts on.',
}: {
  targets: TargetSpec;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  onChange: (targets: TargetSpec) => void;
  label?: string;
  description?: string;
}) {
  const deviceKeys = (targets.devices ?? []).map(deviceRefKey);
  const groupIds = targets.groups ?? [];

  return (
    <div className="space-y-3">
      <ConfigField label={label} description={description}>
        <DeviceMultiSelect
          devices={devices}
          value={deviceKeys}
          onChange={(keys) =>
            onChange({
              ...targets,
              devices: keys.map(keyToDeviceRef),
            })
          }
        />
      </ConfigField>
      <ConfigField label="Groups">
        <GroupMultiSelect
          groups={groups}
          value={groupIds}
          onChange={(ids) => onChange({ ...targets, groups: ids })}
        />
      </ConfigField>
    </div>
  );
}

function HelperValueEditor({
  helper,
  value,
  onChange,
  path,
}: {
  helper: HelperRuntimeStatus | undefined;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  path: string;
}) {
  const { draftKey } = useRoutineAuthoring();
  if (!helper)
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Select an available helper to edit this value.
        </p>
        <pre className="whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(value)}
        </pre>
      </div>
    );
  const kind = helper.kind;
  const compatible =
    kind.kind === 'enum'
      ? typeof value === 'string'
      : typeof value === kind.kind;
  if (!compatible)
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">
          The stored value does not match this helper's type.
        </p>
        <pre className="whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(value)}
        </pre>
        <Button
          variant="outline"
          onClick={() => onChange(helperDefaultValue(helper))}
        >
          Use a {kind.kind} value
        </Button>
      </div>
    );
  switch (kind.kind) {
    case 'boolean':
      return (
        <SettingsSelect
          aria-label="Helper value"
          value={value === true ? 'true' : 'false'}
          onValueChange={(next) => onChange(next === 'true')}
          options={[
            { value: 'true', label: 'On / true' },
            { value: 'false', label: 'Off / false' },
          ]}
        />
      );
    case 'number':
      return draftKey ? (
        <DraftNumberInput
          aria-label="Helper value"
          draftKey={draftKey}
          path={path}
          value={value as number}
          validate={(number) =>
            (kind.min !== undefined && number < kind.min) ||
            (kind.max !== undefined && number > kind.max)
              ? 'Enter a number within the configured bounds.'
              : undefined
          }
          onValueChange={(number) => onChange(number!)}
        />
      ) : (
        <Input
          aria-label="Helper value"
          type="number"
          step="any"
          value={value as number}
          onChange={(event) => {
            if (Number.isFinite(event.target.valueAsNumber))
              onChange(event.target.valueAsNumber);
          }}
        />
      );
    case 'enum':
      return (
        <SearchablePicker
          ariaLabel="Helper value"
          clearable={false}
          options={kind.options.map((option) => ({
            value: option,
            label: option,
          }))}
          value={value as string}
          onChange={onChange}
          placeholder="Select value…"
        />
      );
    case 'string':
      return (
        <Input
          aria-label="Helper value"
          value={value as string}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function helperDefaultValue(
  helper: HelperRuntimeStatus | undefined,
): JsonValue {
  if (!helper) {
    return null;
  }
  switch (helper.kind.kind) {
    case 'boolean':
      return false;
    case 'number':
      return Math.min(
        helper.kind.max ?? Infinity,
        Math.max(helper.kind.min ?? -Infinity, 0),
      );
    case 'enum':
      return helper.kind.options[0] ?? '';
    case 'string':
      return '';
  }
}

function ChooseStepEditor({
  step,
  onChange,
  devices,
  groups,
  scenes,
  routines,
  helpers,
  existingIds,
}: {
  step: Extract<NativeAction, { action: 'choose' }>;
  onChange: (step: NativeAction) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  existingIds: string[];
}) {
  const { draftKey } = useRoutineAuthoring();
  const allowedStepKinds = useStepKindOptions();
  const updateBranch = (index: number, branch: ChooseBranch) =>
    onChange({
      ...step,
      branches: step.branches.map((entry, i) => (i === index ? branch : entry)),
    });
  return (
    <div className="flow-branches">
      <p className="text-xs text-muted-foreground">
        Check branches in order; run the first match. Unknown conditions block
        later branches.
      </p>
      {step.branches.map((branch, index) => (
        <FlowBlock
          key={branch.id}
          className="flow-branch"
          id={branch.id}
          title={index === 0 ? 'If' : 'Otherwise, if'}
          index={index}
          total={step.branches.length}
          onMove={(offset) =>
            onChange({
              ...step,
              branches: moveSibling(step.branches, index, offset),
            })
          }
          onRemove={() => {
            if (draftKey) {
              const prefixes = [
                `step/${step.id}/choose/branch/${branch.id}`,
                ...collectStepIds(branch.steps).map((id) => `step/${id}`),
              ];
              entityDraftStore.remapEditorPaths(draftKey, (path) =>
                prefixes.some(
                  (prefix) => path === prefix || path.startsWith(prefix + '/'),
                )
                  ? null
                  : path,
              );
            }
            onChange({
              ...step,
              branches: step.branches.filter((_, i) => i !== index),
            });
          }}
        >
          <ConditionEditor
            path={`step/${step.id}/choose/branch/${branch.id}/condition`}
            condition={branch.condition}
            onChange={(condition) =>
              updateBranch(index, { ...branch, condition })
            }
            devices={devices}
            groups={groups}
            scenes={scenes}
            helpers={helpers}
          />
          <div className="flow-branch-actions">
            <p className="mb-2 text-xs font-medium">Then</p>
            {branch.steps.map((nested, nestedIndex) => (
              <StepEditor
                key={nested.id}
                step={nested}
                index={nestedIndex}
                total={branch.steps.length}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                helpers={helpers}
                existingIds={existingIds}
                onChange={(next) =>
                  updateBranch(index, {
                    ...branch,
                    steps: branch.steps.map((entry, i) =>
                      i === nestedIndex ? next : entry,
                    ),
                  })
                }
                onRemove={() =>
                  updateBranch(index, {
                    ...branch,
                    steps: branch.steps.filter((_, i) => i !== nestedIndex),
                  })
                }
                onMove={(offset) =>
                  updateBranch(index, {
                    ...branch,
                    steps: moveSibling(branch.steps, nestedIndex, offset),
                  })
                }
                onDuplicate={() =>
                  updateBranch(index, {
                    ...branch,
                    steps: [
                      ...branch.steps.slice(0, nestedIndex + 1),
                      duplicateRoutineNode(nested),
                      ...branch.steps.slice(nestedIndex + 1),
                    ],
                  })
                }
              />
            ))}
            <AddFlowBlock
              label="Add branch action"
              options={allowedStepKinds}
              onAdd={(kind) =>
                updateBranch(index, {
                  ...branch,
                  steps: [...branch.steps, defaultStep(kind, createUuid())],
                })
              }
            />
          </div>
        </FlowBlock>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            ...step,
            branches: [
              ...step.branches,
              {
                id: createUuid(),
                condition: { kind: 'literal', value: true },
                steps: [],
              },
            ],
          })
        }
      >
        Add branch
      </Button>
    </div>
  );
}

function RolloutEditor({
  rollout,
  devices,
  onChange,
  path,
}: {
  rollout: RolloutSpec;
  devices: DevicesState;
  onChange: (rollout: RolloutSpec) => void;
  path: string;
}) {
  const { draftKey } = useRoutineAuthoring();
  if (
    rollout.style !== 'spatial' ||
    (rollout.source &&
      !['device', 'triggering_device'].includes(rollout.source.kind))
  )
    return <UnknownFlowValue value={rollout} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ConfigField
        label="Rollout source"
        description="Where the stagger radiates from."
      >
        <SettingsSelect
          aria-label="Rollout source"
          value={rollout.source?.kind === 'device' ? 'device' : 'trigger'}
          options={[
            { value: 'trigger', label: 'Triggering device' },
            { value: 'device', label: 'Fixed device' },
          ]}
          onValueChange={(next) => {
            const source =
              next === 'device'
                ? {
                    kind: 'device' as const,
                    device: { integration_id: '', device_id: '' },
                  }
                : { kind: 'triggering_device' as const };
            onChange({
              ...rollout,
              source: draftKey
                ? entityDraftStore.switchVariant(
                    draftKey,
                    path + '/source',
                    rollout.source?.kind === 'device' ? 'device' : 'trigger',
                    rollout.source,
                    next,
                    source,
                  )
                : source,
            });
          }}
        />
      </ConfigField>
      {rollout.source?.kind === 'device' ? (
        <ConfigField label="Source device">
          <DeviceSelect
            devices={devices}
            value={deviceRefKey(rollout.source.device)}
            onChange={(key) =>
              onChange({
                ...rollout,
                source: {
                  ...rollout.source,
                  kind: 'device',
                  device: keyToDeviceRef(key),
                },
              })
            }
          />
        </ConfigField>
      ) : null}
      <ConfigField
        label="Rollout spread"
        description="Targets without a saved position apply immediately."
      >
        <DurationInput
          label="Rollout spread"
          validate={(ms) =>
            ms > 600000 ? 'Rollout spread cannot exceed 10 minutes.' : undefined
          }
          draftKey={draftKey}
          path={path + '/duration'}
          valueMs={
            rollout.duration_ms === undefined
              ? undefined
              : Number(rollout.duration_ms)
          }
          onChange={(duration_ms) =>
            onChange({ ...rollout, duration_ms } as unknown as RolloutSpec)
          }
        />
      </ConfigField>
    </div>
  );
}

function RolloutToggle({
  rollout,
  onChange,
  path,
}: {
  rollout: RolloutSpec | null | undefined;
  onChange: (rollout: RolloutSpec | undefined) => void;
  path: string;
}) {
  const { draftKey } = useRoutineAuthoring();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded border border-input bg-background accent-primary"
        checked={rollout !== undefined && rollout !== null}
        aria-label="Spatial rollout"
        onChange={(event) => {
          const fallback = event.target.checked
            ? ({
                style: 'spatial',
                source: { kind: 'triggering_device' },
                duration_ms: 1500,
              } as unknown as RolloutSpec)
            : undefined;
          onChange(
            draftKey
              ? entityDraftStore.switchVariant(
                  draftKey,
                  path,
                  rollout == null ? 'disabled' : 'enabled',
                  rollout ?? undefined,
                  event.target.checked ? 'enabled' : 'disabled',
                  fallback,
                )
              : fallback,
          );
        }}
      />
      Spatial rollout (stagger targets by distance from a source)
    </label>
  );
}

function defaultSceneSelection(
  helpers: HelperRuntimeStatus[],
  groups: FlattenedGroupsConfig,
): SceneSelection {
  const helper = helpers.find((item) => item.kind.kind === 'enum');
  if (helper) {
    return {
      kind: 'helper_enum',
      helper: helper.id,
      mapping: {},
      fallback_scene_id: undefined,
    };
  }
  return {
    kind: 'group_active',
    group_id: Object.keys(groups)[0] ?? '',
    fallback_scene_id: undefined,
  };
}

function SceneSelectionEditor({
  slot,
  selection,
  scenes,
  groups,
  helpers,
  onChange,
  onClear,
}: {
  slot: string;
  selection: SceneSelection;
  scenes: Array<{ id: string; name: string }>;
  groups: FlattenedGroupsConfig;
  helpers: HelperRuntimeStatus[];
  onChange: (selection: SceneSelection) => void;
  onClear: () => void;
}) {
  const { draftKey } = useRoutineAuthoring();
  const enumHelpers = helpers.filter((item) => item.kind.kind === 'enum');
  const selectedHelper = enumHelpers.find(
    (item) => selection.kind === 'helper_enum' && item.id === selection.helper,
  );
  const helperOptions =
    selectedHelper && selectedHelper.kind.kind === 'enum'
      ? selectedHelper.kind.options
      : [];
  const optionList = [
    ...new Set([
      ...helperOptions,
      ...Object.keys(selection.kind === 'helper_enum' ? selection.mapping : {}),
    ]),
  ];

  const switchKind = (kind: SceneSelection['kind']) => {
    if (kind === selection.kind) return;
    const fallback: SceneSelection =
      kind === 'helper_enum'
        ? { kind, helper: enumHelpers[0]?.id ?? '', mapping: {} }
        : { kind, group_id: Object.keys(groups)[0] ?? '' };
    onChange(
      draftKey
        ? entityDraftStore.switchVariant(
            draftKey,
            slot,
            selection.kind,
            selection,
            kind,
            fallback,
          )
        : fallback,
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <ConfigField
        label="Dynamic selection"
        description="Resolved once when the step runs and frozen into the plan."
      >
        <SettingsSelect
          aria-label="Dynamic scene selection"
          value={selection.kind}
          onValueChange={(value) => switchKind(value as SceneSelection['kind'])}
          options={[
            { value: 'helper_enum', label: 'Map a helper value to a scene' },
            { value: 'group_active', label: "Mirror a group's active scene" },
          ]}
        />
      </ConfigField>
      {selection.kind === 'helper_enum' ? (
        <>
          <ConfigField
            label="Helper"
            description="Enum helper whose current value picks the scene."
          >
            <ReferenceField kind="helper" value={selection.helper}>
              <SearchablePicker
                options={enumHelpers.map((helper) => ({
                  value: helper.id,
                  label: helper.name,
                  detail: helper.id,
                }))}
                value={selection.helper}
                onChange={(helper) => onChange({ ...selection, helper })}
                placeholder="Select helper…"
                ariaLabel="Scene selection helper"
              />
            </ReferenceField>
          </ConfigField>
          <ConfigField
            label="Value mapping"
            description="Scene activated for each helper value. Unmapped values use the fallback."
          >
            <div className="space-y-2">
              {optionList.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {selectedHelper
                    ? 'This helper has no enum options yet.'
                    : 'Select an enum helper to configure its value mapping.'}
                </p>
              ) : (
                optionList.map((option) => (
                  <div
                    key={option}
                    className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(5rem,0.65fr)_minmax(0,1.35fr)]"
                  >
                    <div className="min-w-0 text-xs sm:pt-2.5">
                      <span className="break-words font-mono">{option}</span>
                      {!helperOptions.includes(option) && (
                        <p className="mt-1 text-muted-foreground">
                          Not in the helper's current options
                        </p>
                      )}
                    </div>
                    <SceneSelect
                      scenes={scenes}
                      value={
                        Object.hasOwn(selection.mapping, option)
                          ? selection.mapping[option]
                          : ''
                      }
                      placeholder="No mapping"
                      ariaLabel={`Scene for ${option}`}
                      onChange={(sceneId) => {
                        const mapping = sceneId
                          ? { ...selection.mapping, [option]: sceneId }
                          : Object.fromEntries(
                              Object.entries(selection.mapping).filter(
                                ([key]) => key !== option,
                              ),
                            );
                        onChange({ ...selection, mapping });
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </ConfigField>
        </>
      ) : (
        <ConfigField
          label="Group"
          description="Uses the group's unanimous active scene when every member agrees."
        >
          <GroupSelect
            groups={groups}
            value={selection.group_id}
            onChange={(group_id) => onChange({ ...selection, group_id })}
          />
        </ConfigField>
      )}
      <ConfigField
        label="Fallback scene"
        description="Used when the value is unknown or the group is mixed."
      >
        <SceneSelect
          scenes={scenes}
          value={selection.fallback_scene_id ?? ''}
          placeholder="No fallback"
          ariaLabel="Fallback scene"
          onChange={(sceneId) =>
            onChange({ ...selection, fallback_scene_id: sceneId || undefined })
          }
        />
      </ConfigField>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Use a fixed scene
      </Button>
    </div>
  );
}

function StepFields({
  step,
  onChange,
  devices,
  groups,
  scenes,
  routines,
  helpers,
  existingIds,
}: {
  step: NativeAction;
  onChange: (step: NativeAction) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  existingIds: string[];
}) {
  const { returnHref, draftKey } = useRoutineAuthoring();
  const actionPath = `step/${step.id}/${step.action}`;
  const sceneSlot = 'scene-choice/' + encodeURIComponent(step.id);
  const switchSceneMode = (mode: 'fixed' | 'dynamic') => {
    if (step.action !== 'activate_scene') return;
    type Choice = Pick<typeof step, 'scene_id' | 'select'>;
    const fallback: Choice =
      mode === 'fixed'
        ? { scene_id: '', select: undefined }
        : {
            scene_id: undefined,
            select: defaultSceneSelection(helpers, groups),
          };
    const choice = draftKey
      ? entityDraftStore.switchVariant<Choice>(
          draftKey,
          sceneSlot,
          step.select ? 'dynamic' : 'fixed',
          { scene_id: step.scene_id, select: step.select },
          mode,
          fallback,
        )
      : fallback;
    onChange({ ...step, ...choice });
  };
  const sceneReturn = returnHref
    ? returnHref +
      (returnHref.includes('?') ? '&' : '?') +
      'sceneNode=' +
      encodeURIComponent(step.id)
    : undefined;
  switch (step.action) {
    case 'call_block':
      return (
        <BlockCallEditor
          path={`step/${step.id}/call_block`}
          kind="action"
          blockId={step.block_id}
          inputs={step.inputs}
          onChange={(block_id, inputs) =>
            onChange({ ...step, block_id, inputs })
          }
          devices={devices}
          groups={groups}
          scenes={scenes}
          helpers={helpers}
        />
      );
    case 'run_script':
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Returns actions at this point in the sequence. Reads the triggering
            snapshot, before any actions run. If a script fails, this run
            applies no actions.
          </p>
          <ScriptProgramEditor
            spec={step.spec}
            path={actionPath + '/spec'}
            onChange={(spec) => onChange({ ...step, spec })}
            devices={devices}
            groups={groups}
          />
        </div>
      );
    case 'activate_scene':
      return (
        <div className="space-y-3">
          {step.select ? (
            <SceneSelectionEditor
              slot={sceneSlot + '/kind'}
              selection={step.select}
              scenes={scenes}
              groups={groups}
              helpers={helpers}
              onChange={(select) => onChange({ ...step, select })}
              onClear={() => switchSceneMode('fixed')}
            />
          ) : (
            <ConfigField label="Scene">
              <div className="space-y-2">
                <SceneSelect
                  scenes={scenes}
                  value={step.scene_id ?? ''}
                  createReturnTo={sceneReturn}
                  ariaLabel="Scene to activate"
                  onChange={(scene_id) => onChange({ ...step, scene_id })}
                />
              </div>
            </ConfigField>
          )}
          <details className="flow-action-options">
            <summary className="cursor-pointer text-xs text-muted-foreground py-2">
              Targets & timing ·{' '}
              {(step.targets?.groups?.length ?? 0) +
                (step.targets?.devices?.length ?? 0) >
              0
                ? `${(step.targets?.groups?.length ?? 0) + (step.targets?.devices?.length ?? 0)} overrides`
                : 'Scene defaults'}
              {step.transition_ms != null
                ? ` · ${Number(step.transition_ms) / 1000}s fade`
                : step.use_scene_transition === false
                  ? ' · Instant'
                  : ''}
              {step.rollout ? ' · Staggered' : ''}
            </summary>
            <div className="space-y-3 pt-2">
              {!step.select && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => switchSceneMode('dynamic')}
                >
                  Use a dynamic selection
                </Button>
              )}
              <TargetSpecEditor
                targets={step.targets}
                devices={devices}
                groups={groups}
                label="Target override"
                description="Leave empty to use the scene's own targets."
                onChange={(targets) => onChange({ ...step, targets })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <ConfigField
                  label="Transition"
                  description="Scene-derived transitions are used unless disabled."
                >
                  <SettingsSelect
                    aria-label="Transition source"
                    options={[
                      { value: 'scene', label: 'Use scene transitions' },
                      { value: 'none', label: 'Instant unless overridden' },
                    ]}
                    value={
                      step.use_scene_transition !== false ? 'scene' : 'none'
                    }
                    onValueChange={(value) =>
                      onChange({
                        ...step,
                        use_scene_transition: value === 'scene',
                      })
                    }
                  />
                </ConfigField>
                <ConfigField
                  label="Transition override"
                  description="Optional explicit fade duration for this activation."
                >
                  <DurationInput
                    label="Transition override"
                    validate={(ms) =>
                      ms === 0
                        ? 'Choose instant and clear the override, or enter a positive duration.'
                        : undefined
                    }
                    draftKey={draftKey}
                    path={actionPath + '/transition'}
                    valueMs={
                      step.transition_ms === undefined
                        ? undefined
                        : Number(step.transition_ms)
                    }
                    onChange={(transition_ms) =>
                      onChange({
                        ...step,
                        transition_ms,
                      } as unknown as NativeAction)
                    }
                  />
                </ConfigField>
              </div>
              <RolloutToggle
                path={actionPath + '/rollout'}
                rollout={step.rollout}
                onChange={(rollout) =>
                  onChange({ ...step, rollout } as unknown as NativeAction)
                }
              />
              {step.rollout ? (
                <RolloutEditor
                  path={actionPath + '/rollout'}
                  rollout={step.rollout}
                  devices={devices}
                  onChange={(rollout) =>
                    onChange({ ...step, rollout } as unknown as NativeAction)
                  }
                />
              ) : null}
            </div>
          </details>
          {!step.select && !step.scene_id ? (
            <p className="text-xs text-destructive">Select a scene.</p>
          ) : null}
        </div>
      );

    case 'cycle_scenes':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {step.scenes.length === 0 && (
              <p
                id={`cycle-empty-${encodeURIComponent(step.id)}`}
                className="text-sm text-destructive"
              >
                Add at least one scene to this cycle, or remove the action.
              </p>
            )}
            {step.scenes.map((entry, index) => (
              <div
                key={index}
                className="space-y-2 rounded-xl border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Scene {index + 1}</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => {
                        const order = moveSibling(
                          step.scenes.map((_, i) => i),
                          index,
                          -1,
                        );
                        if (draftKey)
                          entityDraftStore.remapEditorPaths(draftKey, (path) =>
                            remapArrayEditorPath(
                              path,
                              actionPath + '/scenes',
                              order,
                            ),
                          );
                        onChange({
                          ...step,
                          scenes: order.map((i) => step.scenes[i]),
                        });
                      }}
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const order = step.scenes
                          .map((_, i) => i)
                          .filter((i) => i !== index);
                        if (draftKey)
                          entityDraftStore.remapEditorPaths(draftKey, (path) =>
                            remapArrayEditorPath(
                              path,
                              actionPath + '/scenes',
                              order,
                            ),
                          );
                        onChange({
                          ...step,
                          scenes: order.map((i) => step.scenes[i]),
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <ConfigField label="Scene">
                  <SceneSelect
                    scenes={scenes}
                    value={entry.scene_id}
                    onChange={(scene_id) =>
                      onChange({
                        ...step,
                        scenes: step.scenes.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, scene_id } : item,
                        ),
                      })
                    }
                  />
                </ConfigField>
                <TargetSpecEditor
                  targets={entry.targets}
                  devices={devices}
                  groups={groups}
                  label="Target override"
                  description="Leave empty to use the scene's own targets."
                  onChange={(targets) =>
                    onChange({
                      ...step,
                      scenes: step.scenes.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, targets } : item,
                      ),
                    })
                  }
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ConfigField
                    label="Transition"
                    description="Scene-derived transitions are used unless disabled."
                  >
                    <SettingsSelect
                      aria-label="Transition source"
                      options={[
                        { value: 'scene', label: 'Use scene transitions' },
                        { value: 'none', label: 'Instant unless overridden' },
                      ]}
                      value={
                        entry.use_scene_transition !== false ? 'scene' : 'none'
                      }
                      onValueChange={(value) =>
                        onChange({
                          ...step,
                          scenes: step.scenes.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  use_scene_transition: value === 'scene',
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </ConfigField>
                  <ConfigField
                    label="Transition override"
                    description="Optional explicit fade duration for this entry."
                  >
                    <DurationInput
                      label="Transition override"
                      validate={(ms) =>
                        ms === 0
                          ? 'Choose instant and clear the override, or enter a positive duration.'
                          : undefined
                      }
                      draftKey={draftKey}
                      path={actionPath + '/scenes/' + index + '/transition'}
                      valueMs={
                        entry.transition_ms === undefined
                          ? undefined
                          : Number(entry.transition_ms)
                      }
                      onChange={(transition_ms) =>
                        onChange({
                          ...step,
                          scenes: step.scenes.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, transition_ms }
                              : item,
                          ),
                        } as unknown as NativeAction)
                      }
                    />
                  </ConfigField>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...step,
                  scenes: [
                    ...step.scenes,
                    { scene_id: '', targets: {}, use_scene_transition: true },
                  ],
                })
              }
              data-field={actionPath + '/scenes'}
              aria-describedby={
                step.scenes.length === 0
                  ? `cycle-empty-${encodeURIComponent(step.id)}`
                  : undefined
              }
            >
              Add scene
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 rounded border border-input bg-background accent-primary"
              checked={step.nowrap}
              onChange={(event) =>
                onChange({ ...step, nowrap: event.target.checked })
              }
            />
            Stop at the last scene instead of wrapping to the first
          </label>
          <TargetSpecEditor
            targets={step.detection}
            devices={devices}
            groups={groups}
            label="Detection override"
            description="Restrict current-scene detection to these devices or groups. Empty uses every target common to the cycled scenes."
            onChange={(detection) => onChange({ ...step, detection })}
          />
          <RolloutToggle
            path={actionPath + '/rollout'}
            rollout={step.rollout}
            onChange={(rollout) =>
              onChange({ ...step, rollout } as unknown as NativeAction)
            }
          />
          {step.rollout ? (
            <RolloutEditor
              path={actionPath + '/rollout'}
              rollout={step.rollout}
              devices={devices}
              onChange={(rollout) =>
                onChange({ ...step, rollout } as unknown as NativeAction)
              }
            />
          ) : null}
          {step.scenes.some((entry) => !entry.scene_id) ? (
            <p className="text-xs text-destructive">
              Every entry needs a scene.
            </p>
          ) : null}
        </div>
      );

    case 'set_power':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfigField label="Device">
            <DeviceSelect
              devices={devices}
              value={deviceRefKey(step.device)}
              onChange={(key) =>
                onChange({ ...step, device: keyToDeviceRef(key) })
              }
            />
          </ConfigField>
          <ConfigField label="Power">
            <SettingsSelect
              aria-label="Power"
              value={step.power ? 'true' : 'false'}
              onValueChange={(next) =>
                onChange({ ...step, power: next === 'true' })
              }
              options={[
                { value: 'true', label: 'Turn on' },
                { value: 'false', label: 'Turn off' },
              ]}
            />
          </ConfigField>
          {!step.device.integration_id ? (
            <p className="text-xs text-destructive sm:col-span-2">
              Select a device.
            </p>
          ) : null}
        </div>
      );

    case 'dim':
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigField
              label="Dim step"
              description="Relative change in the -1.0 to 1.0 range."
            >
              <DraftNumberInput
                aria-label="Dim step"
                draftKey={draftKey!}
                path={actionPath + '/amount'}
                value={step.step}
                validate={(value) =>
                  value === 0 || Math.abs(value) > 1
                    ? 'Enter a non-zero change from -1 to 1.'
                    : undefined
                }
                onValueChange={(value) => onChange({ ...step, step: value! })}
              />
            </ConfigField>
            <ConfigField
              label="Transition"
              description="Optional fade duration."
            >
              <DurationInput
                label="Transition"
                draftKey={draftKey}
                path={actionPath + '/transition'}
                validate={(ms) =>
                  ms === 0
                    ? 'Enter a positive duration, or leave empty for the default.'
                    : undefined
                }
                valueMs={
                  step.transition_ms === undefined
                    ? undefined
                    : Number(step.transition_ms)
                }
                onChange={(transition_ms) =>
                  onChange({
                    ...step,
                    transition_ms,
                  } as unknown as NativeAction)
                }
              />
            </ConfigField>
          </div>
          <TargetSpecEditor
            targets={step.targets}
            devices={devices}
            groups={groups}
            onChange={(targets) => onChange({ ...step, targets })}
          />
        </div>
      );

    case 'randomize_color':
      return (
        <div className="space-y-3">
          <div className="flow-color-fields grid gap-3">
            <ConfigField
              label="Min saturation"
              description="Defaults to 0.2. Clamped to 0–1 when run; reversed bounds are swapped."
            >
              <DraftNumberInput
                aria-label="Min saturation"
                draftKey={draftKey!}
                path={actionPath + '/min_saturation'}
                optional
                placeholder="0.2"
                value={step.min_saturation}
                onValueChange={(value) =>
                  onChange({ ...step, min_saturation: value })
                }
              />
            </ConfigField>
            <ConfigField
              label="Max saturation"
              description="Defaults to 1.0. Stored values are kept as entered."
            >
              <DraftNumberInput
                aria-label="Max saturation"
                draftKey={draftKey!}
                path={actionPath + '/max_saturation'}
                optional
                placeholder="1.0"
                value={step.max_saturation}
                onValueChange={(value) =>
                  onChange({ ...step, max_saturation: value })
                }
              />
            </ConfigField>
            <ConfigField
              label="Transition"
              description="Optional fade duration."
            >
              <DurationInput
                label="Transition"
                draftKey={draftKey}
                path={actionPath + '/transition'}
                validate={(ms) =>
                  ms === 0
                    ? 'Enter a positive duration, or leave empty for the default.'
                    : undefined
                }
                valueMs={
                  step.transition_ms === undefined
                    ? undefined
                    : Number(step.transition_ms)
                }
                onChange={(transition_ms) =>
                  onChange({
                    ...step,
                    transition_ms,
                  } as unknown as NativeAction)
                }
              />
            </ConfigField>
          </div>
          <TargetSpecEditor
            targets={step.targets}
            devices={devices}
            groups={groups}
            onChange={(targets) => onChange({ ...step, targets })}
          />
        </div>
      );

    case 'schedule_timer':
    case 'replace_timer':
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigField
              label="Timer name"
              description={
                step.action === 'schedule_timer'
                  ? 'Fails if this timer already has a live deadline.'
                  : 'Replaces the current deadline if one exists.'
              }
            >
              <Input
                aria-label="Timer name"
                className="font-mono"
                value={step.timer}
                placeholder="off"
                onChange={(event) =>
                  onChange({ ...step, timer: event.target.value })
                }
              />
            </ConfigField>
            <ConfigField label="Delay">
              <DurationInput
                label="Delay"
                draftKey={draftKey}
                path={actionPath + '/delay'}
                required
                validate={(ms) =>
                  ms > 604800000
                    ? 'Timer delay cannot exceed seven days.'
                    : undefined
                }
                valueMs={Number(step.delay_ms)}
                onChange={(delay_ms) =>
                  onChange({ ...step, delay_ms } as unknown as NativeAction)
                }
              />
            </ConfigField>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 rounded border border-input bg-background accent-primary"
              checked={step.capture_target_intents !== undefined}
              onChange={(event) =>
                onChange({
                  ...step,
                  capture_target_intents: draftKey
                    ? entityDraftStore.switchVariant<TargetSpec | undefined>(
                        draftKey,
                        'timer-capture/' + encodeURIComponent(step.id),
                        step.capture_target_intents === undefined
                          ? 'disabled'
                          : 'enabled',
                        step.capture_target_intents,
                        event.target.checked ? 'enabled' : 'disabled',
                        event.target.checked ? {} : undefined,
                      )
                    : event.target.checked
                      ? {}
                      : undefined,
                } as unknown as NativeAction)
              }
            />
            Freeze target intents for delayed actions (advanced)
          </label>
          {step.capture_target_intents !== undefined ? (
            <TargetSpecEditor
              targets={step.capture_target_intents}
              devices={devices}
              groups={groups}
              label="Captured targets"
              description="A delayed action may only act on unchanged targets."
              onChange={(capture_target_intents) =>
                onChange({
                  ...step,
                  capture_target_intents,
                } as unknown as NativeAction)
              }
            />
          ) : null}
          {step.capture_target_intents !== undefined &&
          (step.capture_target_intents.devices?.length ?? 0) === 0 &&
          (step.capture_target_intents.groups?.length ?? 0) === 0 ? (
            <p className="text-xs text-destructive">
              Captured targets must name at least one device or group.
            </p>
          ) : null}
          {!step.timer ? (
            <p className="text-xs text-destructive">Enter a timer name.</p>
          ) : null}
        </div>
      );

    case 'cancel_timer':
      return (
        <ConfigField
          label="Timer name"
          description="Cancelling a timer that is not running succeeds."
        >
          <Input
            aria-label="Timer name"
            className="font-mono"
            value={step.timer}
            placeholder="off"
            onChange={(event) =>
              onChange({ ...step, timer: event.target.value })
            }
          />
        </ConfigField>
      );

    case 'set_helper': {
      const helper = helpers.find((candidate) => candidate.id === step.helper);
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfigField label="Helper">
            <ReferenceField kind="helper" value={step.helper}>
              <SearchablePicker
                ariaLabel="Helper"
                options={helpers.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                  detail: candidate.id,
                }))}
                value={step.helper}
                onChange={(selected) =>
                  onChange({
                    ...step,
                    helper: selected,
                    value: draftKey
                      ? entityDraftStore.switchVariant(
                          draftKey,
                          actionPath + '/helper',
                          step.helper,
                          step.value,
                          selected,
                          helperDefaultValue(
                            helpers.find(
                              (candidate) => candidate.id === selected,
                            ),
                          ),
                        )
                      : helperDefaultValue(
                          helpers.find(
                            (candidate) => candidate.id === selected,
                          ),
                        ),
                  })
                }
                placeholder="Select helper…"
              />
            </ReferenceField>
          </ConfigField>
          <ConfigField
            label="Value"
            description={
              helper?.kind.kind === 'number'
                ? 'Range: ' +
                  (helper.kind.min ?? 'no minimum') +
                  ' to ' +
                  (helper.kind.max ?? 'no maximum')
                : undefined
            }
          >
            <HelperValueEditor
              path={actionPath + '/helper/value'}
              helper={helper}
              value={step.value}
              onChange={(value) => onChange({ ...step, value })}
            />
          </ConfigField>
          {!step.helper ? (
            <p className="text-xs text-destructive sm:col-span-2">
              Select a helper.
            </p>
          ) : null}
        </div>
      );
    }

    case 'invoke_routine':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfigField label="Routine">
            <RoutineSelect
              routines={routines}
              value={step.routine_id}
              onChange={(routine_id) => onChange({ ...step, routine_id })}
            />
          </ConfigField>
          <ConfigField
            label="Mode"
            description="Await completion keeps later steps waiting for the invoked routine."
          >
            <SettingsSelect
              aria-label="Invocation mode"
              value={step.mode}
              onValueChange={(mode) =>
                onChange({ ...step, mode: mode as InvokeMode })
              }
              options={[
                { value: 'fire_and_forget', label: 'Fire and forget' },
                { value: 'await_completion', label: 'Await completion' },
                ...(!['fire_and_forget', 'await_completion'].includes(step.mode)
                  ? [
                      {
                        value: step.mode,
                        label: 'Unsupported mode: ' + step.mode,
                      },
                    ]
                  : []),
              ]}
            />
          </ConfigField>
          {!step.routine_id ? (
            <p className="text-xs text-destructive sm:col-span-2">
              Select a routine.
            </p>
          ) : null}
        </div>
      );

    case 'choose':
      return (
        <ChooseStepEditor
          step={step}
          onChange={onChange}
          devices={devices}
          groups={groups}
          scenes={scenes}
          routines={routines}
          helpers={helpers}
          existingIds={existingIds}
        />
      );
  }
}

function StepEditor({
  step,
  index,
  total,
  devices,
  groups,
  scenes,
  routines,
  helpers,
  existingIds,
  onChange,
  onRemove,
  onMove,
  onDuplicate,
}: {
  step: NativeAction;
  index: number;
  total: number;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  existingIds: string[];
  onChange: (step: NativeAction) => void;
  onRemove: () => void;
  onMove: (offset: number) => void;
  onDuplicate?: () => void;
}) {
  const { draftKey } = useRoutineAuthoring();
  const allowedStepKinds = useStepKindOptions();
  if (!step || typeof step !== 'object')
    return <UnknownFlowValue value={step} />;
  const known =
    stepKindOptions.some((option) => option.value === step.action) &&
    (step.action !== 'activate_scene' ||
      step.select == null ||
      isEditableSceneSelection(step.select)) &&
    (step.action !== 'set_power' || Boolean(step.device)) &&
    (step.action !== 'run_script' || Boolean(step.spec)) &&
    (step.action !== 'cycle_scenes' || Array.isArray(step.scenes)) &&
    (step.action !== 'choose' ||
      (Array.isArray(step.branches) &&
        step.branches.every(
          (branch) => branch && Array.isArray(branch.steps) && branch.condition,
        )));
  return (
    <FlowBlock
      id={step.id}
      className="flow-action"
      icon={
        step.action === 'activate_scene' || step.action === 'cycle_scenes' ? (
          <Palette className="size-4" />
        ) : step.action === 'set_power' ? (
          <Power className="size-4" />
        ) : step.action === 'choose' ? (
          <GitBranch className="size-4" />
        ) : typeof step.action === 'string' && step.action.includes('timer') ? (
          <Timer className="size-4" />
        ) : step.action === 'invoke_routine' ? (
          <Play className="size-4" />
        ) : step.action === 'run_script' ? (
          <Code2 className="size-4" />
        ) : (
          <SlidersHorizontal className="size-4" />
        )
      }
      title={
        known ? (
          <SettingsSelect
            className="settings-select w-full"
            aria-label="Step type"
            value={step.action}
            options={stepKindOptions}
            onValueChange={(selected) => {
              const kind = selected as StepKind,
                fallback = defaultStep(kind, step.id);
              onChange(
                draftKey
                  ? entityDraftStore.switchVariant(
                      draftKey,
                      'step/' + step.id,
                      step.action,
                      step,
                      kind,
                      fallback,
                    )
                  : fallback,
              );
            }}
          />
        ) : (
          'Unrecognized step'
        )
      }
      index={index}
      total={total}
      onMove={onMove}
      onRemove={() => {
        if (draftKey) {
          const prefixes = collectStepIds([step]).map((id) => `step/${id}`);
          entityDraftStore.remapEditorPaths(draftKey, (path) =>
            prefixes.some(
              (prefix) => path === prefix || path.startsWith(prefix + '/'),
            )
              ? null
              : path,
          );
        }
        onRemove();
      }}
      onDuplicate={onDuplicate}
    >
      {known ? (
        <>
          <StepFields
            step={step}
            onChange={onChange}
            devices={devices}
            groups={groups}
            scenes={scenes}
            routines={routines}
            helpers={helpers}
            existingIds={existingIds}
          />
        </>
      ) : (
        <UnknownFlowValue value={step} />
      )}
    </FlowBlock>
  );
}

function ScriptProgramEditor({
  spec,
  onChange,
  devices,
  groups,
  path,
}: {
  spec: ScriptSpec;
  onChange: (spec: ScriptSpec) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  path: string;
}) {
  if (
    !spec ||
    typeof spec.source_body !== 'string' ||
    (spec.declarations !== undefined && !Array.isArray(spec.declarations)) ||
    spec.api_version !== 1 ||
    (spec.limits_profile !== undefined && spec.limits_profile !== 'default')
  )
    return <UnknownFlowValue value={spec} />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        JavaScript · API {spec.api_version} · {spec.limits_profile ?? 'default'}{' '}
        limits
      </p>
      <ConfigField
        label="Function body"
        description="Runs in the sandboxed worker after a trigger fires and the condition holds. ctx and api are typed and autocompleted; return { actions, next_state? }."
      >
        <RoutineScriptEditor
          value={spec.source_body}
          onChange={(source_body) => onChange({ ...spec, source_body })}
        />
      </ConfigField>

      <RoutineScriptDeclarations
        declarations={spec.declarations ?? []}
        onChange={(declarations) => onChange({ ...spec, declarations })}
        devices={devices}
        groups={groups}
        path={path + '/declarations'}
      />
    </div>
  );
}

export function ProgramBuilder({
  program,
  onChange,
  devices,
  groups,
  scenes,
  routines,
  helpers,
}: {
  program: Program | undefined;
  onChange: (program: Program) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
}) {
  const { draftKey } = useRoutineAuthoring();
  const allowedStepKinds = useStepKindOptions();
  const steps =
    program?.kind === 'native' && Array.isArray(program.steps)
      ? program.steps
      : [];
  const existingIds = collectStepIds(steps);
  if (
    program &&
    (typeof program !== 'object' ||
      (program.kind === 'native' && !Array.isArray(program.steps)) ||
      (program.kind === 'script' &&
        (!program.spec ||
          typeof program.spec.source_body !== 'string' ||
          (program.spec.declarations !== undefined &&
            !Array.isArray(program.spec.declarations)))))
  )
    return <UnknownFlowValue value={program} />;
  const update = (steps: NativeAction[]) =>
    onChange({ ...program, kind: 'native', steps });
  return (
    <div className="flow-sequence">
      {program?.kind === 'script' ? (
        <FlowBlock title="Sandboxed script">
          <ScriptProgramEditor
            spec={program.spec}
            path="program/spec"
            onChange={(spec) => onChange({ ...program, spec })}
            devices={devices}
            groups={groups}
          />
          <Button
            variant="outline"
            onClick={() => {
              const id = createUuid();
              const { spec, ...metadata } = program;
              if (draftKey)
                entityDraftStore.remapEditorPaths(draftKey, (path) =>
                  path.startsWith('program/spec/')
                    ? `step/${id}/run_script/spec/` +
                      path.slice('program/spec/'.length)
                    : path,
                );
              onChange({
                ...metadata,
                kind: 'native',
                steps: [
                  {
                    action: 'run_script',
                    id,
                    spec,
                  },
                ],
              });
            }}
          >
            Use as an action in the flow
          </Button>
        </FlowBlock>
      ) : program && program.kind !== 'native' ? (
        <UnknownFlowValue value={program} />
      ) : (
        <>
          {steps.map((step, index) => (
            <StepEditor
              key={step?.id || index}
              step={step}
              index={index}
              total={steps.length}
              devices={devices}
              groups={groups}
              scenes={scenes}
              routines={routines}
              helpers={helpers}
              existingIds={existingIds}
              onChange={(next) =>
                update(steps.map((entry, i) => (i === index ? next : entry)))
              }
              onRemove={() => update(steps.filter((_, i) => i !== index))}
              onMove={(offset) => update(moveSibling(steps, index, offset))}
              onDuplicate={() =>
                update([
                  ...steps.slice(0, index + 1),
                  duplicateRoutineNode(step),
                  ...steps.slice(index + 1),
                ])
              }
            />
          ))}
          {!steps.length && (
            <p className="text-xs text-muted-foreground">
              Add the actions to run, in order.
            </p>
          )}
          <AddFlowBlock
            label="Add action"
            options={stepKindOptions}
            onAdd={(kind) =>
              update([...steps, defaultStep(kind, createUuid())])
            }
          />
        </>
      )}
    </div>
  );
}
export default ProgramBuilder;
