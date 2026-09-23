import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { NativeAction } from '@/bindings/NativeAction';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { TargetSpec } from '@/bindings/TargetSpec';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import type { Routine } from '@/hooks/useConfig';
import { getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';
import { describeCondition } from '@/ui/ConditionBuilder';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  StatusBadge,
  formatDue,
  formatUnknownReason,
  triggerBadge,
  triggerLabel,
} from '@/ui/routine-runtime';

type NameList = { id: string; name: string }[];

function deviceRefKey(device: {
  integration_id: string;
  device_id: string;
}): string {
  return `${device.integration_id}/${device.device_id}`;
}

function targetSummary(
  targets: TargetSpec | undefined,
  devices: DevicesState,
  groups: FlattenedGroupsConfig,
  deviceDisplayNameMap: Record<string, string>,
): string {
  if (!targets) return 'devices';
  const parts: string[] = [];
  for (const groupId of targets.groups ?? []) {
    parts.push(groups[groupId]?.name ?? groupId);
  }
  for (const ref of targets.devices ?? []) {
    const key = deviceRefKey(ref);
    const device = devices[key];
    parts.push(
      device
        ? getDeviceDisplayLabelFromKey(key, device.name, deviceDisplayNameMap)
        : getDeviceDisplayLabelFromKey(key, key, deviceDisplayNameMap),
    );
  }
  if (parts.length <= 2) return parts.join(', ') || 'devices';
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`;
}

function nameFor(items: NameList, id: string | undefined): string {
  if (!id) return '?';
  return items.find((item) => item.id === id)?.name ?? id;
}

function describeStep(
  step: NativeAction,
  devices: DevicesState,
  groups: FlattenedGroupsConfig,
  scenes: NameList,
  routines: NameList,
  deviceDisplayNameMap: Record<string, string>,
): string {
  switch (step.action) {
    case 'activate_scene': {
      if (step.select) {
        return step.select.kind === 'helper_enum'
          ? `Activate a scene chosen by helper ${step.select.helper}`
          : `Activate the scene for ${targetSummary(step.select.group_id ? { groups: [step.select.group_id] } : undefined, devices, groups, deviceDisplayNameMap)}`;
      }
      return step.scene_id
        ? `Activate “${nameFor(scenes, step.scene_id)}”`
        : 'Activate a scene';
    }
    case 'cycle_scenes':
      return `Cycle ${step.scenes
        .map((scene) => `“${nameFor(scenes, scene.scene_id)}”`)
        .join(' → ')}${step.nowrap ? ' (stop at last)' : ''}`;
    case 'set_power': {
      const key = deviceRefKey(step.device);
      const device = devices[key];
      const label = device
        ? getDeviceDisplayLabelFromKey(key, device.name, deviceDisplayNameMap)
        : getDeviceDisplayLabelFromKey(key, key, deviceDisplayNameMap);
      return step.power ? `Turn on ${label}` : `Turn off ${label}`;
    }
    case 'dim':
      return `Dim ${targetSummary(step.targets, devices, groups, deviceDisplayNameMap)} by ${step.step}`;
    case 'randomize_color':
      return `Randomize color for ${targetSummary(step.targets, devices, groups, deviceDisplayNameMap)}`;
    case 'schedule_timer':
      return `Start timer “${step.timer || '?'}”`;
    case 'replace_timer':
      return `Restart timer “${step.timer || '?'}”`;
    case 'cancel_timer':
      return `Cancel timer “${step.timer || '?'}”`;
    case 'set_helper':
      return `Set helper ${step.helper || '?'} to ${JSON.stringify(step.value)}`;
    case 'invoke_routine':
      return `Run routine “${nameFor(routines, step.routine_id)}”`;
    case 'choose':
      return `Choose between ${step.branches.length} branch${step.branches.length === 1 ? '' : 'es'}`;
  }
}

function ConditionTree({
  condition,
  resolveDevice,
  depth = 0,
}: {
  condition: unknown;
  resolveDevice: (ref: { integration_id: string; device_id: string }) => string;
  depth?: number;
}) {
  const expr =
    condition && typeof condition === 'object'
      ? (condition as {
          kind?: string;
          conditions?: unknown[];
          condition?: unknown;
        })
      : null;
  if (expr?.kind === 'all' || expr?.kind === 'any') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {expr.kind === 'all' ? 'All of' : 'Any of'}
        </p>
        <ul className="space-y-1 border-l border-border pl-3">
          {(expr.conditions ?? []).map((child, index) => (
            <li key={index}>
              <ConditionTree
                condition={child}
                resolveDevice={resolveDevice}
                depth={depth + 1}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (expr?.kind === 'not') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Not
        </p>
        <div className="border-l border-border pl-3">
          <ConditionTree
            condition={expr.condition}
            resolveDevice={resolveDevice}
            depth={depth + 1}
          />
        </div>
      </div>
    );
  }
  return (
    <p className="text-sm">{describeCondition(condition, resolveDevice)}</p>
  );
}

function StepList({
  steps,
  devices,
  groups,
  scenes,
  routines,
  deviceDisplayNameMap,
}: {
  steps: NativeAction[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: NameList;
  routines: NameList;
  deviceDisplayNameMap: Record<string, string>;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No steps in this program.</p>
    );
  }
  return (
    <ol className="space-y-1.5">
      {steps.map((step, index) => (
        <li key={step.id} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <span className="min-w-0">
            <span className="mr-2 align-middle">
              <Badge variant="outline">
                {step.action.replaceAll('_', ' ')}
              </Badge>
            </span>
            {describeStep(
              step,
              devices,
              groups,
              scenes,
              routines,
              deviceDisplayNameMap,
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Read-only glance at what a v2 routine does: when it triggers, what the
 * condition is and what the program will run. Live status badges appear when
 * the routine is enabled and the server reports runtime state.
 */
export function V2RoutineSummary({
  routine,
  status,
  devices,
  groups,
  scenes,
  routines,
  deviceDisplayNameMap,
  onEdit,
}: {
  routine: Routine;
  status?: RoutineRuntimeStatus;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: NameList;
  routines: NameList;
  deviceDisplayNameMap: Record<string, string>;
  onEdit?: (section: 'when' | 'if' | 'then') => void;
}) {
  const definition = routine.definition_v2;
  if (!definition) return null;
  const triggerSpecs: TriggerSpec[] = definition.triggers ?? [];
  const v2 = status?.v2;
  const program = definition.program as
    | { kind?: string; steps?: NativeAction[]; script?: string }
    | undefined;
  const steps = program?.kind === 'native' ? (program.steps ?? []) : [];
  const truth = v2?.condition.truth;

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-border bg-background/70 p-3">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">When</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {triggerSpecs.length}{' '}
              {triggerSpecs.length === 1 ? 'trigger' : 'triggers'}
            </span>
            {onEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onEdit('when')}
              >
                Edit
              </Button>
            )}
          </div>
        </header>
        <div className="mt-2 space-y-2">
          {triggerSpecs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This routine has no triggers yet.
            </p>
          ) : (
            triggerSpecs.map((spec) => {
              const runtime = v2?.triggers.find(
                (candidate) => candidate.trigger_id === spec.id,
              );
              const badge = runtime ? triggerBadge(runtime) : null;
              return (
                <div
                  key={spec.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border/70 p-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {spec.kind.replaceAll('_', ' ')}
                      </Badge>
                      <span className="text-sm font-medium">
                        {triggerLabel(spec, devices, deviceDisplayNameMap) ??
                          spec.id}
                      </span>
                    </div>
                    {runtime?.armed && runtime.due_wall_ms !== undefined ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Next fire{' '}
                        {formatDue(Number(runtime.due_wall_ms), Date.now())}
                      </p>
                    ) : null}
                    {runtime?.error ? (
                      <p className="mt-1 text-xs text-destructive">
                        {runtime.error}
                      </p>
                    ) : null}
                    {runtime?.unknown_reason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Unknown: {formatUnknownReason(runtime.unknown_reason)}
                      </p>
                    ) : null}
                  </div>
                  {badge ? (
                    <StatusBadge label={badge.label} tone={badge.tone} />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-background/70 p-3">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">If</h3>
          <div className="flex items-center gap-2">
            {runtimeTruthBadge(truth)}
            {onEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onEdit('if')}
              >
                Edit
              </Button>
            )}
          </div>
        </header>
        <div className="mt-2">
          <ConditionTree
            condition={definition.condition}
            resolveDevice={(ref) => {
              const key = deviceRefKey(ref);
              const device = devices[key];
              return getDeviceDisplayLabelFromKey(
                key,
                device?.name ?? key,
                deviceDisplayNameMap,
              );
            }}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-background/70 p-3">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Then</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {program?.kind === 'script'
                ? 'script'
                : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
            </span>
            {onEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onEdit('then')}
              >
                Edit
              </Button>
            )}
          </div>
        </header>
        <div className="mt-2">
          {program?.kind === 'script' ? (
            <pre className="max-h-48 overflow-auto rounded-xl bg-muted/40 p-2.5 text-xs">
              {program.script ?? ''}
            </pre>
          ) : (
            <StepList
              steps={steps}
              devices={devices}
              groups={groups}
              scenes={scenes}
              routines={routines}
              deviceDisplayNameMap={deviceDisplayNameMap}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function runtimeTruthBadge(truth: string | undefined) {
  if (truth === 'true') return <StatusBadge label="Met" tone="success" />;
  if (truth === 'false') return <StatusBadge label="Not met" tone="error" />;
  if (truth === 'unknown')
    return <StatusBadge label="Unknown" tone="warning" />;
  return null;
}

export default V2RoutineSummary;
