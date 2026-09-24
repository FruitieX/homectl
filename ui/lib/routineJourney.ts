/**
 * The guided routine journey, as pure data: one intent, one outcome, and the
 * mapping to a stored v2 definition. Everything here is unit-tested so the
 * page can stay a thin renderer, and so the review sentence and the saved
 * definition can never drift apart.
 */

import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { Device } from '@/bindings/Device';
import type { RoutineDefinitionV2Body } from '@/hooks/useConfig';

export type TriggerIntent = 'change' | 'schedule' | 'manual' | 'copy';
export type OutcomeIntent = 'scene' | 'power_on' | 'power_off' | 'none';
export type FieldKind = 'boolean' | 'number' | 'string';

export type FieldOption = {
  path: string;
  label: string;
  kind: FieldKind;
  value?: unknown;
  updatedAt?: number;
};

export type JourneyDraft = {
  /** Empty until the user picks a card: nothing is preselected. */
  intent: TriggerIntent | '';
  deviceKey: string;
  fieldPath: string;
  fieldKind: FieldKind;
  operator: 'eq' | 'ne' | 'gt' | 'lt';
  value: string;
  anyValue: boolean;
  forMinutes: string;
  time: string;
  days: number[];
  /** When the card “copy an existing routine” is chosen. */
  copyFromId: string;
  outcome: OutcomeIntent;
  sceneId: string;
  actionDeviceKey: string;
  name: string;
  id: string;
  enabled: boolean;
};

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function emptyJourney(): JourneyDraft {
  return {
    intent: '',
    deviceKey: '',
    fieldPath: '',
    fieldKind: 'boolean',
    operator: 'eq',
    value: '',
    anyValue: false,
    forMinutes: '',
    time: '18:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    copyFromId: '',
    outcome: 'scene',
    sceneId: '',
    actionDeviceKey: '',
    name: '',
    id: '',
    // The review creates an enabled routine unless the user saves it off.
    enabled: true,
  };
}

export function deviceRefFromKey(key: string): {
  integration_id: string;
  device_id: string;
} {
  const separator = key.indexOf('/');
  if (separator <= 0) {
    return { integration_id: '', device_id: '' };
  }
  return {
    integration_id: key.slice(0, separator),
    device_id: key.slice(separator + 1),
  };
}

/** Fields a device can report, with what the app currently knows about them. */
export function deviceFieldOptions(device: Device | undefined): FieldOption[] {
  const data = device?.data as Record<string, unknown> | undefined;
  if (!data) {
    return [];
  }
  const controllable = data['Controllable'] as
    | {
        state?: { power?: boolean; brightness?: number | null };
        requested_at_ms?: number;
        last_report?: { reported_at_ms?: number };
      }
    | undefined;
  if (controllable) {
    const requestedAt =
      controllable.last_report?.reported_at_ms ?? controllable.requested_at_ms;
    const options: FieldOption[] = [
      {
        path: '/power',
        label: 'Power',
        kind: 'boolean',
        value: controllable.state?.power,
        updatedAt: requestedAt ?? undefined,
      },
    ];
    if (
      controllable.state?.brightness !== null &&
      controllable.state?.brightness !== undefined
    ) {
      options.push({
        path: '/brightness',
        label: 'Brightness',
        kind: 'number',
        value: controllable.state.brightness,
        updatedAt: requestedAt ?? undefined,
      });
    }
    return options;
  }
  const sensor = data['Sensor'] as Record<string, unknown> | undefined;
  if (sensor && 'value' in sensor) {
    const value = sensor.value;
    return [
      {
        path: '/value',
        label: 'Reading',
        kind:
          typeof value === 'boolean'
            ? 'boolean'
            : typeof value === 'number'
              ? 'number'
              : 'string',
        value,
      },
    ];
  }
  return [];
}

export function describeFieldValue(
  option: FieldOption | undefined,
): string | null {
  if (!option || option.value === undefined || option.value === null) {
    return null;
  }
  if (option.kind === 'boolean') {
    return option.value ? 'On' : 'Off';
  }
  if (option.kind === 'number') {
    return String(Math.round(Number(option.value) * 100) / 100);
  }
  return String(option.value);
}

export function describeFreshness(
  updatedAt: number | undefined,
  now: number,
): string | null {
  if (!updatedAt) {
    return null;
  }
  const elapsed = now - updatedAt;
  if (elapsed < 0) {
    return null;
  }
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}

export function parseTime(
  value: string,
): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function cronDayOfWeek(days: number[]): string {
  const unique = [...new Set(days)]
    .filter((day) => day >= 0 && day <= 6)
    .sort();
  if (unique.length === 0 || unique.length === 7) {
    return '*';
  }
  if (unique.join(',') === '1,2,3,4,5') {
    return '1-5';
  }
  if (unique.join(',') === '0,6') {
    return '0,6';
  }
  // Collapse runs so the expression stays readable: 1,2,3,4,5 -> 1-5.
  const parts: string[] = [];
  let runStart = unique[0];
  let previous = unique[0];
  for (let index = 1; index < unique.length; index += 1) {
    const day = unique[index];
    if (day === previous + 1) {
      previous = day;
      continue;
    }
    parts.push(
      runStart === previous ? `${runStart}` : `${runStart}-${previous}`,
    );
    runStart = day;
    previous = day;
  }
  parts.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
  return parts.join(',');
}

/** Six-field cron (`second minute hour day-of-month month day-of-week`). */
export function toCron(time: string, days: number[]): string | null {
  const parsed = parseTime(time);
  if (!parsed) {
    return null;
  }
  return `0 ${parsed.minute} ${parsed.hour} * * ${cronDayOfWeek(days)}`;
}

export function describeSchedule(time: string, days: number[]): string {
  const parsed = parseTime(time);
  const clock = parsed
    ? `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
    : time;
  const unique = [...new Set(days)].sort();
  if (unique.length === 7) {
    return `Every day at ${clock}`;
  }
  if (unique.join(',') === '1,2,3,4,5') {
    return `Every weekday at ${clock}`;
  }
  if (unique.join(',') === '0,6') {
    return `Every weekend day at ${clock}`;
  }
  if (unique.length === 0) {
    return `No days chosen, so it would never run (${clock})`;
  }
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${unique.map((day) => names[day]).join(', ')} at ${clock}`;
}

export function buildJourneyDefinition(
  draft: JourneyDraft,
): RoutineDefinitionV2Body {
  if (draft.intent === '' || draft.intent === 'copy') {
    // Nothing to compose here: an empty intent has no fields yet, and a copy
    // reuses the source routine's stored definition verbatim.
    return {
      triggers: [],
      condition: { kind: 'literal', value: true },
      program: { kind: 'native', steps: [] },
    } as RoutineDefinitionV2Body;
  }
  const device = deviceRefFromKey(draft.deviceKey);
  const trigger =
    draft.intent === 'schedule'
      ? {
          kind: 'schedule' as const,
          id: 'schedule_1',
          schedule: {
            cron: toCron(draft.time, draft.days) ?? '0 0 18 * * *',
            timezone: 'Europe/Helsinki',
            backlog: 'skip' as const,
          },
        }
      : draft.intent === 'manual'
        ? { kind: 'manual' as const, id: 'manual_1' }
        : {
            kind: 'state_change' as const,
            id: 'state_change_1',
            device,
            mode: 'transition' as const,
          };

  const condition = buildCondition(draft);
  const program = buildProgram(draft);

  return { triggers: [trigger], condition, program } as RoutineDefinitionV2Body;
}

function buildCondition(
  draft: JourneyDraft,
): ConditionExpr | { kind: 'literal'; value: boolean } {
  if (draft.intent !== 'change') {
    return { kind: 'literal', value: true };
  }
  const device = deviceRefFromKey(draft.deviceKey);
  if (draft.forMinutes.trim() !== '') {
    const minutes = Number(draft.forMinutes);
    const predicate: ConditionExpr = draft.anyValue
      ? {
          kind: 'comparison',
          source: { kind: 'device', device, path: draft.fieldPath },
          operator: 'exists',
        }
      : {
          kind: 'comparison',
          source: { kind: 'device', device, path: draft.fieldPath },
          operator: draft.operator,
          value: coerceValue(draft),
        };
    return {
      kind: 'predicate_for',
      id: 'predicate_for_1',
      predicate,
      duration_ms: BigInt(Math.max(1, minutes) * 60_000),
    } as unknown as ConditionExpr;
  }
  if (draft.anyValue) {
    return {
      kind: 'comparison',
      source: { kind: 'device', device, path: draft.fieldPath },
      operator: 'exists',
    };
  }
  return {
    kind: 'comparison',
    source: { kind: 'device', device, path: draft.fieldPath },
    operator: draft.operator,
    value: coerceValue(draft),
  };
}

export function coerceValue(draft: JourneyDraft): boolean | number | string {
  if (draft.fieldKind === 'boolean') {
    return draft.value === 'true' || draft.value === 'on';
  }
  if (draft.fieldKind === 'number') {
    const parsed = Number(draft.value);
    return Number.isFinite(parsed) ? parsed : draft.value;
  }
  return draft.value;
}

function buildProgram(draft: JourneyDraft): unknown {
  switch (draft.outcome) {
    case 'scene': {
      const targets = draft.actionDeviceKey
        ? { devices: { [draft.actionDeviceKey]: true } }
        : {};
      return {
        kind: 'native',
        steps: [
          {
            id: 'activate_scene_1',
            action: 'activate_scene',
            scene_id: draft.sceneId,
            targets,
            use_scene_transition: true,
          },
        ],
      };
    }
    case 'power_on':
    case 'power_off':
      return {
        kind: 'native',
        steps: [
          {
            id: 'set_power_1',
            action: 'set_power',
            device: deviceRefFromKey(draft.actionDeviceKey || draft.deviceKey),
            power: draft.outcome === 'power_on',
          },
        ],
      };
    default:
      return { kind: 'native', steps: [] };
  }
}

export type JourneyContext = {
  hasDevice: (key: string) => boolean;
  hasScene: (id: string) => boolean;
  deviceLabel: (key: string) => string;
  sceneLabel: (id: string) => string;
  routineLabel?: (id: string) => string;
};

/** What the user is about to save, in one sentence. */
export function describeJourney(
  draft: JourneyDraft,
  context: JourneyContext,
): string {
  if (draft.intent === '') {
    return 'Nothing chosen yet: pick what should start the routine.';
  }
  if (draft.intent === 'copy') {
    return draft.copyFromId
      ? `Copies “${context.routineLabel?.(draft.copyFromId) ?? draft.copyFromId}”: the new routine gets the same start and the same actions.`
      : 'Copies another routine (none chosen yet).';
  }
  const when =
    draft.intent === 'schedule'
      ? describeSchedule(draft.time, draft.days)
      : draft.intent === 'manual'
        ? 'When you run it by hand'
        : draft.deviceKey
          ? `When ${context.deviceLabel(draft.deviceKey)} ${
              draft.anyValue
                ? `reports any change to ${draft.fieldPath.replace('/', '')}`
                : `is ${describeExpected(draft)}`
            }${draft.forMinutes ? ` for ${draft.forMinutes} minutes` : ''}`
          : 'When (no device chosen yet)';
  const then =
    draft.outcome === 'scene'
      ? draft.sceneId
        ? `activate “${context.sceneLabel(draft.sceneId)}”${
            draft.actionDeviceKey
              ? ` on ${context.deviceLabel(draft.actionDeviceKey)}`
              : ' on the scene’s own targets'
          }`
        : 'activate a scene (none chosen yet)'
      : draft.outcome === 'power_on'
        ? `turn ${draft.actionDeviceKey ? context.deviceLabel(draft.actionDeviceKey) : 'the device'} on`
        : draft.outcome === 'power_off'
          ? `turn ${draft.actionDeviceKey ? context.deviceLabel(draft.actionDeviceKey) : 'the device'} off`
          : 'do nothing (no outcome chosen yet)';
  return `${when}, ${then}.`;
}

export function describeExpected(draft: JourneyDraft): string {
  if (draft.fieldKind === 'boolean') {
    return draft.value === 'true' ? 'on' : 'off';
  }
  const operator =
    draft.operator === 'eq'
      ? ''
      : draft.operator === 'ne'
        ? 'not '
        : draft.operator === 'gt'
          ? 'above '
          : 'below ';
  if (draft.operator === 'eq' || draft.operator === 'ne') {
    return `${operator}${draft.value}`;
  }
  return `${operator}${draft.value}`;
}

/**
 * Name the missing piece instead of failing silently. Returns user-facing
 * sentences; the page renders them beside Create.
 */
export function validateJourney(
  draft: JourneyDraft,
  context: JourneyContext,
  hasRoutine: (id: string) => boolean = () => true,
): string[] {
  const missing: string[] = [];
  if (draft.intent === '') {
    missing.push('Choose what should start the routine.');
    return missing;
  }
  if (draft.intent === 'copy') {
    if (!draft.copyFromId) {
      missing.push('Choose the routine to copy.');
    } else if (!hasRoutine(draft.copyFromId)) {
      missing.push('The routine you chose no longer exists; choose another.');
    }
    if (draft.name.trim() === '') {
      missing.push('Give the routine a name.');
    }
    return missing;
  }
  if (draft.intent === 'change') {
    if (!draft.deviceKey || !context.hasDevice(draft.deviceKey)) {
      missing.push('Choose the device the trigger watches.');
    }
    if (draft.deviceKey && !draft.fieldPath) {
      missing.push('Choose which value on that device the trigger watches.');
    }
    if (!draft.anyValue) {
      if (
        draft.fieldKind === 'boolean' &&
        draft.value !== 'true' &&
        draft.value !== 'false'
      ) {
        missing.push('Choose whether the trigger starts on on or off.');
      }
      if (draft.fieldKind === 'number' && draft.value.trim() === '') {
        missing.push('Enter the number the trigger compares against.');
      }
      if (draft.fieldKind === 'string' && draft.value.trim() === '') {
        missing.push('Enter the value the trigger matches.');
      }
    }
    if (draft.forMinutes.trim() !== '') {
      const minutes = Number(draft.forMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        missing.push(
          '“Stays this way for” needs a positive number of minutes.',
        );
      }
    }
  }
  if (draft.intent === 'schedule') {
    if (parseTime(draft.time) === null) {
      missing.push('Pick a valid time of day for the schedule.');
    }
    if (draft.days.length === 0) {
      missing.push('Pick at least one day, or the schedule would never run.');
    }
  }
  if (draft.outcome === 'scene') {
    if (!draft.sceneId) {
      missing.push('Choose which scene the routine should activate.');
    } else if (!context.hasScene(draft.sceneId)) {
      missing.push(
        `The scene “${draft.sceneId}” no longer exists; choose another.`,
      );
    }
  } else if (draft.outcome === 'power_on' || draft.outcome === 'power_off') {
    const key = draft.actionDeviceKey || draft.deviceKey;
    if (!key || !context.hasDevice(key)) {
      missing.push('Choose which device the routine should switch.');
    }
  } else {
    missing.push('Choose what should happen: a scene or a device action.');
  }
  if (draft.name.trim() === '') {
    missing.push('Give the routine a name.');
  }
  return missing;
}

export function slugifyRoutineId(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'routine';
}
