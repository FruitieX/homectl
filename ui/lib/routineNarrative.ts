/**
 * Plain-language narration for v2 routines.
 *
 * A beginner reads a routine to answer one question — “why did my lights stay
 * off?” — so every sentence here names a device the way the user does, states
 * what is true right now, and never shows a cron expression or the word
 * “armed” without a human translation. Pure functions only, so the wording is
 * unit-tested rather than reviewed by eye on a phone.
 */

export type NarrativeDeviceData = {
  power?: boolean | null;
  brightness?: number | null;
  color?: unknown;
  occupancy?: boolean | null;
  motion?: boolean | null;
  [field: string]: unknown;
};

export type NarrativeDevice = {
  id?: string;
  name?: string | null;
  integration_id?: string;
  data?: NarrativeDeviceData | null;
  [field: string]: unknown;
};

export type NarrativeContext = {
  devices?: Record<string, NarrativeDevice | undefined> | null;
  groups?: Record<string, { name?: string } | undefined> | null;
  deviceNames?: Record<string, string | undefined> | null;
  helpers?: Array<{ id: string; name?: string | null }> | null;
  sources?: Array<{ id: string; name?: string | null }> | null;
};

type DeviceRef = { integration_id: string; device_id: string };

type ScheduleLike = {
  cron?: string | null;
  every_ms?: number | bigint | string | null;
  timezone?: string | null;
};

type ValueSourceLike =
  | { kind: 'device'; device: DeviceRef; path: string }
  | { kind: 'helper'; helper: string }
  | { kind: 'computed_source'; source: string; path: string };

type ConditionLike = {
  kind?: string;
  value?: unknown;
  conditions?: ConditionLike[];
  condition?: ConditionLike;
  source?: ValueSourceLike;
  operator?: string;
  group_id?: string;
  quantifier?: string;
  power?: boolean | null;
  scene?: string;
};

export function deviceKeyOf(ref: DeviceRef): string {
  return `${ref.integration_id}/${ref.device_id}`;
}

/** The label a user would say out loud for this device. */
export function deviceLabel(ref: DeviceRef, context: NarrativeContext): string {
  const key = deviceKeyOf(ref);
  const override = context.deviceNames?.[key];
  if (override) {
    return override;
  }
  const device = context.devices?.[key];
  const name = device?.name?.trim();
  if (name) {
    return name;
  }
  return device?.id ?? ref.device_id;
}

function humanField(path: string | undefined): string {
  if (!path) {
    return '';
  }
  const cleaned = path
    .replace(/^\//, '')
    .replace(/^(observed|requested)\//, '')
    .replace(/\//g, ' ');
  return cleaned === 'value' ? '' : cleaned;
}

function isFractional(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

/** Numbers become the units a person would use for that field. */
export function formatReading(
  path: string | undefined,
  value: unknown,
): string {
  const field = (path ?? '').toLowerCase();
  if (typeof value === 'boolean') {
    const field = (path ?? '').toLowerCase();
    if (field.includes('occupancy') || field.includes('motion')) {
      return value ? 'active' : 'inactive';
    }
    return value ? 'on' : 'off';
  }
  if (typeof value === 'number') {
    if (field.includes('brightness') && isFractional(value)) {
      return `${Math.round(value * 100)}%`;
    }
    if (field.includes('temp') && Number.isInteger(value)) {
      return `${value}°`;
    }
    return `${value}`;
  }
  if (value === null || value === undefined) {
    return 'unknown';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

type TaggedDeviceData = {
  Sensor?: { value?: unknown; [field: string]: unknown } | null;
  Controllable?: {
    state?: Record<string, unknown> | null;
    last_report?: { state?: Record<string, unknown> | null } | null;
    [field: string]: unknown;
  } | null;
};

/**
 * Read a device value the way the server's evaluator does: sensors expose
 * `/value`, controllable devices expose `/observed/<field>` (what the device
 * reported) and `/requested/<field>` (what homectl asked for). Plain field
 * paths prefer the reported value, because that is what a person can see.
 */
export function readSourceValue(
  source: ValueSourceLike | undefined,
  context: NarrativeContext,
): { known: boolean; value?: unknown; label: string; path?: string } {
  if (!source) {
    return { known: false, label: 'value' };
  }
  if (source.kind === 'device') {
    const device = context.devices?.[deviceKeyOf(source.device)];
    const label = deviceLabel(source.device, context);
    const path = source.path;
    const data = (device?.data ?? null) as TaggedDeviceData | null;
    if (!device || !data) {
      return { known: false, label, path };
    }
    const segments = (path ?? '').replace(/^\//, '').split('/').filter(Boolean);
    const sensor = data.Sensor ?? null;
    const controllable = data.Controllable ?? null;
    const observed = controllable?.last_report?.state ?? null;
    const requested = controllable?.state ?? null;

    if (segments.length === 0) {
      return { known: false, label, path };
    }

    // `/value` (and `/observed`) on a sensor.
    if (sensor && (segments[0] === 'value' || segments[0] === 'observed')) {
      const value =
        segments.length === 1 || segments[1] === 'value'
          ? sensor.value
          : sensor[segments.slice(1).join('/')];
      return value === undefined || value === null
        ? { known: false, label, path }
        : { known: true, value, label, path };
    }

    let base: Record<string, unknown> | null = null;
    let field = segments.join('/');
    if (segments[0] === 'observed') {
      base = observed;
      field = segments.slice(1).join('/');
    } else if (segments[0] === 'requested') {
      base = requested;
      field = segments.slice(1).join('/');
    } else if (observed || requested) {
      base = observed ?? requested;
    } else if (sensor) {
      base = sensor as Record<string, unknown>;
    }

    if (!base) {
      return { known: false, label, path };
    }
    let current: unknown = base;
    for (const segment of field.split('/').filter(Boolean)) {
      if (current === null || typeof current !== 'object') {
        return { known: false, label, path };
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (current === null || current === undefined) {
      return { known: false, label, path };
    }
    return { known: true, value: current, label, path };
  }
  if (source.kind === 'helper') {
    const helper = context.helpers?.find((entry) => entry.id === source.helper);
    const value = (helper as { value?: unknown } | undefined)?.value;
    return {
      known: value !== undefined,
      value,
      label: helper?.name?.trim() || source.helper,
    };
  }
  const computed = context.sources?.find((entry) => entry.id === source.source);
  return { known: false, label: computed?.name?.trim() || source.source };
}

function operatorWords(operator: string | undefined): string {
  switch (operator) {
    case 'lt':
    case '<':
      return 'is below';
    case 'lte':
    case '<=':
      return 'is at most';
    case 'gt':
    case '>':
      return 'is above';
    case 'gte':
    case '>=':
      return 'is at least';
    case 'eq':
    case '==':
    case '=':
      return 'is';
    case 'ne':
    case '!=':
      return 'is not';
    case 'contains':
      return 'contains';
    case 'starts_with':
      return 'starts with';
    case 'regex':
      return 'matches the pattern';
    default:
      return 'is';
  }
}

/** Operators that stand alone, without a comparison value. */
function standaloneOperatorPhrase(
  operator: string | undefined,
  path: string | undefined,
  deviceName = '',
): string | undefined {
  const field = `${path ?? ''} ${deviceName}`.toLowerCase();
  const isStateField =
    field.includes('occupancy') ||
    field.includes('motion') ||
    field.includes('presence') ||
    field.includes('movement');
  switch (operator) {
    case 'truthy':
      return isStateField ? 'is active' : 'is on or set';
    case 'exists':
      return 'is present';
    default:
      return undefined;
  }
}

/**
 * “Living room lamp brightness is below 30%” plus “, currently 45%” when a
 * reading exists. Standalone operators (truthy/exists) read as states instead
 * of comparisons.
 */
export function describeComparisonNarrative(
  expr: ConditionLike,
  context: NarrativeContext,
): { text: string; evidence?: string } {
  const source = expr.source;
  const limit = expr.value;
  const path = source?.kind === 'device' ? source.path : undefined;
  const field = humanField(path);
  const deviceName =
    source?.kind === 'device'
      ? deviceLabel(source.device, context)
      : readSourceValue(source, context).label;
  const subject = field ? `${deviceName} ${field}` : deviceName;

  const standalone = standaloneOperatorPhrase(expr.operator, path, deviceName);
  const live = readSourceValue(source, context);
  // A standalone state (“is active”) reads better as the state that is true
  // right now, rather than “is active (currently no)”.
  if (standalone && live.known && typeof live.value === 'boolean') {
    const isStateField = /active|present/.test(standalone);
    const positive = isStateField
      ? 'is active'
      : standalone.replace(/^is /, 'is ');
    const negative = isStateField ? 'is not active' : 'is off';
    return { text: `${subject} ${live.value ? positive : negative}` };
  }
  const text = standalone
    ? `${subject} ${standalone}`
    : `${subject} ${operatorWords(expr.operator)} ${formatReading(path, limit)}`;
  if (live.known) {
    const reading = formatReading(live.path, live.value);
    return {
      text,
      evidence: `${text}, currently ${reading}`,
    };
  }
  return { text };
}

function describeGroupConditionNarrative(
  expr: ConditionLike,
  context: NarrativeContext,
): string {
  const name = expr.group_id
    ? (context.groups?.[expr.group_id]?.name ?? expr.group_id)
    : 'the room';
  const quantifier = expr.quantifier ?? 'all';
  const subject =
    expr.power === true
      ? 'light is on'
      : expr.power === false
        ? 'light is off'
        : 'member matches';
  switch (quantifier) {
    case 'any':
      return `at least one ${subject} in ${name}`;
    case 'none':
      return `no ${subject} in ${name}`;
    default:
      return `every ${subject} in ${name}`;
  }
}

/**
 * The condition as one sentence. `all`/`any` stay readable by joining their
 * children with “and”/“or” instead of nesting bullet lists.
 */
export function describeConditionNarrative(
  expr: ConditionLike | undefined | null,
  context: NarrativeContext,
): { text: string; evidence?: string } {
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return { text: 'this condition' };
  }
  switch (expr.kind) {
    case 'literal':
      return { text: expr.value === false ? 'never' : 'always' };
    case 'comparison':
      return describeComparisonNarrative(expr, context);
    case 'group':
      return { text: describeGroupConditionNarrative(expr, context) };
    case 'not': {
      const inner = describeConditionNarrative(expr.condition, context);
      return { text: `not (${inner.text})` };
    }
    case 'all':
    case 'any': {
      const joiner = expr.kind === 'all' ? ' and ' : ' or ';
      const parts = (expr.conditions ?? []).map((child) =>
        describeConditionNarrative(child, context),
      );
      if (parts.length === 0) {
        return { text: expr.kind === 'all' ? 'always' : 'never' };
      }
      const evidence = parts
        .map((part) => part.evidence)
        .filter((value): value is string => Boolean(value));
      return {
        text: parts.map((part) => part.text).join(joiner),
        evidence: evidence.length > 0 ? evidence.join(' · ') : undefined,
      };
    }
    default:
      return { text: 'this condition' };
  }
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function formatDurationWords(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 seconds';
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Cron in sentences. The raw expression is returned as `detail` so an advanced
 * reader can still see exactly what is stored, but the first line is readable.
 */
export function describeScheduleNarrative(schedule: ScheduleLike | undefined): {
  text: string;
  detail?: string;
} {
  if (!schedule) {
    return { text: 'on a schedule' };
  }
  const detailParts: string[] = [];
  if (schedule.cron) {
    detailParts.push(schedule.cron);
  }
  if (schedule.timezone) {
    detailParts.push(schedule.timezone);
  }
  const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined;

  if (schedule.every_ms !== undefined && schedule.every_ms !== null) {
    const every = Number(schedule.every_ms);
    if (Number.isFinite(every) && every > 0) {
      return { text: `every ${formatDurationWords(every)}`, detail };
    }
  }

  const cron = (schedule.cron ?? '').trim();
  if (cron === '') {
    return { text: 'on a schedule', detail };
  }
  const fields = cron.split(/\s+/);
  // Accept both five-field and six-field (seconds-first) expressions.
  const parts = fields.length === 6 ? fields.slice(1) : fields;
  if (parts.length !== 5) {
    return { text: 'on a custom schedule', detail };
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const time = (h: string, m: string) =>
    `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  const isNumber = (value: string) => /^\d+$/.test(value);
  const simpleDay =
    (dayOfMonth === '*' || dayOfMonth === '?') &&
    (month === '*' || month === '?');
  const simpleWeekday = dayOfWeek === '*' || dayOfWeek === '?';

  if (minute.startsWith('*/') && hour === '*' && simpleDay && simpleWeekday) {
    const step = Number(minute.slice(2));
    return { text: `every ${step} minutes`, detail };
  }
  if (isNumber(minute) && hour.startsWith('*/') && simpleDay && simpleWeekday) {
    const step = Number(hour.slice(2));
    return { text: `every ${step} hours`, detail };
  }
  if (isNumber(minute) && isNumber(hour) && simpleDay && simpleWeekday) {
    return { text: `every day at ${time(hour, minute)}`, detail };
  }
  if (isNumber(minute) && isNumber(hour) && simpleDay && isNumber(dayOfWeek)) {
    const weekday = WEEKDAYS[Number(dayOfWeek) % 7];
    return { text: `every ${weekday} at ${time(hour, minute)}`, detail };
  }
  if (
    isNumber(minute) &&
    isNumber(hour) &&
    isNumber(dayOfMonth) &&
    (month === '*' || month === '?')
  ) {
    const day = Number(dayOfMonth);
    const suffix =
      day % 10 === 1 && day !== 11
        ? 'st'
        : day % 10 === 2 && day !== 12
          ? 'nd'
          : day % 10 === 3 && day !== 13
            ? 'rd'
            : 'th';
    return {
      text: `every month on the ${day}${suffix} at ${time(hour, minute)}`,
      detail,
    };
  }
  return { text: 'on a custom schedule', detail };
}

type TriggerLike = {
  kind?: string;
  id?: string;
  device?: DeviceRef;
  field?: string | null;
  mode?: string | null;
  schedule?: ScheduleLike;
  duration_ms?: number | bigint | string | null;
  timer?: string | null;
};

function deviceChangeVerb(ref: DeviceRef, context: NarrativeContext): string {
  const device = context.devices?.[deviceKeyOf(ref)];
  const name = `${device?.name ?? ''} ${ref.device_id}`.toLowerCase();
  if (/motion|occupancy|presence|movement/.test(name)) {
    return 'becomes active';
  }
  if (/door|window|contact/.test(name)) {
    return 'opens or closes';
  }
  if (/button|remote/.test(name)) {
    return 'is pressed';
  }
  if (/switch/.test(name)) {
    return 'changes';
  }
  const data = (device?.data ?? {}) as {
    Sensor?: { value?: unknown } | null;
    Controllable?: {
      state?: { power?: unknown; brightness?: unknown } | null;
    } | null;
  };
  if (data.Sensor && typeof data.Sensor.value === 'boolean') {
    return 'becomes active';
  }
  if (data.Controllable?.state?.power !== undefined) {
    return 'changes';
  }
  return 'reports a new value';
}

/**
 * The trigger phrase without its leading “When”, for a row that already carries
 * the label.
 */
export function describeTriggerPhrase(
  spec: TriggerLike | undefined,
  context: NarrativeContext,
): string {
  if (!spec) {
    return 'something happens';
  }
  switch (spec.kind) {
    case 'report': {
      const field = spec.field ? ` ${humanField(spec.field)}` : '';
      return `${deviceLabel(spec.device as DeviceRef, context)} reports${field}`;
    }
    case 'state_change': {
      const ref = spec.device as DeviceRef;
      return `${deviceLabel(ref, context)} ${deviceChangeVerb(ref, context)}`;
    }
    case 'predicate_transition':
      return 'its condition becomes true';
    case 'predicate_for':
      return `its condition has held for ${formatDurationWords(Number(spec.duration_ms ?? 0))}`;
    case 'schedule': {
      const schedule = describeScheduleNarrative(spec.schedule);
      const [{ text }] = [schedule];
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    case 'timer_fired':
      return `timer “${spec.timer ?? 'timer'}” finishes`;
    case 'startup':
      return 'homectl starts';
    case 'manual':
      return 'you run it by hand';
    default:
      return 'something happens';
  }
}

/** “When living room motion becomes active.” */
export function describeTriggerNarrative(
  spec: TriggerLike | undefined,
  context: NarrativeContext,
): string {
  if (!spec) {
    return 'When something happens';
  }
  return spec.kind === 'schedule'
    ? describeTriggerPhrase(spec, context)
    : `When ${describeTriggerPhrase(spec, context)}`;
}

/** Why a value is unreadable, in a sentence a person can act on. */
export function describeUnknownReasonSentence(
  reason: unknown,
  context: NarrativeContext,
): string {
  const entry = (reason ?? {}) as {
    kind?: string;
    entity?: string;
    field?: string;
    device?: string;
    group?: string;
    source?: string;
  };
  const deviceLabelFromKey = (key: string | undefined): string => {
    if (!key) {
      return 'the device';
    }
    const [integration, ...rest] = key.split('/');
    const deviceId = rest.join('/') || key;
    return context.devices?.[key]
      ? deviceLabel(
          { integration_id: integration, device_id: deviceId },
          context,
        )
      : deviceId;
  };
  switch (entry.kind) {
    case 'stale':
      return `stale readings from ${deviceLabelFromKey(entry.device)}`;
    case 'offline':
      return `${deviceLabelFromKey(entry.device)} is offline`;
    case 'missing_field':
      return `a field is missing (${entry.field ?? 'unknown field'})`;
    case 'missing_entity':
      return 'a device reference is missing';
    case 'empty_selection':
      return `no device is selected in ${entry.group ?? 'the group'}`;
    case 'not_initialized':
      return 'homectl has not read it yet';
    case 'unknown_source_value': {
      const source = context.sources?.find((s) => s.id === entry.source);
      return `${source?.name?.trim() || entry.source || 'a computed source'} has no value yet`;
    }
    default:
      return 'an input is unavailable';
  }
}

/** One action in the “then” list, already phrased as an effect. */
export function actionNarrative(
  description: string,
  index: number,
  total: number,
): string {
  if (total === 1) {
    return description;
  }
  return `${description} (step ${index + 1} of ${total})`;
}

export type RoutineTone = 'success' | 'warning' | 'neutral' | 'error' | 'info';

type RoutineStatusLike = {
  will_trigger?: boolean;
  condition?: { truth?: string; error?: string; unknown_reason?: unknown };
  triggers?: Array<{
    kind?: string;
    fired?: boolean;
    armed?: boolean;
    unknown_reason?: unknown;
    error?: string;
  }>;
  last_run?: {
    accepted?: boolean;
    dropped?: number | bigint | string;
    /** Per-step records, when the server reported them. */
    steps?: Array<{ disposition?: string }>;
  } | null;
};

/** The first trigger as a sentence, with a count when there are more. */
export function describeRoutineTriggerLine(
  definition: { triggers?: TriggerLike[] } | null | undefined,
  context: NarrativeContext,
): string | undefined {
  const triggers = definition?.triggers ?? [];
  if (triggers.length === 0) {
    return undefined;
  }
  const [first] = triggers;
  const sentence = describeTriggerNarrative(first, context);
  if (triggers.length === 1) {
    return sentence;
  }
  return `${sentence} (+${triggers.length - 1} more)`;
}

/**
 * What is true of this routine right now, in a sentence that names the reason.
 * “Waiting for data” is reserved for inputs the runtime genuinely cannot read;
 * a false condition says which reading is short.
 */
export function describeRoutineStateLine({
  enabled,
  definition,
  status,
  context,
  describeUnknown,
}: {
  enabled: boolean;
  /** The stored definition; its condition is typed loosely by the bindings. */
  definition?: { condition?: unknown } | null;
  status?: RoutineStatusLike | null;
  context: NarrativeContext;
  describeUnknown?: (reason: unknown) => string;
}): { text: string; tone: RoutineTone } {
  if (!enabled) {
    return { text: 'Off — it does not run', tone: 'neutral' };
  }
  if (!status) {
    return {
      text: 'Waiting for the first evaluation from the server',
      tone: 'neutral',
    };
  }
  const condition = status.condition;
  if (condition?.error) {
    return { text: `Needs attention: ${condition.error}`, tone: 'error' };
  }
  const unknownTrigger = (status.triggers ?? []).find(
    (trigger) =>
      trigger.unknown_reason !== undefined && trigger.unknown_reason !== null,
  );
  if (condition?.truth === 'unknown' || unknownTrigger) {
    const reason = condition?.unknown_reason ?? unknownTrigger?.unknown_reason;
    const phrase = describeUnknown
      ? describeUnknown(reason)
      : 'an input is unavailable';
    return { text: `Waiting for data: ${phrase}`, tone: 'warning' };
  }
  const erroredTrigger = (status.triggers ?? []).find(
    (trigger) => typeof trigger.error === 'string' && trigger.error !== '',
  );
  if (erroredTrigger?.error) {
    return { text: `Needs attention: ${erroredTrigger.error}`, tone: 'error' };
  }
  if (status.will_trigger) {
    return { text: 'Running now', tone: 'success' };
  }
  if (condition?.truth === 'false') {
    const narrative = describeConditionNarrative(
      definition?.condition as ConditionLike | undefined,
      context,
    );
    // A condition that is always true cannot be why nothing ran; say what is
    // actually true instead of “only if always”.
    if (narrative.text === 'always') {
      return { text: 'No matching event recorded recently', tone: 'neutral' };
    }
    const detail = narrative.evidence ?? narrative.text;
    return { text: `Not running: only if ${detail}`, tone: 'neutral' };
  }
  if (condition?.truth === 'true') {
    return {
      text: 'Condition is met — waiting for its trigger',
      tone: 'neutral',
    };
  }
  return { text: 'No matching event recorded recently', tone: 'neutral' };
}

/** The most recent recorded run, kept separate from live evaluation. */
export function describeRoutineLastOutcome(
  lastRun: RoutineStatusLike['last_run'],
): string | undefined {
  if (!lastRun) {
    return undefined;
  }
  if (lastRun.accepted === false) {
    return 'Last recorded outcome: the run was rejected';
  }
  const dropped = Number(lastRun.dropped ?? 0);
  const dispatched = (lastRun.steps ?? []).filter(
    (step: { disposition?: string }) => step.disposition !== 'suppressed',
  ).length;
  const steps =
    dispatched > 0
      ? `, ${dispatched} step${dispatched === 1 ? '' : 's'} dispatched`
      : '';
  return dropped > 0
    ? `Last recorded outcome: ran${steps}, ${dropped} dropped`
    : `Last recorded outcome: ran${steps}`;
}
