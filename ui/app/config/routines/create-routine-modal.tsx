import { useMemo, useState } from 'react';

import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { NativeAction } from '@/bindings/NativeAction';
import type { Program } from '@/bindings/Program';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import type { RoutineDefinitionV2Body, Routine } from '@/hooks/useConfig';
import {
  ActionBuilder,
  type Action,
  validateActions,
} from '@/ui/ActionBuilder';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { ProgramBuilder } from '@/ui/ProgramBuilder';
import { RuleBuilder, type Rule } from '@/ui/RuleBuilder';
import { RoutineWhatIfPreview } from '@/ui/RoutineWhatIfPreview';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { TriggerBuilder } from '@/ui/TriggerBuilder';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigToggleRow,
} from '@/ui/config-form';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { checkboxClassName } from '@/ui/form-styles';
import { RoutineActionList, RoutineRuleList } from '@/ui/routine-summary';
import type { AssistantDraft } from '@/hooks/useAssistant';
import { AssistantDraftPanel } from './assistant-draft-panel';

type V2DraftKind = 'blank' | 'sensor' | 'motion' | 'occupancy' | 'schedule';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function v2Draft(kind: V2DraftKind): RoutineDefinitionV2Body {
  const trigger: TriggerSpec =
    kind === 'sensor'
      ? {
          kind: 'state_change',
          id: 'state_change_1',
          device: { integration_id: '', device_id: '' },
          mode: 'transition',
        }
      : kind === 'motion'
        ? {
            kind: 'report',
            id: 'report_1',
            device: { integration_id: '', device_id: '' },
          }
        : kind === 'occupancy'
          ? {
              kind: 'state_change',
              id: 'state_change_1',
              device: { integration_id: '', device_id: '' },
              mode: 'level',
            }
          : kind === 'schedule'
            ? {
                kind: 'schedule',
                id: 'schedule_1',
                schedule: {
                  cron: '0 0 8 * * *',
                  timezone: 'Europe/Helsinki',
                  backlog: 'skip',
                },
              }
            : { kind: 'manual', id: 'manual_1' };

  const condition: ConditionExpr =
    kind === 'motion' || kind === 'occupancy'
      ? {
          kind: 'comparison',
          source: {
            kind: 'device',
            device: { integration_id: '', device_id: '' },
            path: '/value',
          },
          operator: 'eq',
          value: true,
        }
      : { kind: 'literal', value: true };

  return {
    triggers: [trigger],
    condition,
    program: {
      kind: 'native',
      steps: [
        {
          action: 'activate_scene',
          id: 'activate_scene_1',
          scene_id: '',
          targets: {},
        } as unknown as NativeAction,
      ],
    },
  };
}

function walkNativeSteps(steps: NativeAction[]): NativeAction[] {
  const all: NativeAction[] = [];
  for (const step of steps) {
    all.push(step);
    if (step.action === 'choose') {
      for (const branch of step.branches) {
        all.push(...walkNativeSteps(branch.steps));
      }
    }
  }
  return all;
}

function hasEmptyConditionGroup(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') {
    return false;
  }
  const expr = condition as ConditionExpr;
  switch (expr.kind) {
    case 'all':
    case 'any':
      return (
        expr.conditions.length === 0 ||
        expr.conditions.some((child) => hasEmptyConditionGroup(child))
      );
    case 'not':
      return hasEmptyConditionGroup(expr.condition);
    default:
      return false;
  }
}

function validateV2Draft(definition: RoutineDefinitionV2Body): string | null {
  if ((definition.triggers ?? []).length === 0) {
    return 'Add at least one trigger.';
  }

  const program = definition.program as Program | undefined;
  if (!program) {
    return 'Add a native or script program.';
  }
  if (program.kind === 'native') {
    if (program.steps.length === 0) {
      return 'Add at least one program step.';
    }
    const steps = walkNativeSteps(program.steps);
    const missingScene = steps.some(
      (step) =>
        step.action === 'activate_scene' && !step.select && !step.scene_id,
    );
    if (missingScene) {
      return 'Choose a scene for each scene activation.';
    }
    const missingCycleScene = steps.some(
      (step) =>
        step.action === 'cycle_scenes' &&
        (step.scenes.length === 0 ||
          step.scenes.some((entry) => !entry.scene_id)),
    );
    if (missingCycleScene) {
      return 'Add at least one scene to each scene cycle.';
    }
  } else if (!program.spec.source_body.trim()) {
    return 'Add a script body.';
  }

  if (hasEmptyConditionGroup(definition.condition)) {
    return 'Add at least one child to each all/any condition.';
  }

  const execution = definition.execution as ExecutionPolicy | undefined;
  if (execution) {
    if (
      !Number.isInteger(execution.max_actions) ||
      execution.max_actions < 1 ||
      execution.max_actions > 64
    ) {
      return 'Max actions must be between 1 and 64.';
    }
    const minIntervalMs =
      execution.min_interval_ms === undefined
        ? undefined
        : Number(execution.min_interval_ms);
    if (
      minIntervalMs !== undefined &&
      (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0)
    ) {
      return 'Minimum spacing must be a positive duration.';
    }
  }

  return null;
}

export function CreateRoutineModal({
  onClose,
  onCreate,
  devices,
  groups,
  scenes,
  routines,
  helpers,
}: {
  onClose: () => void;
  onCreate: (routine: Partial<Routine>) => Promise<void>;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: Routine[];
  helpers: HelperRuntimeStatus[];
}) {
  const [semantics, setSemantics] = useState<1 | 2>(2);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [definition, setDefinition] = useState<RoutineDefinitionV2Body>(() =>
    v2Draft('blank'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [startFrom, setStartFrom] = useState('blank');

  const applyAssistantDraft = (draft: AssistantDraft) => {
    setDefinition(draft.definition);
    setPreview(false);
    setError(null);
    if (!name.trim() && draft.name) {
      setName(draft.name);
      if (!id.trim()) {
        const slug = slugify(draft.name);
        if (slug) {
          setId(slug);
        }
      }
    }
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add Routine"
      description="Create a new automation routine."
      presentation="page"
      className="max-w-4xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <ConfigFormSection
          title="Routine identity"
          description={
            semantics === 2
              ? 'Pick a starting point, then edit triggers, condition, and program before saving.'
              : 'Choose a starting point, edit its rules and actions, then review before saving.'
          }
        >
          <ConfigField
            label="Routine type"
            description="Native v2 routines use triggers, a condition, and a program. Legacy v1 routines use rules and actions."
          >
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={semantics}
              onChange={(event) => {
                const next = Number(event.target.value) as 1 | 2;
                setSemantics(next);
                setPreview(false);
                setStartFrom('blank');
                if (next === 2) {
                  setDefinition(v2Draft('blank'));
                } else {
                  setRules([]);
                  setActions([]);
                }
              }}
            >
              <option value={2}>Native v2 (recommended)</option>
              <option value={1}>Legacy v1 (rules and actions)</option>
            </select>
          </ConfigField>
          <ConfigField label="Start from">
            <SearchablePicker
              value={startFrom}
              options={
                semantics === 2
                  ? [
                      {
                        value: 'blank',
                        label: 'Blank routine (manual trigger)',
                      },
                      {
                        value: 'sensor',
                        label: 'Device change activates a scene',
                      },
                      {
                        value: 'motion',
                        label: 'Motion report activates a scene',
                      },
                      { value: 'occupancy', label: 'Occupancy holds a scene' },
                      {
                        value: 'schedule',
                        label: 'Schedule activates a scene',
                      },
                      ...routines
                        .filter(
                          (routine) =>
                            routine.semantics_version === 2 ||
                            Boolean(routine.definition_v2),
                        )
                        .map((routine) => ({
                          value: `copy:${routine.id}`,
                          label: routine.name,
                          detail: `Copy routine · ${routine.id}`,
                        })),
                    ]
                  : [
                      { value: 'blank', label: 'Blank routine' },
                      { value: 'sensor', label: 'Sensor activates a scene' },
                      ...routines
                        .filter(
                          (routine) =>
                            routine.semantics_version !== 2 &&
                            !routine.definition_v2,
                        )
                        .map((routine) => ({
                          value: `copy:${routine.id}`,
                          label: routine.name,
                          detail: `Copy routine · ${routine.id}`,
                        })),
                    ]
              }
              onChange={(value) => {
                setPreview(false);
                setStartFrom(value);
                if (semantics === 2) {
                  if (
                    value === 'blank' ||
                    value === 'sensor' ||
                    value === 'motion' ||
                    value === 'occupancy' ||
                    value === 'schedule'
                  ) {
                    setDefinition(v2Draft(value));
                    return;
                  }
                  const source = routines.find(
                    (routine) => routine.id === value.slice(5),
                  );
                  if (source?.definition_v2) {
                    setDefinition(structuredClone(source.definition_v2));
                  }
                  return;
                }
                if (value === 'blank') {
                  setRules([]);
                  setActions([]);
                  return;
                }
                if (value === 'sensor') {
                  setRules([{ state: { value: true }, trigger_mode: 'pulse' }]);
                  setActions([{ action: 'ActivateScene', scene_id: '' }]);
                  return;
                }
                const source = routines.find(
                  (routine) => routine.id === value.slice(5),
                );
                if (source) {
                  setRules(structuredClone(source.rules) as Rule[]);
                  setActions(structuredClone(source.actions) as Action[]);
                }
              }}
            />
          </ConfigField>
          <ConfigField label="Routine ID">
            <Input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="motion-lights"
            />
          </ConfigField>

          <ConfigField label="Name">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Motion Activated Lights"
            />
          </ConfigField>

          <ConfigToggleRow label="Enabled">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </ConfigToggleRow>
        </ConfigFormSection>

        {semantics === 2 ? (
          <div className="mt-4 space-y-4">
            <AssistantDraftPanel onDraft={applyAssistantDraft} />
            <RoutineWhatIfPreview definition={definition} devices={devices} />
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          {semantics === 2 ? (
            <div className="space-y-3">
              <details
                open
                className="rounded-2xl border border-border bg-background/70 p-4"
              >
                <summary className="cursor-pointer font-semibold">
                  When · {definition.triggers?.length ?? 0} triggers
                </summary>
                <div className="mt-4">
                  <TriggerBuilder
                    triggers={definition.triggers ?? []}
                    onChange={(triggers: TriggerSpec[]) =>
                      setDefinition((current) => ({ ...current, triggers }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                  />
                </div>
              </details>
              <details className="rounded-2xl border border-border bg-background/70 p-4">
                <summary className="cursor-pointer font-semibold">
                  If · condition
                </summary>
                <div className="mt-4">
                  <ConditionEditor
                    condition={
                      (definition.condition as ConditionExpr | undefined) ?? {
                        kind: 'literal',
                        value: true,
                      }
                    }
                    onChange={(condition) =>
                      setDefinition((current) => ({ ...current, condition }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                  />
                </div>
              </details>
              <details className="rounded-2xl border border-border bg-background/70 p-4">
                <summary className="cursor-pointer font-semibold">
                  Then · actions in order
                </summary>
                <div className="mt-4">
                  <ProgramBuilder
                    program={definition.program as Program | undefined}
                    onChange={(program) =>
                      setDefinition((current) => ({ ...current, program }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    routines={routines}
                    helpers={helpers}
                  />
                </div>
              </details>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'This routine will be enabled when saved.'
                  : 'This routine will be saved disabled.'}
              </p>
            </div>
          ) : preview ? (
            <>
              <RoutineRuleList
                rules={rules}
                devices={devices}
                groups={groups}
                scenes={scenes}
                deviceDisplayNameMap={{}}
              />
              <RoutineActionList
                actions={actions}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                deviceDisplayNameMap={{}}
              />
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'This routine will be enabled when saved.'
                  : 'This routine will be saved disabled.'}
              </p>
            </>
          ) : (
            <>
              <RuleBuilder
                rules={rules}
                devices={devices}
                groups={groups}
                scenes={scenes}
                onChange={setRules}
              />
              <ActionBuilder
                actions={actions}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                onChange={setActions}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {semantics === 1 && (
            <Button variant="outline" onClick={() => setPreview(!preview)}>
              {preview ? 'Edit draft' : 'Preview'}
            </Button>
          )}
          <Button
            disabled={
              !id.trim() ||
              !name.trim() ||
              saving ||
              (semantics === 1 && !preview)
            }
            onClick={async () => {
              if (semantics === 2) {
                const validation = validateV2Draft(definition);
                if (validation) {
                  setError(validation);
                  return;
                }
                setSaving(true);
                setError(null);
                try {
                  await onCreate({
                    id: id.trim(),
                    name: name.trim(),
                    enabled,
                    semantics_version: 2,
                    definition_v2: definition,
                    rules: [],
                    actions: [],
                  });
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : 'Failed to create routine',
                  );
                } finally {
                  setSaving(false);
                }
                return;
              }

              const validation = validateActions(actions);
              if (validation) {
                setError(validation);
                return;
              }
              if (
                actions.some(
                  (action) =>
                    action.action === 'ActivateScene' &&
                    !action.scene_id.trim(),
                )
              ) {
                setError('Choose a scene for each scene activation.');
                return;
              }
              if (
                rules.some(
                  (rule) =>
                    'state' in rule &&
                    (!rule.integration_id || !rule.device_id),
                )
              ) {
                setError('Choose a device for each sensor rule.');
                return;
              }
              setSaving(true);
              setError(null);
              try {
                await onCreate({
                  id: id.trim(),
                  name: name.trim(),
                  enabled,
                  rules,
                  actions,
                });
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : 'Failed to create routine',
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            Create
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
