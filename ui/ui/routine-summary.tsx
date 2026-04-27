import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { RuleRuntimeStatus } from '@/bindings/RuleRuntimeStatus';
import type { TriggerMode } from '@/bindings/TriggerMode';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import {
  getDeviceDisplayLabel,
  getDeviceDisplayLabelFromKey,
} from '@/lib/deviceLabel';
import { cn } from '@/lib/cn';
import { resolveJsonPointer } from '../utils/jsonPointers';
import {
  type Action,
  type ActivateSceneAction,
  type CustomAction,
  type CycleScenesAction,
  TRIGGERING_DEVICE_ROLLOUT_SOURCE,
  type DimAction,
  type ForceTriggerRoutineAction,
  type SetDeviceStateAction,
  type ToggleDeviceOverrideAction,
  type UiAction,
  getActionType,
} from '@/ui/ActionBuilder';
import {
  type AnyRule,
  type DeviceRule,
  type GroupRule,
  type RawRule,
  type Rule,
  type ScriptRule,
  type SensorRule,
  getRuleType,
} from '@/ui/RuleBuilder';
import { Badge } from '@/ui/primitives/badge';
import { Card, CardContent } from '@/ui/primitives/card';

type BadgeTone =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'success'
  | 'error'
  | 'ghost';

const badgeToneClassName: Record<BadgeTone, string> = {
  primary: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  accent: 'border-transparent bg-accent text-accent-foreground',
  warning:
    'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  info: 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300',
  neutral: 'border-transparent bg-muted text-muted-foreground',
  success:
    'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error:
    'border-transparent bg-destructive/15 text-destructive dark:text-red-300',
  ghost: 'border-transparent bg-muted/70 text-muted-foreground',
};

function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <Badge className={badgeToneClassName[tone]}>{label}</Badge>;
}

function RuleStatusAside({
  statusBadge,
  triggerMode,
}: {
  statusBadge: ReturnType<typeof getRuleStatusBadge>;
  triggerMode?: TriggerMode;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <StatusBadge label={statusBadge.label} tone={statusBadge.tone} />
      {triggerMode ? (
        <Badge variant="outline">{formatTriggerMode(triggerMode)}</Badge>
      ) : null}
    </div>
  );
}

interface RoutineRuleListProps {
  rules: Rule[];
  status?: RoutineRuntimeStatus;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  deviceDisplayNameMap: Record<string, string>;
}

interface RoutineActionListProps {
  actions: Action[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  routines: Array<{ id: string; name: string }>;
  deviceDisplayNameMap: Record<string, string>;
}

function SectionCard({
  title,
  description,
  count,
  emptyMessage,
  children,
}: {
  title: string;
  description: string;
  count: number;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
              {title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant="outline">{count}</Badge>
        </div>

        <div className="mt-4 space-y-3">
          {count === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            children
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  badge,
  badgeTone,
  title,
  summary,
  meta,
  aside,
  children,
}: {
  badge: string;
  badgeTone: BadgeTone;
  title: string;
  summary: string;
  meta?: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl bg-background/70">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={badge} tone={badgeTone} />
              <h4 className="font-medium leading-tight">{title}</h4>
            </div>
            <p className="text-sm text-foreground/80">{summary}</p>
            {meta ? (
              <p className="text-xs text-muted-foreground">{meta}</p>
            ) : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>

        {children ? <div className="mt-3">{children}</div> : null}
      </CardContent>
    </Card>
  );
}

function getRuleStatusBadge(status?: RuleRuntimeStatus) {
  if (!status) {
    return { label: 'No live state', tone: 'ghost' as const };
  }

  if (status.error) {
    return { label: 'Error', tone: 'error' as const };
  }

  if (status.trigger_match) {
    return { label: 'Trigger-ready', tone: 'success' as const };
  }

  if (status.condition_match) {
    return { label: 'Matching', tone: 'info' as const };
  }

  return { label: 'Not matching', tone: 'ghost' as const };
}

function getRuleLiveNote(
  status: RuleRuntimeStatus | undefined,
  triggerMode?: TriggerMode,
) {
  if (!status) {
    return 'Live rule state appears once the websocket snapshot is available.';
  }

  if (status.error) {
    return status.error;
  }

  if (status.trigger_match) {
    return 'This rule would currently contribute to triggering the routine.';
  }

  if (status.condition_match) {
    if (triggerMode === 'pulse') {
      return 'The condition matches, but this rule still needs a matching source event.';
    }

    if (triggerMode === 'edge') {
      return 'The condition matches, but this rule is waiting for a transition into the matching state.';
    }

    return 'The current state matches this rule.';
  }

  return 'The current state does not match this rule.';
}

function getRoutineRuleSummary(
  status: RoutineRuntimeStatus | undefined,
  ruleCount: number,
) {
  if (ruleCount === 0) {
    return 'No rules configured yet.';
  }

  if (!status) {
    return 'All of these rules must be ready before the routine can trigger.';
  }

  const matchingRules = status.rules.filter(
    (ruleStatus) => ruleStatus.condition_match,
  ).length;

  if (status.will_trigger) {
    return `All ${ruleCount} rules are trigger-ready on the current update.`;
  }

  if (status.all_conditions_match) {
    return `All ${ruleCount} rules match the current state, but at least one rule is still waiting for its trigger mode.`;
  }

  return `${matchingRules}/${ruleCount} rules currently match the live state.`;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-2xl border border-border bg-muted/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </summary>
      <pre className="overflow-x-auto px-3 pb-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function buildLabelMap(items: Array<{ id: string; name: string }>) {
  return items.reduce<Record<string, string>>((labels, item) => {
    labels[item.id] = item.name;
    return labels;
  }, {});
}

function getDeviceRefKey(
  integrationId?: string,
  deviceId?: string,
  deviceName?: string,
) {
  if (!integrationId) {
    return null;
  }

  const suffix = deviceId ?? deviceName;
  return suffix ? `${integrationId}/${suffix}` : null;
}

function getDeviceRefLabel({
  integrationId,
  deviceId,
  deviceName,
  devices,
  deviceDisplayNameMap,
}: {
  integrationId?: string;
  deviceId?: string;
  deviceName?: string;
  devices: DevicesState;
  deviceDisplayNameMap: Record<string, string>;
}) {
  const deviceKey = getDeviceRefKey(integrationId, deviceId, deviceName);
  if (!deviceKey) {
    return { label: 'Unknown device', meta: undefined };
  }

  const liveDevice = devices[deviceKey];
  if (liveDevice) {
    return {
      label: getDeviceDisplayLabel(liveDevice, deviceDisplayNameMap),
      meta: deviceKey,
    };
  }

  return {
    label: getDeviceDisplayLabelFromKey(
      deviceKey,
      deviceId ?? deviceName ?? deviceKey,
      deviceDisplayNameMap,
    ),
    meta: deviceKey,
  };
}

function getDeviceKeyLabel(
  deviceKey: string,
  devices: DevicesState,
  deviceDisplayNameMap: Record<string, string>,
) {
  if (deviceKey === TRIGGERING_DEVICE_ROLLOUT_SOURCE) {
    return 'triggering device';
  }

  const liveDevice = devices[deviceKey];
  if (liveDevice) {
    return getDeviceDisplayLabel(liveDevice, deviceDisplayNameMap);
  }

  const fallbackLabel = deviceKey.split('/').slice(1).join('/') || deviceKey;
  return getDeviceDisplayLabelFromKey(
    deviceKey,
    fallbackLabel,
    deviceDisplayNameMap,
  );
}

function summarizeNames(items: string[], maxVisible = 2) {
  if (items.length === 0) {
    return '';
  }

  if (items.length <= maxVisible) {
    return items.join(', ');
  }

  return `${items.slice(0, maxVisible).join(', ')} +${items.length - maxVisible}`;
}

function formatTriggerMode(triggerMode: TriggerMode) {
  if (triggerMode === 'pulse') {
    return 'Pulse';
  }

  if (triggerMode === 'edge') {
    return 'Edge';
  }

  return 'Level';
}

function formatSensorState(rule: SensorRule) {
  if ('value' in rule.state) {
    if (typeof rule.state.value === 'boolean') {
      return rule.state.value ? 'sensor is on' : 'sensor is off';
    }

    if (typeof rule.state.value === 'number') {
      return `sensor value is ${rule.state.value}`;
    }

    return `sensor value is "${rule.state.value}"`;
  }

  const parts: string[] = [];
  if (rule.state.power !== undefined) {
    parts.push(`power is ${rule.state.power ? 'on' : 'off'}`);
  }
  if (rule.state.brightness !== undefined) {
    parts.push(`brightness is ${rule.state.brightness}`);
  }

  return parts.length > 0
    ? parts.join(' and ')
    : 'matches the configured sensor state';
}

function formatDeviceConditions(
  rule: Pick<DeviceRule | GroupRule, 'power' | 'scene'>,
  sceneLabels: Record<string, string>,
) {
  const conditions: string[] = [];

  if (rule.power !== undefined) {
    conditions.push(`power is ${rule.power ? 'on' : 'off'}`);
  }

  if (rule.scene) {
    conditions.push(`scene is ${sceneLabels[rule.scene] ?? rule.scene}`);
  }

  return conditions.length > 0
    ? conditions.join(' and ')
    : 'matches its configured state';
}

function getGroupLabel(groupId: string, groups: FlattenedGroupsConfig) {
  return groups[groupId]?.name ?? groupId;
}

function summarizeScript(script: string) {
  const firstLine = script
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? 'Evaluates a JavaScript expression';
}

function formatRawRuleValue(value: unknown) {
  if (typeof value === 'string') {
    return `"${value}"`;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatRawRuleSummary(rule: RawRule) {
  const operatorLabel = {
    eq: 'equals',
    ne: 'does not equal',
    gt: 'is greater than',
    gte: 'is greater than or equal to',
    lt: 'is less than',
    lte: 'is less than or equal to',
    contains: 'contains',
    starts_with: 'starts with',
    exists: 'exists',
    truthy: 'is truthy',
    regex: 'matches regex',
  }[rule.operator];

  if (rule.operator === 'exists' || rule.operator === 'truthy') {
    return `${rule.path || '(no path selected)'} ${operatorLabel}`;
  }

  return `${rule.path || '(no path selected)'} ${operatorLabel} ${formatRawRuleValue(rule.value)}`;
}

function summarizeFilters({
  deviceKeys,
  groupKeys,
  devices,
  groups,
  deviceDisplayNameMap,
}: {
  deviceKeys?: string[];
  groupKeys?: string[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  deviceDisplayNameMap: Record<string, string>;
}) {
  const filters: string[] = [];

  if (deviceKeys?.length) {
    const labels = deviceKeys.map((deviceKey) =>
      getDeviceKeyLabel(deviceKey, devices, deviceDisplayNameMap),
    );
    filters.push(`devices: ${summarizeNames(labels)}`);
  }

  if (groupKeys?.length) {
    const labels = groupKeys.map((groupKey) => getGroupLabel(groupKey, groups));
    filters.push(`groups: ${summarizeNames(labels)}`);
  }

  return filters;
}

function summarizeRollout({
  rollout,
  rollout_source_device_key,
  rollout_duration_ms,
  devices,
  deviceDisplayNameMap,
}: {
  rollout?: string;
  rollout_source_device_key?: string;
  rollout_duration_ms?: number;
  devices: DevicesState;
  deviceDisplayNameMap: Record<string, string>;
}) {
  if (!rollout) {
    return null;
  }

  const parts = [`rollout: ${rollout}`];
  if (rollout_source_device_key) {
    parts.push(
      `from ${getDeviceKeyLabel(
        rollout_source_device_key,
        devices,
        deviceDisplayNameMap,
      )}`,
    );
  }
  if (rollout_duration_ms !== undefined) {
    parts.push(`${rollout_duration_ms} ms`);
  }

  return parts.join(' · ');
}

function RuleSummaryItem({
  rule,
  status,
  devices,
  groups,
  sceneLabels,
  deviceDisplayNameMap,
  depth = 0,
}: {
  rule: Rule;
  status?: RuleRuntimeStatus;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  sceneLabels: Record<string, string>;
  deviceDisplayNameMap: Record<string, string>;
  depth?: number;
}) {
  const ruleType = getRuleType(rule);
  const nestedClassName = cn(depth > 0 && 'border-l border-border pl-3');
  const liveBadge = getRuleStatusBadge(status);

  if (ruleType === 'sensor') {
    const sensorRule = rule as SensorRule;
    const device = getDeviceRefLabel({
      integrationId: sensorRule.integration_id,
      deviceId: sensorRule.device_id,
      devices,
      deviceDisplayNameMap,
    });

    return (
      <div className={nestedClassName}>
        <SummaryCard
          badge="Sensor"
          badgeTone="secondary"
          title={device.label}
          summary={formatSensorState(sensorRule)}
          meta={[device.meta, getRuleLiveNote(status, sensorRule.trigger_mode)]
            .filter(Boolean)
            .join(' · ')}
          aside={
            <RuleStatusAside
              statusBadge={liveBadge}
              triggerMode={sensorRule.trigger_mode}
            />
          }
        />
      </div>
    );
  }

  if (ruleType === 'raw') {
    const rawRule = rule as RawRule;
    const device = getDeviceRefLabel({
      integrationId: rawRule.integration_id,
      deviceId: rawRule.device_id,
      devices,
      deviceDisplayNameMap,
    });
    const liveDevice =
      rawRule.integration_id && rawRule.device_id
        ? devices[`${rawRule.integration_id}/${rawRule.device_id}`]
        : undefined;
    const previewValue = liveDevice?.raw
      ? resolveJsonPointer(liveDevice.raw, rawRule.path)
      : undefined;

    return (
      <div className={nestedClassName}>
        <SummaryCard
          badge="Raw"
          badgeTone="neutral"
          title={device.label}
          summary={formatRawRuleSummary(rawRule)}
          meta={[
            device.meta,
            previewValue === undefined
              ? undefined
              : `current: ${formatRawRuleValue(previewValue)}`,
            getRuleLiveNote(status, rawRule.trigger_mode),
          ]
            .filter(Boolean)
            .join(' · ')}
          aside={
            <RuleStatusAside
              statusBadge={liveBadge}
              triggerMode={rawRule.trigger_mode}
            />
          }
        />
      </div>
    );
  }

  if (ruleType === 'device') {
    const deviceRule = rule as DeviceRule;
    const device = getDeviceRefLabel({
      integrationId: deviceRule.integration_id,
      deviceId: deviceRule.device_id,
      devices,
      deviceDisplayNameMap,
    });

    return (
      <div className={nestedClassName}>
        <SummaryCard
          badge="Device"
          badgeTone="primary"
          title={device.label}
          summary={formatDeviceConditions(deviceRule, sceneLabels)}
          meta={[device.meta, getRuleLiveNote(status, deviceRule.trigger_mode)]
            .filter(Boolean)
            .join(' · ')}
          aside={
            <RuleStatusAside
              statusBadge={liveBadge}
              triggerMode={deviceRule.trigger_mode}
            />
          }
        />
      </div>
    );
  }

  if (ruleType === 'group') {
    const groupRule = rule as GroupRule;
    return (
      <div className={nestedClassName}>
        <SummaryCard
          badge="Group"
          badgeTone="accent"
          title={getGroupLabel(groupRule.group_id, groups)}
          summary={formatDeviceConditions(groupRule, sceneLabels)}
          meta={[
            groupRule.group_id,
            getRuleLiveNote(status, groupRule.trigger_mode),
          ]
            .filter(Boolean)
            .join(' · ')}
          aside={
            <RuleStatusAside
              statusBadge={liveBadge}
              triggerMode={groupRule.trigger_mode}
            />
          }
        />
      </div>
    );
  }

  if (ruleType === 'any') {
    const anyRule = rule as AnyRule;

    return (
      <div className={nestedClassName}>
        <SummaryCard
          badge="Any"
          badgeTone="warning"
          title="Any nested rule can match"
          summary="This branch is satisfied when at least one of the rules below matches."
          meta={getRuleLiveNote(status)}
          aside={<StatusBadge label={liveBadge.label} tone={liveBadge.tone} />}
        >
          <div className="space-y-2">
            {anyRule.any.map((nestedRule, index) => (
              <RuleSummaryItem
                key={`${depth}-${index}`}
                rule={nestedRule}
                status={status?.children?.[index]}
                devices={devices}
                groups={groups}
                sceneLabels={sceneLabels}
                deviceDisplayNameMap={deviceDisplayNameMap}
                depth={depth + 1}
              />
            ))}
          </div>
        </SummaryCard>
      </div>
    );
  }

  const scriptRule = rule as ScriptRule;
  return (
    <div className={nestedClassName}>
      <SummaryCard
        badge="Script"
        badgeTone="info"
        title="JavaScript rule"
        summary={summarizeScript(scriptRule.script)}
        meta={getRuleLiveNote(status)}
        aside={<StatusBadge label={liveBadge.label} tone={liveBadge.tone} />}
      >
        <JsonDetails label="Show script" value={scriptRule.script} />
      </SummaryCard>
    </div>
  );
}

function ActionSummaryItem({
  action,
  devices,
  groups,
  sceneLabels,
  routineLabels,
  deviceDisplayNameMap,
}: {
  action: Action;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  sceneLabels: Record<string, string>;
  routineLabels: Record<string, string>;
  deviceDisplayNameMap: Record<string, string>;
}) {
  const actionType = getActionType(action);

  if (actionType === 'ActivateScene') {
    const sceneAction = action as ActivateSceneAction;
    const filters = summarizeFilters({
      deviceKeys: sceneAction.device_keys,
      groupKeys: sceneAction.group_keys,
      devices,
      groups,
      deviceDisplayNameMap,
    });
    const rollout = summarizeRollout({
      rollout: sceneAction.rollout,
      rollout_source_device_key: sceneAction.rollout_source_device_key,
      rollout_duration_ms: sceneAction.rollout_duration_ms,
      devices,
      deviceDisplayNameMap,
    });

    const fallbackLabel =
      sceneLabels[sceneAction.scene_id] ?? sceneAction.scene_id;
    const mirrorGroupId = sceneAction.mirror_from_group;
    const title =
      mirrorGroupId !== undefined
        ? `Mirror scene from ${groups[mirrorGroupId]?.name ?? mirrorGroupId}`
        : fallbackLabel;
    const summary =
      mirrorGroupId !== undefined
        ? `Uses the scene currently active in "${groups[mirrorGroupId]?.name ?? mirrorGroupId}" (fallback: ${fallbackLabel}).`
        : 'Activate this scene when the routine triggers.';

    const metaParts = [...filters, rollout];
    if (sceneAction.include_source_groups) {
      metaParts.push('+ source groups');
    }

    return (
      <SummaryCard
        badge="Scene"
        badgeTone="primary"
        title={title}
        summary={summary}
        meta={metaParts.filter(Boolean).join(' · ')}
      />
    );
  }

  if (actionType === 'CycleScenes') {
    const cycleAction = action as CycleScenesAction;
    const sequence = cycleAction.scenes.map((scene) => {
      const fallbackLabel = sceneLabels[scene.scene_id] ?? scene.scene_id;
      if (scene.mirror_from_group !== undefined) {
        const groupLabel =
          groups[scene.mirror_from_group]?.name ?? scene.mirror_from_group;
        return `mirror(${groupLabel}→${fallbackLabel})`;
      }
      return fallbackLabel;
    });
    const filters = summarizeFilters({
      deviceKeys: cycleAction.device_keys,
      groupKeys: cycleAction.group_keys,
      devices,
      groups,
      deviceDisplayNameMap,
    });
    const rollout = summarizeRollout({
      rollout: cycleAction.rollout,
      rollout_source_device_key: cycleAction.rollout_source_device_key,
      rollout_duration_ms: cycleAction.rollout_duration_ms,
      devices,
      deviceDisplayNameMap,
    });
    const meta = [
      cycleAction.nowrap
        ? 'stops at the final scene'
        : 'wraps back to the start',
      ...filters,
      rollout,
      cycleAction.include_source_groups ? '+ source groups' : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <SummaryCard
        badge="Cycle"
        badgeTone="secondary"
        title="Cycle through scenes"
        summary={
          sequence.length > 0
            ? sequence.join(' → ')
            : 'No scenes configured yet'
        }
        meta={meta}
      />
    );
  }

  if (actionType === 'ForceTriggerRoutine') {
    const routineAction = action as ForceTriggerRoutineAction;
    return (
      <SummaryCard
        badge="Routine"
        badgeTone="accent"
        title={
          routineLabels[routineAction.routine_id] ?? routineAction.routine_id
        }
        summary="Force trigger this routine regardless of its own rules."
        meta={routineAction.routine_id}
      />
    );
  }

  if (actionType === 'ToggleDeviceOverride') {
    const overrideAction = action as ToggleDeviceOverrideAction;
    const labels = overrideAction.device_keys.map((deviceKey) =>
      getDeviceKeyLabel(deviceKey, devices, deviceDisplayNameMap),
    );

    return (
      <SummaryCard
        badge="Override"
        badgeTone="warning"
        title={
          overrideAction.override_state
            ? 'Enable scene override'
            : 'Disable scene override'
        }
        summary={
          labels.length > 0
            ? `Applies to ${summarizeNames(labels, 3)}`
            : 'No devices selected yet'
        }
        meta={`${overrideAction.device_keys.length} device${overrideAction.device_keys.length === 1 ? '' : 's'}`}
      />
    );
  }

  if (actionType === 'Ui') {
    const uiAction = action as UiAction;
    return (
      <SummaryCard
        badge="UI"
        badgeTone="info"
        title={uiAction.state_key || 'UI state key'}
        summary="Store this value in UI state."
      >
        <JsonDetails label="Show value" value={uiAction.state_value} />
      </SummaryCard>
    );
  }

  if (actionType === 'Dim') {
    const dimAction = action as DimAction;
    const deviceCount = dimAction.devices
      ? Object.keys(dimAction.devices).length
      : 0;
    const groupCount = dimAction.groups
      ? Object.keys(dimAction.groups).length
      : 0;
    return (
      <SummaryCard
        badge="Dim"
        badgeTone="neutral"
        title={dimAction.name || 'Dim action'}
        summary="Apply a dim configuration."
        meta={`${deviceCount} device config${deviceCount === 1 ? '' : 's'} · ${groupCount} group config${groupCount === 1 ? '' : 's'}`}
      >
        <JsonDetails label="Show dim config" value={dimAction} />
      </SummaryCard>
    );
  }

  if (actionType === 'SetDeviceState') {
    const deviceAction = action as SetDeviceStateAction;
    const device = getDeviceRefLabel({
      integrationId: deviceAction.integration_id,
      deviceId: deviceAction.id,
      deviceName: deviceAction.name,
      devices,
      deviceDisplayNameMap,
    });

    return (
      <SummaryCard
        badge="Device"
        badgeTone="primary"
        title={device.label}
        summary="Set this device to a specific state."
        meta={device.meta}
      >
        <JsonDetails label="Show device state" value={deviceAction.data} />
      </SummaryCard>
    );
  }

  const customAction = action as CustomAction;
  return (
    <SummaryCard
      badge="Custom"
      badgeTone="neutral"
      title="Custom integration action"
      summary="Send a custom payload through an integration action."
    >
      <JsonDetails label="Show payload" value={customAction.payload} />
    </SummaryCard>
  );
}

export function RoutineRuleList({
  rules,
  status,
  devices,
  groups,
  scenes,
  deviceDisplayNameMap,
}: RoutineRuleListProps) {
  const sceneLabels = buildLabelMap(scenes);

  return (
    <SectionCard
      title="When"
      description={getRoutineRuleSummary(status, rules.length)}
      count={rules.length}
      emptyMessage="No rules configured yet."
    >
      {rules.map((rule, index) => (
        <RuleSummaryItem
          key={index}
          rule={rule}
          status={status?.rules[index]}
          devices={devices}
          groups={groups}
          sceneLabels={sceneLabels}
          deviceDisplayNameMap={deviceDisplayNameMap}
        />
      ))}
    </SectionCard>
  );
}

export function RoutineActionList({
  actions,
  devices,
  groups,
  scenes,
  routines,
  deviceDisplayNameMap,
}: RoutineActionListProps) {
  const sceneLabels = buildLabelMap(scenes);
  const routineLabels = buildLabelMap(routines);

  return (
    <SectionCard
      title="Then"
      description="These actions run in order when the routine triggers."
      count={actions.length}
      emptyMessage="No actions configured yet."
    >
      {actions.map((action, index) => (
        <ActionSummaryItem
          key={index}
          action={action}
          devices={devices}
          groups={groups}
          sceneLabels={sceneLabels}
          routineLabels={routineLabels}
          deviceDisplayNameMap={deviceDisplayNameMap}
        />
      ))}
    </SectionCard>
  );
}
