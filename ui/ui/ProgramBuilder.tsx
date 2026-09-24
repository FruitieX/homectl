import type { ChooseBranch } from '@/bindings/ChooseBranch';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { InvokeMode } from '@/bindings/InvokeMode';
import type { NativeAction } from '@/bindings/NativeAction';
import type { Program } from '@/bindings/Program';
import type { RolloutSpec } from '@/bindings/RolloutSpec';
import type { ScriptDeclaration } from '@/bindings/ScriptDeclaration';
import type { ScriptSpec } from '@/bindings/ScriptSpec';
import type { SceneSelection } from '@/bindings/SceneSelection';
import type { TargetSpec } from '@/bindings/TargetSpec';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { DurationInput, selectClassName } from '@/ui/builder-fields';
import { Copy } from 'lucide-react';
import { ConditionEditor, describeCondition } from '@/ui/ConditionBuilder';
import {
  DeviceMultiSelect,
  DeviceSelect,
  GroupMultiSelect,
  GroupSelect,
  RoutineSelect,
  SceneSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { Advanced } from '@/ui/primitives/advanced';
import { ConfigField } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { SearchablePicker, type PickerOption } from '@/ui/SearchablePicker';
import RoutineScriptEditor from '@/ui/RoutineScriptEditor';
import { useTimers } from '@/hooks/websocket';
import { useCallback, useMemo, useRef, useState } from 'react';

type StepKind = NativeAction['action'];

const stepKindOptions: Array<{ value: StepKind; label: string }> = [
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
  { value: 'choose', label: 'Choose branch (advanced)' },
];

const stepKindLabels: Record<StepKind, string> = {
  activate_scene: 'Activate scene',
  cycle_scenes: 'Cycle scenes',
  set_power: 'Set power',
  dim: 'Dim',
  randomize_color: 'Randomize colors',
  schedule_timer: 'Start timer',
  replace_timer: 'Restart timer',
  cancel_timer: 'Cancel timer',
  set_helper: 'Set helper',
  invoke_routine: 'Invoke routine',
  choose: 'Choose branch',
};

function nextNodeId(prefix: string, existingIds: Iterable<string>) {
  const taken = new Set(existingIds);
  let index = 1;
  let id = `${prefix}_${index}`;
  while (taken.has(id)) {
    index += 1;
    id = `${prefix}_${index}`;
  }
  return id;
}

function collectTimerNames(value: unknown, names: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectTimerNames(item, names);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  if (typeof object.timer === 'string' && object.timer.trim()) {
    names.add(object.timer);
  }
  for (const child of Object.values(object)) collectTimerNames(child, names);
}

function TimerNameField({
  value,
  onChange,
  options,
  description,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  description: string;
}) {
  const savedValue = options.some((option) => option.value === value)
    ? value
    : '';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ConfigField label="Timer name" description={description}>
        <Input
          value={value}
          placeholder="Enter a timer name"
          onChange={(event) => onChange(event.target.value)}
        />
      </ConfigField>
      {options.length > 0 ? (
        <ConfigField label="Choose a saved or running timer">
          <SearchablePicker
            options={options}
            value={savedValue}
            onChange={onChange}
            placeholder="Search timer names…"
            ariaLabel="Choose a saved or running timer"
            clearable={false}
          />
        </ConfigField>
      ) : null}
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Choose a saved or running timer, or enter a new name.
      </p>
    </div>
  );
}

function defaultStep(kind: StepKind, id: string): NativeAction {
  switch (kind) {
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
    ids.push(step.id);
    if (step.action === 'choose') {
      for (const branch of step.branches) {
        for (const nested of branch.steps) {
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

function summarizeStep(step: NativeAction): string {
  switch (step.action) {
    case 'activate_scene':
      return step.select
        ? step.select.kind === 'helper_enum'
          ? `scene by helper ${step.select.helper}`
          : `scene mirroring group ${step.select.group_id}`
        : step.scene_id
          ? `scene ${step.scene_id}`
          : 'no scene selected';
    case 'cycle_scenes':
      return `${step.scenes.length} scene(s)${step.nowrap ? ', stop at last' : ''}`;
    case 'set_power':
      return `${step.power ? 'turn on' : 'turn off'} ${step.device.device_id || 'device'}`;
    case 'dim':
      return `step ${step.step}`;
    case 'randomize_color':
      return 'random hue and saturation';
    case 'schedule_timer':
    case 'replace_timer':
      return `timer ${step.timer || '?'}`;
    case 'cancel_timer':
      return `timer ${step.timer || '?'}`;
    case 'set_helper':
      return `helper ${step.helper || '?'}`;
    case 'invoke_routine':
      return `routine ${step.routine_id || '?'}`;
    case 'choose':
      return `${step.branches.length} branch(es)`;
  }
}

function TargetSpecEditor({
  targets,
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
              groups: groupIds,
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
}: {
  helper: HelperRuntimeStatus | undefined;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  if (!helper) {
    return (
      <Input
        className="font-mono"
        value={
          typeof value === 'string' ? value : JSON.stringify(value ?? null)
        }
        placeholder='true, 42, "text"'
        onChange={(event) => onChange(parseJsonish(event.target.value))}
      />
    );
  }

  switch (helper.kind.kind) {
    case 'boolean':
      return (
        <select
          className={selectClassName}
          value={value === true ? 'true' : 'false'}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    case 'number':
      return (
        <Input
          type="number"
          step="any"
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => {
            const parsed = event.target.valueAsNumber;
            onChange(Number.isNaN(parsed) ? 0 : parsed);
          }}
        />
      );
    case 'enum':
      return (
        <SearchablePicker
          options={helper.kind.options.map((option) => ({
            value: option,
            label: option,
          }))}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          placeholder="Select value…"
        />
      );
    case 'string':
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function parseJsonish(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
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
      return 0;
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
  timerOptions,
}: {
  step: Extract<NativeAction, { action: 'choose' }>;
  onChange: (step: NativeAction) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  existingIds: string[];
  timerOptions: PickerOption[];
}) {
  const [newBranchStepKind, setNewBranchStepKind] =
    useState<StepKind>('activate_scene');

  const updateBranch = (index: number, branch: ChooseBranch) => {
    onChange({
      ...step,
      branches: step.branches.map((candidate, candidateIndex) =>
        candidateIndex === index ? branch : candidate,
      ),
    });
  };

  const addBranch = () => {
    onChange({
      ...step,
      branches: [
        ...step.branches,
        {
          id: nextNodeId('branch', [
            ...step.branches.map((branch) => branch.id),
            ...existingIds,
          ]),
          condition: { kind: 'literal', value: true },
          steps: [],
        },
      ],
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Branches run first-match in order; unknown or erroring conditions block
        later branches.
      </p>
      {step.branches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-3 text-center text-sm text-muted-foreground">
          No branches configured. A choose step with no branches runs nothing.
        </div>
      ) : null}
      {step.branches.map((branch, index) => (
        <div
          key={`${branch.id}:${index}`}
          className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <ConfigField label="Branch ID" className="max-w-md">
              <Input
                className="font-mono"
                value={branch.id}
                onChange={(event) =>
                  updateBranch(index, { ...branch, id: event.target.value })
                }
              />
            </ConfigField>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                onChange({
                  ...step,
                  branches: step.branches.filter(
                    (_, candidateIndex) => candidateIndex !== index,
                  ),
                })
              }
            >
              Remove branch
            </Button>
          </div>
          <ConditionEditor
            condition={branch.condition}
            onChange={(condition) =>
              updateBranch(index, { ...branch, condition })
            }
            devices={devices}
            groups={groups}
            scenes={scenes}
            helpers={helpers}
          />
          {branch.steps.map((nested, nestedIndex) => (
            <StepEditor
              key={`${nested.id}:${nestedIndex}`}
              step={nested}
              index={nestedIndex}
              total={branch.steps.length}
              devices={devices}
              groups={groups}
              scenes={scenes}
              routines={routines}
              helpers={helpers}
              existingIds={existingIds}
              timerOptions={timerOptions}
              onChange={(next) =>
                updateBranch(index, {
                  ...branch,
                  steps: branch.steps.map((candidate, candidateIndex) =>
                    candidateIndex === nestedIndex ? next : candidate,
                  ),
                })
              }
              onRemove={() =>
                updateBranch(index, {
                  ...branch,
                  steps: branch.steps.filter(
                    (_, candidateIndex) => candidateIndex !== nestedIndex,
                  ),
                })
              }
              onMove={(offset) => {
                const target = nestedIndex + offset;
                if (target < 0 || target >= branch.steps.length) {
                  return;
                }
                const steps = [...branch.steps];
                const [moved] = steps.splice(nestedIndex, 1);
                steps.splice(target, 0, moved);
                updateBranch(index, { ...branch, steps });
              }}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-56">
              <SearchablePicker
                options={stepKindOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={newBranchStepKind}
                onChange={(kind) => setNewBranchStepKind(kind as StepKind)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateBranch(index, {
                  ...branch,
                  steps: [
                    ...branch.steps,
                    defaultStep(
                      newBranchStepKind,
                      nextNodeId(newBranchStepKind, existingIds),
                    ),
                  ],
                })
              }
            >
              Add branch step
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addBranch}>
        Add branch
      </Button>
    </div>
  );
}

function RolloutEditor({
  rollout,
  devices,
  onChange,
}: {
  rollout: RolloutSpec;
  devices: DevicesState;
  onChange: (rollout: RolloutSpec) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ConfigField
        label="Rollout source"
        description="Where the stagger radiates from."
      >
        <select
          className={selectClassName}
          value={rollout.source?.kind === 'device' ? 'device' : 'trigger'}
          onChange={(event) =>
            onChange({
              ...rollout,
              source:
                event.target.value === 'device'
                  ? {
                      kind: 'device',
                      device: { integration_id: '', device_id: '' },
                    }
                  : { kind: 'triggering_device' },
            })
          }
        >
          <option value="trigger">Triggering device</option>
          <option value="device">Fixed device</option>
        </select>
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
}: {
  rollout: RolloutSpec | null | undefined;
  onChange: (rollout: RolloutSpec | undefined) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded border border-input bg-background accent-primary"
        checked={rollout !== undefined && rollout !== null}
        onChange={(event) =>
          onChange(
            event.target.checked
              ? ({
                  style: 'spatial',
                  source: { kind: 'triggering_device' },
                  duration_ms: 1500,
                } as unknown as RolloutSpec)
              : undefined,
          )
        }
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
  selection,
  scenes,
  groups,
  helpers,
  onChange,
  onClear,
}: {
  selection: SceneSelection;
  scenes: Array<{ id: string; name: string }>;
  groups: FlattenedGroupsConfig;
  helpers: HelperRuntimeStatus[];
  onChange: (selection: SceneSelection) => void;
  onClear: () => void;
}) {
  const enumHelpers = helpers.filter((item) => item.kind.kind === 'enum');
  const selectedHelper = enumHelpers.find(
    (item) => selection.kind === 'helper_enum' && item.id === selection.helper,
  );
  const optionList =
    selectedHelper && selectedHelper.kind.kind === 'enum'
      ? selectedHelper.kind.options
      : [];

  const switchKind = (kind: SceneSelection['kind']) => {
    if (kind === selection.kind) return;
    onChange(defaultSceneSelection(helpers, groups));
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <ConfigField
        label="Dynamic selection"
        description="Resolved once when the step runs and frozen into the plan."
      >
        <select
          className={selectClassName}
          value={selection.kind}
          onChange={(event) =>
            switchKind(event.target.value as SceneSelection['kind'])
          }
        >
          <option value="helper_enum">Map a helper value to a scene</option>
          <option value="group_active">
            Mirror a group&apos;s active scene
          </option>
        </select>
      </ConfigField>
      {selection.kind === 'helper_enum' ? (
        <>
          <ConfigField
            label="Helper"
            description="Enum helper whose current value picks the scene."
          >
            <SearchablePicker
              options={enumHelpers.map((helper) => ({
                value: helper.id,
                label: helper.name,
                detail: helper.id,
              }))}
              value={selection.helper}
              onChange={(helper) => onChange({ ...selection, helper })}
              placeholder="Select helper…"
            />
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
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
                  >
                    <span className="truncate font-mono text-xs">{option}</span>
                    <SceneSelect
                      scenes={scenes}
                      value={selection.mapping[option] ?? ''}
                      placeholder="No mapping"
                      onChange={(sceneId) => {
                        const mapping = { ...selection.mapping };
                        if (sceneId) {
                          mapping[option] = sceneId;
                        } else {
                          delete mapping[option];
                        }
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
  timerOptions,
}: {
  step: NativeAction;
  onChange: (step: NativeAction) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  existingIds: string[];
  timerOptions: PickerOption[];
}) {
  switch (step.action) {
    case 'activate_scene':
      return (
        <div className="space-y-3">
          {step.select ? (
            <SceneSelectionEditor
              selection={step.select}
              scenes={scenes}
              groups={groups}
              helpers={helpers}
              onChange={(select) => onChange({ ...step, select })}
              onClear={() =>
                onChange({ ...step, select: undefined, scene_id: '' })
              }
            />
          ) : (
            <ConfigField
              label="Scene"
              description="Exactly one of a fixed scene or a dynamic selection is required."
            >
              <div className="space-y-2">
                <SceneSelect
                  scenes={scenes}
                  value={step.scene_id ?? ''}
                  onChange={(scene_id) => onChange({ ...step, scene_id })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...step,
                      scene_id: undefined,
                      select: defaultSceneSelection(helpers, groups),
                    })
                  }
                >
                  Use a dynamic selection
                </Button>
              </div>
            </ConfigField>
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
              <select
                className={selectClassName}
                value={step.use_scene_transition ? 'scene' : 'none'}
                onChange={(event) =>
                  onChange({
                    ...step,
                    use_scene_transition: event.target.value === 'scene',
                  })
                }
              >
                <option value="scene">Use scene transitions</option>
                <option value="none">No transition (instant)</option>
              </select>
            </ConfigField>
            <ConfigField
              label="Transition override"
              description="Optional explicit fade duration for this activation."
            >
              <DurationInput
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
            rollout={step.rollout}
            onChange={(rollout) =>
              onChange({ ...step, rollout } as unknown as NativeAction)
            }
          />
          {step.rollout ? (
            <RolloutEditor
              rollout={step.rollout}
              devices={devices}
              onChange={(rollout) =>
                onChange({ ...step, rollout } as unknown as NativeAction)
              }
            />
          ) : null}
          {!step.select && !step.scene_id ? (
            <p className="text-xs text-destructive">Select a scene.</p>
          ) : null}
        </div>
      );

    case 'cycle_scenes':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
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
                      onClick={() =>
                        onChange({
                          ...step,
                          scenes: step.scenes.map((item, itemIndex) =>
                            itemIndex === index - 1
                              ? entry
                              : itemIndex === index
                                ? step.scenes[index - 1]
                                : item,
                          ),
                        })
                      }
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChange({
                          ...step,
                          scenes: step.scenes.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
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
                    <select
                      className={selectClassName}
                      value={entry.use_scene_transition ? 'scene' : 'none'}
                      onChange={(event) =>
                        onChange({
                          ...step,
                          scenes: step.scenes.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  use_scene_transition:
                                    event.target.value === 'scene',
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="scene">Use scene transitions</option>
                      <option value="none">No transition (instant)</option>
                    </select>
                  </ConfigField>
                  <ConfigField
                    label="Transition override"
                    description="Optional explicit fade duration for this entry."
                  >
                    <DurationInput
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
            rollout={step.rollout}
            onChange={(rollout) =>
              onChange({ ...step, rollout } as unknown as NativeAction)
            }
          />
          {step.rollout ? (
            <RolloutEditor
              rollout={step.rollout}
              devices={devices}
              onChange={(rollout) =>
                onChange({ ...step, rollout } as unknown as NativeAction)
              }
            />
          ) : null}
          {step.scenes.length === 0 ? (
            <p className="text-xs text-destructive">Add at least one scene.</p>
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
            <select
              className={selectClassName}
              value={step.power ? 'true' : 'false'}
              onChange={(event) =>
                onChange({ ...step, power: event.target.value === 'true' })
              }
            >
              <option value="true">Turn on</option>
              <option value="false">Turn off</option>
            </select>
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
              <Input
                type="number"
                step="0.05"
                min={-1}
                max={1}
                value={step.step}
                onChange={(event) => {
                  const parsed = event.target.valueAsNumber;
                  onChange({
                    ...step,
                    step: Number.isNaN(parsed) ? 0 : parsed,
                  });
                }}
              />
            </ConfigField>
            <ConfigField
              label="Transition"
              description="Optional fade duration."
            >
              <DurationInput
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
          <div className="grid gap-3 sm:grid-cols-3">
            <ConfigField
              label="Min saturation"
              description="Inclusive lower bound. Defaults to 0.2."
            >
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                placeholder="0.2"
                value={step.min_saturation ?? ''}
                onChange={(event) => {
                  const parsed = event.target.valueAsNumber;
                  onChange({
                    ...step,
                    min_saturation: Number.isNaN(parsed) ? undefined : parsed,
                  } as unknown as NativeAction);
                }}
              />
            </ConfigField>
            <ConfigField
              label="Max saturation"
              description="Inclusive upper bound. Defaults to 1.0."
            >
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                placeholder="1.0"
                value={step.max_saturation ?? ''}
                onChange={(event) => {
                  const parsed = event.target.valueAsNumber;
                  onChange({
                    ...step,
                    max_saturation: Number.isNaN(parsed) ? undefined : parsed,
                  } as unknown as NativeAction);
                }}
              />
            </ConfigField>
            <ConfigField
              label="Transition"
              description="Optional fade duration."
            >
              <DurationInput
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
          <TimerNameField
            value={step.timer}
            onChange={(timer) => onChange({ ...step, timer })}
            options={timerOptions}
            description={
              step.action === 'schedule_timer'
                ? 'Fails if this timer already has a live deadline.'
                : 'Replaces the current deadline if one exists.'
            }
          />
          <ConfigField label="Delay" className="max-w-md">
            <DurationInput
              valueMs={Number(step.delay_ms)}
              onChange={(delay_ms) =>
                onChange({ ...step, delay_ms } as unknown as NativeAction)
              }
            />
          </ConfigField>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 rounded border border-input bg-background accent-primary"
              checked={step.capture_target_intents !== undefined}
              onChange={(event) =>
                onChange({
                  ...step,
                  capture_target_intents: event.target.checked ? {} : undefined,
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
        <TimerNameField
          value={step.timer}
          onChange={(timer) => onChange({ ...step, timer })}
          options={timerOptions}
          description="Cancelling a timer that is not running succeeds."
        />
      );

    case 'set_helper': {
      const helper = helpers.find((candidate) => candidate.id === step.helper);
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfigField label="Helper">
            <SearchablePicker
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
                  value: helperDefaultValue(
                    helpers.find((candidate) => candidate.id === selected),
                  ),
                })
              }
              placeholder="Select helper…"
            />
          </ConfigField>
          <ConfigField label="Value">
            <HelperValueEditor
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
            <select
              className={selectClassName}
              value={step.mode}
              onChange={(event) =>
                onChange({ ...step, mode: event.target.value as InvokeMode })
              }
            >
              <option value="fire_and_forget">Fire and forget</option>
              <option value="await_completion">Await completion</option>
            </select>
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
          timerOptions={timerOptions}
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
  timerOptions,
  open = true,
  onToggleOpen,
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
  timerOptions: PickerOption[];
  /**
   * Only one step's fields are open at a time; the row stays a sentence. Left
   * undefined the fields stay open, which is what nested branch steps do.
   */
  open?: boolean;
  onToggleOpen?: () => void;
  onChange: (step: NativeAction) => void;
  onRemove: () => void;
  onMove: (offset: number) => void;
  onDuplicate?: () => void;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {index + 1}. {stepKindLabels[step.action]}
              </span>
              <span className="text-xs text-muted-foreground">
                {summarizeStep(step)}
              </span>
            </div>
            {open ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <ConfigField
                  label="Step type"
                  description="Changing the type replaces this step's settings."
                >
                  <SearchablePicker
                    options={stepKindOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    value={step.action}
                    onChange={(kind) =>
                      onChange(
                        defaultStep(
                          kind as StepKind,
                          nextNodeId(
                            kind,
                            existingIds.filter((id) => id !== step.id),
                          ),
                        ),
                      )
                    }
                  />
                </ConfigField>
                <ConfigField
                  label="Step ID"
                  description="Stable node id used in logs."
                >
                  <Input
                    className="font-mono"
                    value={step.id}
                    onChange={(event) =>
                      onChange({
                        ...step,
                        id: event.target.value,
                      } as NativeAction)
                    }
                  />
                </ConfigField>
                <ConfigField
                  label="Step ID"
                  description="Stable node id used in logs."
                >
                  <Input
                    className="font-mono"
                    value={step.id}
                    onChange={(event) =>
                      onChange({
                        ...step,
                        id: event.target.value,
                      } as NativeAction)
                    }
                  />
                </ConfigField>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {onToggleOpen ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                onClick={onToggleOpen}
              >
                {open ? 'Close' : 'Edit'}
              </Button>
            ) : null}
            {/* Reordering and removal belong to the step being edited: a row at
                rest shows what it does, not a row of buttons. */}
            {!onToggleOpen || open ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Move earlier"
                  disabled={index === 0}
                  onClick={() => onMove(-1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Move later"
                  disabled={index === total - 1}
                  onClick={() => onMove(1)}
                >
                  ↓
                </Button>
                {onDuplicate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Duplicate step ${index + 1}`}
                    onClick={onDuplicate}
                  >
                    <Copy aria-hidden />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={onRemove}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {open ? (
          <StepFields
            step={step}
            onChange={onChange}
            devices={devices}
            groups={groups}
            scenes={scenes}
            routines={routines}
            helpers={helpers}
            existingIds={existingIds}
            timerOptions={timerOptions}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function defaultDeclaration(
  kind: ScriptDeclaration['kind'],
): ScriptDeclaration {
  switch (kind) {
    case 'device':
      return {
        kind: 'device',
        device: { integration_id: '', device_id: '' },
      };
    case 'group':
      return { kind: 'group', group_id: '' };
    case 'timer':
      return { kind: 'timer', timer: '' };
    case 'all_state':
      return { kind: 'all_state' };
  }
}

function ScriptProgramEditor({
  spec,
  onChange,
  devices,
  groups,
}: {
  spec: ScriptSpec;
  onChange: (spec: ScriptSpec) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
}) {
  const [newDeclarationKind, setNewDeclarationKind] =
    useState<ScriptDeclaration['kind']>('device');

  const updateDeclaration = (index: number, declaration: ScriptDeclaration) => {
    onChange({
      ...spec,
      declarations: spec.declarations.map((candidate, candidateIndex) =>
        candidateIndex === index ? declaration : candidate,
      ),
    });
  };

  const addDeclaration = () => {
    onChange({
      ...spec,
      declarations: [
        ...spec.declarations,
        defaultDeclaration(newDeclarationKind),
      ],
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField
          label="API version"
          description="Only version 1 is supported by this server."
        >
          <Input className="font-mono" value={spec.api_version} readOnly />
        </ConfigField>
        <ConfigField
          label="Limits profile"
          description="Only 'default' is supported by this server."
        >
          <Input className="font-mono" value={spec.limits_profile} readOnly />
        </ConfigField>
      </div>

      <ConfigField
        label="Function body"
        description="Runs in the sandboxed worker after a trigger fires and the condition holds. ctx and api are typed and autocompleted; return { actions, next_state? }."
      >
        <RoutineScriptEditor
          value={spec.source_body}
          onChange={(source_body) => onChange({ ...spec, source_body })}
        />
      </ConfigField>

      <div className="space-y-3">
        <div>
          <h5 className="text-sm font-medium">Declarations</h5>
          <p className="text-sm text-muted-foreground">
            Declarations decide when the script runs and which state it may
            read. Undeclared reads are absent; devices and groups may be
            declared before they are discovered.
          </p>
        </div>

        {spec.declarations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-3 text-center text-sm text-muted-foreground">
            No declarations. The script only sees the triggering frame and its
            own memory.
          </div>
        ) : null}

        {spec.declarations.map((declaration, index) => (
          <div
            key={`${declaration.kind}:${index}`}
            className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 bg-muted/20 p-3"
          >
            <ConfigField label="Kind" className="min-w-44">
              <select
                className={selectClassName}
                value={declaration.kind}
                onChange={(event) =>
                  updateDeclaration(
                    index,
                    defaultDeclaration(
                      event.target.value as ScriptDeclaration['kind'],
                    ),
                  )
                }
              >
                <option value="device">Device</option>
                <option value="group">Group</option>
                <option value="timer">Timer</option>
                <option value="all_state">All state (broad)</option>
              </select>
            </ConfigField>

            {declaration.kind === 'device' ? (
              <ConfigField label="Device" className="min-w-64">
                <DeviceSelect
                  devices={devices}
                  value={
                    declaration.device.integration_id &&
                    declaration.device.device_id
                      ? `${declaration.device.integration_id}/${declaration.device.device_id}`
                      : ''
                  }
                  onChange={(key) =>
                    updateDeclaration(index, {
                      kind: 'device',
                      device: splitDeviceKey(key) ?? {
                        integration_id: '',
                        device_id: '',
                      },
                    })
                  }
                />
              </ConfigField>
            ) : null}

            {declaration.kind === 'group' ? (
              <ConfigField label="Group" className="min-w-64">
                <GroupSelect
                  groups={groups}
                  value={declaration.group_id}
                  onChange={(group_id) =>
                    updateDeclaration(index, { kind: 'group', group_id })
                  }
                />
              </ConfigField>
            ) : null}

            {declaration.kind === 'timer' ? (
              <ConfigField label="Timer name" className="min-w-64">
                <Input
                  className="font-mono"
                  value={declaration.timer}
                  placeholder="off"
                  onChange={(event) =>
                    updateDeclaration(index, {
                      kind: 'timer',
                      timer: event.target.value,
                    })
                  }
                />
              </ConfigField>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                onChange({
                  ...spec,
                  declarations: spec.declarations.filter(
                    (_, candidateIndex) => candidateIndex !== index,
                  ),
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selectClassName}
            value={newDeclarationKind}
            onChange={(event) =>
              setNewDeclarationKind(
                event.target.value as ScriptDeclaration['kind'],
              )
            }
          >
            <option value="device">Device</option>
            <option value="group">Group</option>
            <option value="timer">Timer</option>
            <option value="all_state">All state (broad)</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addDeclaration}
          >
            Add declaration
          </Button>
        </div>

        {spec.declarations.some(
          (declaration) => declaration.kind === 'all_state',
        ) ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            All state is a broad compatibility declaration: the script may read
            any device in the triggering frame. Prefer exact declarations.
          </p>
        ) : null}
      </div>
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
  routines: Array<{
    id: string;
    name: string;
    definition_v2?: { program?: unknown; triggers?: unknown[] } | null;
  }>;
  helpers: HelperRuntimeStatus[];
}) {
  const [newStepKind, setNewStepKind] = useState<StepKind>('activate_scene');
  // One step's fields open at a time: the row stays a sentence until opened.
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const liveTimersState = useTimers();
  const timerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const routine of routines) {
      collectTimerNames(routine.definition_v2, names);
    }
    collectTimerNames(program, names);

    const runningIn = new Map<string, Set<string>>();
    const routineNames = new Map(
      routines.map((routine) => [routine.id, routine.name]),
    );
    for (const timer of liveTimersState ?? []) {
      names.add(timer.timer);
      const active = runningIn.get(timer.timer) ?? new Set<string>();
      active.add(routineNames.get(timer.routine_id) ?? timer.routine_id);
      runningIn.set(timer.timer, active);
    }

    return [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const activeRoutines = runningIn.get(name);
        return {
          value: name,
          label: name,
          detail: activeRoutines
            ? `Running in ${[...activeRoutines].join(', ')}`
            : 'Saved timer name',
        };
      });
  }, [liveTimersState, program, routines]);

  const handleStepChange = useCallback(
    (index: number, next: NativeAction) => {
      if (program?.kind !== 'native') {
        return;
      }
      onChange({
        kind: 'native',
        steps: program.steps.map((step, stepIndex) =>
          stepIndex === index ? next : step,
        ),
      });
    },
    [program, onChange],
  );

  const handleMove = useCallback(
    (index: number, offset: number) => {
      if (program?.kind !== 'native') {
        return;
      }
      const target = index + offset;
      if (target < 0 || target >= program.steps.length) {
        return;
      }
      const steps = [...program.steps];
      const [moved] = steps.splice(index, 1);
      steps.splice(target, 0, moved);
      onChange({ kind: 'native', steps });
    },
    [program, onChange],
  );

  const changeProgramKind = (kind: Program['kind']) => {
    if (kind === 'native') {
      onChange({ kind: 'native', steps: [] });
      return;
    }
    onChange({
      kind: 'script',
      spec: {
        api_version: 1,
        source_body: '',
        declarations: [],
        limits_profile: 'default',
      },
    });
  };

  const steps = program?.kind === 'native' ? program.steps : [];
  const existingIds = collectStepIds(steps);
  const duplicateIds = new Set(
    existingIds.filter((id, index) => existingIds.indexOf(id) !== index),
  );

  const addStep = (kind: StepKind) => {
    const step = defaultStep(
      kind,
      nextNodeId(kind, [...existingIds, ...duplicateIds]),
    );
    onChange({ kind: 'native', steps: [...steps, step] });
    setOpenStepId(step.id);
  };

  const duplicateStep = (index: number) => {
    const source = steps[index];
    if (!source) {
      return;
    }
    const id = nextNodeId(source.action, [...existingIds, ...duplicateIds]);
    const copy = { ...JSON.parse(JSON.stringify(source)), id } as NativeAction;
    onChange({
      kind: 'native',
      steps: [...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)],
    });
    setOpenStepId(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">Actions</h4>
          <p className="text-sm text-muted-foreground">
            These steps run in order once a trigger fires and the conditions
            hold. Each row is one step: open it to change it.
          </p>
        </div>
        <Advanced summary="Program type">
          <ConfigField label="Program type" className="min-w-56">
            <select
              className={selectClassName}
              value={program?.kind ?? ''}
              onChange={(event) =>
                changeProgramKind(event.target.value as Program['kind'])
              }
            >
              {program === undefined ? (
                <option value="">Select type...</option>
              ) : null}
              <option value="native">Steps in order</option>
              <option value="script">Sandboxed script</option>
            </select>
          </ConfigField>
        </Advanced>
      </div>

      {program === undefined ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This routine has no actions yet. Most routines just switch things on
            or off.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => changeProgramKind('native')}
            >
              Add steps
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => changeProgramKind('script')}
            >
              Write a script
            </Button>
          </div>
        </div>
      ) : program.kind === 'script' ? (
        <ScriptProgramEditor
          spec={program.spec}
          onChange={(spec) => onChange({ kind: 'script', spec })}
          devices={devices}
          groups={groups}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <ConfigField label="Add step" className="min-w-64">
              <SearchablePicker
                options={stepKindOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={newStepKind}
                onChange={(kind) => setNewStepKind(kind as StepKind)}
              />
            </ConfigField>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addStep(newStepKind)}
            >
              Add step
            </Button>
          </div>

          {steps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No steps yet. An enabled routine needs at least one, otherwise
              there is nothing to run.
            </div>
          ) : (
            <div className="space-y-3">
              {steps.map((step, index) => (
                <StepEditor
                  key={`${step.id}:${index}`}
                  step={step}
                  index={index}
                  total={steps.length}
                  open={openStepId === step.id}
                  onToggleOpen={() =>
                    setOpenStepId(openStepId === step.id ? null : step.id)
                  }
                  onDuplicate={() => duplicateStep(index)}
                  devices={devices}
                  groups={groups}
                  scenes={scenes}
                  routines={routines}
                  helpers={helpers}
                  existingIds={existingIds}
                  timerOptions={timerOptions}
                  onChange={(next) => handleStepChange(index, next)}
                  onRemove={() => {
                    if (openStepId === step.id) {
                      setOpenStepId(null);
                    }
                    onChange({
                      kind: 'native',
                      steps: steps.filter(
                        (_, stepIndex) => stepIndex !== index,
                      ),
                    });
                  }}
                  onMove={(offset) => handleMove(index, offset)}
                />
              ))}
            </div>
          )}

          {duplicateIds.size > 0 ? (
            <p className="text-xs text-destructive">
              Step IDs must be unique across the program, including choose
              branch steps.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export default ProgramBuilder;
