/**
 * Conditions in words: a device/helper/source reference and a comparison read as
 * a sentence a person can check, not as a JSON pointer plus an operator token.
 * Pure functions so the routines UI and its tests agree on the wording.
 */

/** Fields a person recognises, keyed by the JSON-pointer tail they map to. */
const FIELD_LABELS: Record<string, string> = {
  value: 'value',
  state: 'state',
  power: 'power',
  brightness: 'brightness',
  temperature: 'temperature',
  humidity: 'humidity',
  pressure: 'pressure',
  illuminance: 'light level',
  motion: 'motion',
  occupancy: 'occupancy',
  contact: 'contact',
  battery: 'battery',
  color: 'color',
  transition: 'fade',
};

/** Operators that read as words rather than symbols. */
const OPERATOR_WORDS: Record<string, string> = {
  eq: 'is',
  ne: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  starts_with: 'starts with',
  exists: 'exists',
  truthy: 'has a value',
  regex: 'matches',
};

/** Operators whose comparison needs no value on the right. */
export const OPERATORS_WITHOUT_VALUE = new Set(['exists', 'truthy']);

/**
 * The last meaningful segment of a JSON pointer as a readable field name.
 * Unknown paths keep their own words so nothing is invented: `/value/level`
 * becomes "level", and a pointer to an index stays as it is.
 */
export function fieldLabel(path: string | null | undefined): string {
  const pointer = (path ?? '').trim();
  if (!pointer) return 'value';
  const segments = pointer
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '-' && part !== '~1');
  const last = segments[segments.length - 1] ?? '';
  if (!last) return 'value';
  const known = FIELD_LABELS[last.toLowerCase()];
  if (known) return known;
  if (/^\d+$/.test(last)) return `item ${Number(last) + 1}`;
  // Unknown keys keep their own words rather than a guess.
  return last.replace(/[_-]+/g, ' ');
}

/** The comparison in words, for example "is", "is more than", "has a value". */
export function operatorWords(operator: string): string {
  return OPERATOR_WORDS[operator] ?? operator.replace(/_/g, ' ');
}

/** How a readable value appears in a sentence: on/off instead of true/false. */
export function valueWords(
  value: unknown,
  field?: string | null,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') {
    if ((field ?? '').toLowerCase() === 'power') return value ? 'on' : 'off';
    if (
      ['motion', 'occupancy', 'contact'].includes((field ?? '').toLowerCase())
    ) {
      return value ? 'active' : 'clear';
    }
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (field === 'brightness') return `${Math.round(value * 100)}%`;
    return String(value);
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * A comparison as one sentence: "Living room sensor motion is active".
 * `resolveDevice` turns a device id into the name a person sees.
 */
export function conditionWords(
  source: { field: string; subject: string },
  operator: string,
  value: unknown,
): string {
  const words = operatorWords(operator);
  if (OPERATORS_WITHOUT_VALUE.has(operator)) {
    return `${source.subject} ${source.field} ${words}`;
  }
  const rendered = valueWords(value, source.field);
  if (rendered === null) {
    return `${source.subject} ${source.field} ${words} a value`;
  }
  return `${source.subject} ${source.field} ${words} ${rendered}`;
}
