import type { AssistantAttachment } from '../bindings/AssistantAttachment';
import type { AssistantEntityKind } from '../bindings/AssistantEntityKind';
import type { AssistantOperation } from '../bindings/AssistantOperation';
import type { AssistantPlan } from '../bindings/AssistantPlan';

export const assistantEntityKindLabels: Record<AssistantEntityKind, string> = {
  routine: 'Routine',
  scene: 'Scene',
  group: 'Group',
  device: 'Device',
  floorplan: 'Floorplan',
  integration: 'Integration',
  helper: 'Helper',
  computed_source: 'Computed source',
};

const entityFieldLabels: Partial<
  Record<AssistantEntityKind, Record<string, string>>
> = {
  routine: {
    id: 'ID',
    name: 'Name',
    enabled: 'Enabled',
    semantics_version: 'Semantics version',
    definition_v2: 'Definition',
    rules: 'Rules',
    actions: 'Actions',
    revision: 'Revision',
  },
  scene: {
    id: 'ID',
    name: 'Name',
    hidden: 'Hidden',
    script: 'Script',
    device_states: 'Device targets',
    group_states: 'Group targets',
    group_state_order: 'Group order',
  },
  group: {
    id: 'ID',
    name: 'Name',
    hidden: 'Hidden',
    devices: 'Devices',
    linked_groups: 'Linked groups',
  },
  device: {
    device_key: 'Device key',
    display_name: 'Display name',
    name: 'Name',
    kind: 'Kind',
  },
  floorplan: {
    id: 'ID',
    name: 'Name',
  },
  integration: {
    id: 'ID',
    plugin: 'Plugin',
    enabled: 'Enabled',
    config: 'Configuration',
  },
  helper: {
    id: 'ID',
    name: 'Name',
    kind: 'Kind',
    initial_value: 'Initial value',
    persistence: 'Persistence',
    hidden: 'Hidden',
  },
  computed_source: {
    id: 'ID',
    name: 'Name',
    enabled: 'Enabled',
    timezone: 'Timezone',
    refresh_interval_ms: 'Refresh interval',
    compute: 'Computation',
    aliases: 'Aliases',
    revision: 'Revision',
  },
};

export function humanizeKey(key: string): string {
  const words = key.split(/[_\-.]+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return key;
  }
  const sentence = words.join(' ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

export function assistantFieldLabel(
  kind: AssistantEntityKind,
  key: string,
): string {
  return entityFieldLabels[kind]?.[key] ?? humanizeKey(key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Deterministic JSON stringification with sorted object keys, so equal values
 * compare equal even when key order differs between plan snapshots.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',');
  return `{${body}}`;
}

export function isSameJsonValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

export type ChangedField = {
  key: string;
  label: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
};

/**
 * Compare the top-level fields of two entity bodies. Used by the review diff
 * to show which fields an operation touches.
 */
export function diffTopLevelFields(
  before: unknown,
  after: unknown,
): ChangedField[] {
  const beforeRecord = asRecord(before) ?? {};
  const afterRecord = asRecord(after) ?? {};
  const keys = [
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord).filter((key) => !(key in beforeRecord)),
  ];
  const changed: ChangedField[] = [];
  for (const key of keys) {
    const hadBefore = key in beforeRecord;
    const hasAfter = key in afterRecord;
    if (!hadBefore && hasAfter) {
      changed.push({
        key,
        label: humanizeKey(key),
        kind: 'added',
        before: undefined,
        after: afterRecord[key],
      });
      continue;
    }
    if (hadBefore && !hasAfter) {
      changed.push({
        key,
        label: humanizeKey(key),
        kind: 'removed',
        before: beforeRecord[key],
        after: undefined,
      });
      continue;
    }
    if (!isSameJsonValue(beforeRecord[key], afterRecord[key])) {
      changed.push({
        key,
        label: humanizeKey(key),
        kind: 'changed',
        before: beforeRecord[key],
        after: afterRecord[key],
      });
    }
  }
  return changed;
}

/** One-line, bounded description of a JSON value for review rows. */
export function describeJsonValue(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0) {
      return '""';
    }
    return `"${trimmed.length > 48 ? `${trimmed.slice(0, 47)}…` : trimmed}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  const record = asRecord(value);
  if (record) {
    const keys = Object.keys(record);
    return `${keys.length} field${keys.length === 1 ? '' : 's'}`;
  }
  return String(value);
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function isDestructiveOperation(operation: AssistantOperation): boolean {
  return operation.op === 'delete';
}

/** Deletes are opt-in during review; everything else is accepted by default. */
export function acceptedByDefault(operation: AssistantOperation): boolean {
  return !isDestructiveOperation(operation);
}

export type OperationEntityRef = {
  kind: AssistantEntityKind;
  id: string;
  label: string;
};

export function operationTarget(
  operation: AssistantOperation,
): OperationEntityRef | null {
  if (operation.op === 'create') {
    const after = asRecord(operation.after);
    const id = after?.id ?? after?.device_key;
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    const label =
      typeof after?.name === 'string' && after.name.length > 0
        ? after.name
        : operation.label;
    return { kind: operation.kind, id, label };
  }
  if (!operation.targetId) {
    return null;
  }
  const before = asRecord(operation.before);
  const label =
    typeof before?.name === 'string' && before.name.length > 0
      ? before.name
      : operation.label;
  return { kind: operation.kind, id: operation.targetId, label };
}

/**
 * Fields that are server-owned bookkeeping or context-only snapshot fields and
 * would produce noise in the review diff.
 */
const ignoredDiffFields: Partial<Record<AssistantEntityKind, string[]>> = {
  routine: ['revision'],
  computed_source: ['revision'],
  device: ['name', 'kind'],
};

/**
 * Field-level changes for an operation, ignoring server bookkeeping and
 * snapshot-only context fields.
 */
export function operationFieldChanges(
  operation: AssistantOperation,
): ChangedField[] {
  const ignored = new Set(ignoredDiffFields[operation.kind] ?? []);
  return diffTopLevelFields(operation.before, operation.after).filter(
    (field) => !ignored.has(field.key),
  );
}

export function operationChangeSummary(operation: AssistantOperation): string {
  const kindLabel = assistantEntityKindLabels[operation.kind];
  if (operation.op === 'create') {
    return `Create ${kindLabel.toLowerCase()}`;
  }
  if (operation.op === 'delete') {
    return `Delete ${kindLabel.toLowerCase()}`;
  }
  const fields = operationFieldChanges(operation);
  if (fields.length === 0) {
    return 'No visible field changes';
  }
  if (fields.length <= 2) {
    return `Change ${fields.map((field) => field.label).join(' and ')}`;
  }
  return `Change ${fields.length} fields`;
}

type StringSetDiff = { added: string[]; removed: string[] };

function diffStringSets(before: string[], after: string[]): StringSetDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((entry) => !beforeSet.has(entry)),
    removed: before.filter((entry) => !afterSet.has(entry)),
  };
}

function formatSetChange(label: string, diff: StringSetDiff): string | null {
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (diff.added.length > 0) {
    parts.push(`+${diff.added.slice(0, 3).join(', ')}`);
    if (diff.added.length > 3) {
      parts.push(`+${diff.added.length - 3} more`);
    }
  }
  if (diff.removed.length > 0) {
    parts.push(`−${diff.removed.slice(0, 3).join(', ')}`);
    if (diff.removed.length > 3) {
      parts.push(`−${diff.removed.length - 3} more`);
    }
  }
  return `${label}: ${parts.join(' · ')}`;
}

function recordKeys(value: unknown): string[] {
  return Object.keys(asRecord(value) ?? {});
}

function groupDeviceKeys(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const integrationId = entry.integration_id;
      const deviceId = entry.device_id;
      if (typeof integrationId !== 'string' || typeof deviceId !== 'string') {
        return '';
      }
      return `${integrationId}/${deviceId}`;
    })
    .filter((key) => key.length > 0);
}

function routineTriggerIds(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
    .filter((id) => id.length > 0);
}

function routineSectionDetails(operation: AssistantOperation): string[] {
  const before = asRecord(operation.before);
  const after = asRecord(operation.after);
  const beforeDefinition = asRecord(before?.definition_v2);
  const afterDefinition = asRecord(after?.definition_v2);
  if (!beforeDefinition && !afterDefinition) {
    return [];
  }
  const details: string[] = [];
  const triggerDiff = diffStringSets(
    routineTriggerIds(beforeDefinition?.triggers),
    routineTriggerIds(afterDefinition?.triggers),
  );
  const triggerCount = asArray(afterDefinition?.triggers).length;
  if (triggerDiff.added.length > 0 || triggerDiff.removed.length > 0) {
    details.push(
      formatSetChange('Triggers', triggerDiff) ?? `Triggers: ${triggerCount}`,
    );
  }
  if (
    !isSameJsonValue(beforeDefinition?.condition, afterDefinition?.condition)
  ) {
    details.push('Condition changed');
  }
  const beforeProgram = asRecord(beforeDefinition?.program);
  const afterProgram = asRecord(afterDefinition?.program);
  if (!isSameJsonValue(beforeProgram, afterProgram)) {
    details.push(
      `Program: ${describeProgram(beforeProgram)} → ${describeProgram(afterProgram)}`,
    );
  }
  if (
    !isSameJsonValue(beforeDefinition?.execution, afterDefinition?.execution)
  ) {
    details.push('Execution policy changed');
  }
  return details;
}

function describeProgram(program: Record<string, unknown> | null): string {
  if (!program) {
    return 'none';
  }
  if (program.kind === 'native') {
    const steps = asArray(program.steps).length;
    return `native (${steps} step${steps === 1 ? '' : 's'})`;
  }
  if (program.kind === 'script') {
    return 'script';
  }
  return String(program.kind ?? 'unknown');
}

/**
 * Human-readable details for the expanded diff. Generic top-level field
 * changes plus per-kind target/membership summaries.
 */
export function operationDetails(operation: AssistantOperation): string[] {
  if (operation.op === 'create' || operation.op === 'delete') {
    return [];
  }
  const before = operation.before;
  const after = operation.after;
  switch (operation.kind) {
    case 'scene': {
      const details: string[] = [];
      const deviceChange = formatSetChange(
        'Devices',
        diffStringSets(
          recordKeys(asRecord(before)?.device_states),
          recordKeys(asRecord(after)?.device_states),
        ),
      );
      if (deviceChange) {
        details.push(deviceChange);
      }
      const groupChange = formatSetChange(
        'Groups',
        diffStringSets(
          recordKeys(asRecord(before)?.group_states),
          recordKeys(asRecord(after)?.group_states),
        ),
      );
      if (groupChange) {
        details.push(groupChange);
      }
      return details;
    }
    case 'group': {
      const details: string[] = [];
      const membership = formatSetChange(
        'Devices',
        diffStringSets(
          groupDeviceKeys(asRecord(before)?.devices),
          groupDeviceKeys(asRecord(after)?.devices),
        ),
      );
      if (membership) {
        details.push(membership);
      }
      const links = formatSetChange(
        'Linked groups',
        diffStringSets(
          asArray(asRecord(before)?.linked_groups).map(String),
          asArray(asRecord(after)?.linked_groups).map(String),
        ),
      );
      if (links) {
        details.push(links);
      }
      return details;
    }
    case 'routine':
      return routineSectionDetails(operation);
    case 'integration': {
      const configDiff = diffTopLevelFields(
        asRecord(before)?.config,
        asRecord(after)?.config,
      );
      if (configDiff.length === 0) {
        return [];
      }
      return [
        `Config fields: ${configDiff.map((field) => field.label).join(', ')}`,
      ];
    }
    default:
      return [];
  }
}

export function collectChangedDeviceKeys(
  operations: readonly AssistantOperation[],
): string[] {
  const keys = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === 'device') {
      const after = asRecord(operation.after);
      const key =
        (typeof after?.device_key === 'string' && after.device_key) ||
        operation.targetId;
      if (key) {
        keys.add(key);
      }
      continue;
    }
    const before = asRecord(operation.before);
    const after = asRecord(operation.after);
    if (operation.kind === 'scene') {
      for (const key of [
        ...recordKeys(before?.device_states),
        ...recordKeys(after?.device_states),
      ]) {
        keys.add(key);
      }
    }
    if (operation.kind === 'group') {
      for (const key of [
        ...groupDeviceKeys(before?.devices),
        ...groupDeviceKeys(after?.devices),
      ]) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

export function collectChangedGroupIds(
  operations: readonly AssistantOperation[],
): string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === 'group') {
      const after = asRecord(operation.after);
      const id =
        (typeof after?.id === 'string' && after.id) || operation.targetId;
      if (id) {
        ids.add(id);
      }
      continue;
    }
    if (operation.kind === 'scene') {
      const before = asRecord(operation.before);
      const after = asRecord(operation.after);
      for (const id of [
        ...recordKeys(before?.group_states),
        ...recordKeys(after?.group_states),
      ]) {
        ids.add(id);
      }
    }
  }
  return [...ids].sort();
}

export function planOperationCounts(plan: AssistantPlan): {
  create: number;
  update: number;
  delete: number;
} {
  const counts = { create: 0, update: 0, delete: 0 };
  for (const operation of plan.operations) {
    counts[operation.op] += 1;
  }
  return counts;
}

export function planTouchesFloorplanEntities(plan: AssistantPlan): boolean {
  return plan.operations.some(
    (operation) =>
      operation.kind === 'scene' ||
      operation.kind === 'group' ||
      operation.kind === 'device' ||
      operation.kind === 'floorplan',
  );
}

export function describeRoutineDefinition(definition: unknown): string[] {
  const record = asRecord(definition);
  if (!record) {
    return ['No routine definition'];
  }
  const lines: string[] = [];
  const triggers = asArray(record.triggers);
  if (triggers.length === 0) {
    lines.push('Triggers: none');
  } else {
    const counts = new Map<string, number>();
    for (const trigger of triggers) {
      const kind = asRecord(trigger)?.kind;
      const key = typeof kind === 'string' ? kind : 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const breakdown = [...counts.entries()]
      .map(([kind, count]) => `${humanizeKey(kind)} ×${count}`)
      .join(', ');
    lines.push(`Triggers: ${triggers.length} (${breakdown})`);
  }
  lines.push(
    record.condition === undefined || record.condition === null
      ? 'Condition: always'
      : `Condition: ${describeJsonValue(record.condition)}`,
  );
  lines.push(`Program: ${describeProgram(asRecord(record.program))}`);
  return lines;
}

export function routineDefinitionLines(after: unknown): string[] {
  const record = asRecord(after);
  return describeRoutineDefinition(record?.definition_v2);
}

export function attachmentKey(attachment: AssistantAttachment): string {
  return `${attachment.kind}:${attachment.id ?? ''}`;
}

export function upsertAssistantAttachment(
  attachments: readonly AssistantAttachment[],
  attachment: AssistantAttachment,
): AssistantAttachment[] {
  const key = attachmentKey(attachment);
  const index = attachments.findIndex((entry) => attachmentKey(entry) === key);
  if (index === -1) {
    return [...attachments, attachment];
  }
  const next = [...attachments];
  next[index] = attachment;
  return next;
}
