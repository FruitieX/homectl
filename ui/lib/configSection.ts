/**
 * Pure helpers behind the one-section editing model used by detail pages.
 *
 * A detail page shows each section as a read view; pressing Edit hands the
 * section a deep copy of only its own fields, and Save merges that section
 * back into the latest loaded item. Keeping the copy/compare/merge rules in
 * one tested module is what lets every page share the same guarantees:
 * Cancel really discards, a stale section is detected before it overwrites a
 * newer server value, and live values outside the section never count as a
 * conflict.
 */

export type FieldError = {
  /** Section, subsection, or field key the message belongs to. */
  field: string;
  message: string;
};

export function deepCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through to the JSON copy for values structuredClone rejects
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null || typeof a !== 'object') {
    // NaN is not equal to itself in ===, but both sides being NaN is "same value"
    return (
      typeof a === 'number' &&
      typeof b === 'number' &&
      Number.isNaN(a) &&
      Number.isNaN(b)
    );
  }
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) {
    return false;
  }
  if (aArray && bArray) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, (b as unknown[])[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  const keys = new Set([...aKeys, ...bKeys]);
  for (const key of keys) {
    // An explicit `undefined` and a missing key are the same thing here: both
    // mean "this field carries no value".
    if (!deepEqual(aRecord[key], bRecord[key])) {
      return false;
    }
  }
  return true;
}

export function pickFields<T extends object>(
  item: T,
  fields: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    picked[field] = (item as Record<string, unknown>)[field];
  }
  return picked;
}

/** Merge a section draft over the latest loaded item, leaving other fields alone. */
export function mergeFields<T extends object>(item: T, section: Partial<T>): T {
  return { ...item, ...section };
}

/**
 * True when the fields this section owns changed on the server since the
 * snapshot was captured. Live values (device state, run status) are not part
 * of the compared fields, so they never raise a conflict.
 */
export function sectionChangedElsewhere(
  baseline: Record<string, unknown>,
  latest: Record<string, unknown>,
  ignoreFields: readonly string[] = [],
): boolean {
  const ignore = new Set(ignoreFields);
  const fields = Object.keys(baseline).filter((field) => !ignore.has(field));
  for (const field of fields) {
    if (!deepEqual(baseline[field], latest[field])) {
      return true;
    }
  }
  return false;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Plain-language freshness for a timestamp in milliseconds. Unknown values say
 * what evidence is missing rather than pretending to be current.
 */
export function formatFreshness(
  atMs: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (atMs === null || atMs === undefined || !Number.isFinite(atMs)) {
    return 'no fresh report';
  }
  const elapsed = Math.max(0, nowMs - atMs);
  if (elapsed < 10_000) {
    return 'just now';
  }
  if (elapsed < MINUTE) {
    const seconds = Math.round(elapsed / 1000);
    return `${seconds} seconds ago`;
  }
  if (elapsed < HOUR) {
    const minutes = Math.round(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.round(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(elapsed / DAY);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Field key of the first error, for focusing and for the error summary. */
export function firstInvalidField(
  errors: readonly FieldError[],
): string | null {
  return errors.length > 0 ? errors[0].field : null;
}

const STATUS_WORDS = {
  running: 'Running',
  enabled: 'Enabled',
  off: 'Off',
  waiting: 'Waiting for data',
  attention: 'Needs attention',
  unknown: 'Unknown',
} as const;

export type StatusWord = (typeof STATUS_WORDS)[keyof typeof STATUS_WORDS];

/**
 * Standard status vocabulary. Every page uses these words; each one is paired
 * with a plain reason where the underlying data can supply one.
 */
export const statusWords = STATUS_WORDS;

export function statusWord(key: keyof typeof STATUS_WORDS): StatusWord {
  return STATUS_WORDS[key];
}
