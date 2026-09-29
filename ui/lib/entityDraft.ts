import { deepCopy, deepEqual, type FieldError } from './configSection.ts';

export type DraftInput = { raw: string; error?: string };
const hasIncompleteInputs = (inputs: Record<string, DraftInput> | undefined) =>
  Object.values(inputs ?? {}).some((input) => Boolean(input.error));

export type EntityDraft<T extends object> = {
  key: string;
  href: string;
  label: string;
  baseline: T;
  value: T;
  latest: T;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  errors: FieldError[];
  generation: number;
  submitted?: T;
  inputs?: Record<string, DraftInput>;
  submittedInputs?: Record<string, DraftInput>;
  /** Inactive editor variants; session-only and never part of an API write. */
  variants?: Record<string, Record<string, unknown>>;
};

/** Session-only drafts. Never persist credentials or configuration in browser storage. */
export function createEntityDraftStore() {
  const records = new Map<string, EntityDraft<object>>();
  const listeners = new Set<() => void>();
  let version = 0;
  const emit = () => {
    version++;
    listeners.forEach((listener) => listener());
  };
  const get = <T extends object>(key: string) =>
    records.get(key) as EntityDraft<T> | undefined;
  function put<T extends object>(entry: EntityDraft<T>) {
    records.set(entry.key, entry);
    emit();
    return entry;
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    get,
    list: () => [...records.values()],
    sync<T extends object>(
      key: string,
      value: T,
      metadata: { href: string; label: string },
    ) {
      const current = get<T>(key);
      if (!current)
        return put({
          key,
          ...metadata,
          value: deepCopy(value),
          baseline: deepCopy(value),
          latest: deepCopy(value),
          dirty: false,
          saving: false,
          conflict: false,
          variants: undefined,
          inputs: undefined,
          errors: [],
          generation: 0,
        });
      if (
        deepEqual(value, current.latest) &&
        current.label === metadata.label &&
        current.href === metadata.href
      )
        return current;
      if (!current.dirty && !current.saving)
        return put({
          ...current,
          ...metadata,
          value: deepCopy(value),
          baseline: deepCopy(value),
          latest: deepCopy(value),
          conflict: false,
          variants: undefined,
          inputs: undefined,
          errors: [],
        });
      return put({
        ...current,
        ...metadata,
        latest: deepCopy(value),
        conflict:
          !deepEqual(current.baseline, value) &&
          !deepEqual(current.submitted, value),
      });
    },
    change<T extends object>(key: string, update: T | ((value: T) => T)) {
      const current = get<T>(key);
      if (!current) return;
      const value =
        typeof update === 'function' ? update(deepCopy(current.value)) : update;
      return put({
        ...current,
        value: deepCopy(value),
        dirty:
          !deepEqual(value, current.baseline) ||
          hasIncompleteInputs(current.inputs),
        errors: [],
      });
    },
    errors(key: string, errors: FieldError[]) {
      const current = get(key);
      if (current) put({ ...current, errors });
    },
    stageInput(key: string, path: string, input: DraftInput) {
      const current = get(key);
      if (!current) return;
      const inputs = { ...current.inputs, [path]: input };
      put({
        ...current,
        inputs,
        errors: current.errors.filter((error) => error.field !== path),
        dirty:
          !deepEqual(current.value, current.baseline) ||
          hasIncompleteInputs(inputs),
      });
    },
    /** Remap session-only editor state with a collection edit, never by its new index. */
    remapEditorPaths(key: string, remap: (path: string) => string | null) {
      const current = get(key);
      if (!current) return;
      const map = <V>(values: Record<string, V> | undefined) =>
        Object.fromEntries(
          Object.entries(values ?? {}).flatMap(([path, value]) => {
            const next = remap(path);
            return next === null ? [] : [[next, value]];
          }),
        );
      const inputs = map(current.inputs);
      put({
        ...current,
        variants: map(current.variants),
        inputs,
        dirty:
          !deepEqual(current.value, current.baseline) ||
          hasIncompleteInputs(inputs),
        errors: [],
      });
    },
    switchVariant<V>(
      key: string,
      slot: string,
      from: string,
      value: V,
      to: string,
      fallback: V,
    ): V {
      const current = get(key);
      if (!current) return deepCopy(fallback);
      const choices = { ...current.variants?.[slot], [from]: deepCopy(value) };
      const inputs = Object.fromEntries(
        Object.entries(current.inputs ?? {}).filter(
          ([path]) => path !== slot && !path.startsWith(slot + '/'),
        ),
      );
      put({
        ...current,
        inputs,
        variants: { ...current.variants, [slot]: choices },
        dirty:
          !deepEqual(current.value, current.baseline) ||
          hasIncompleteInputs(inputs),
      });
      return deepCopy(
        Object.hasOwn(choices, to) ? (choices[to] as V) : fallback,
      );
    },
    discard(key: string) {
      const current = get(key);
      if (!current || current.saving) return;
      put({
        ...current,
        baseline: deepCopy(current.latest),
        value: deepCopy(current.latest),
        dirty: false,
        conflict: false,
        errors: [],
        variants: undefined,
        inputs: undefined,
      });
    },
    start<T extends object>(key: string) {
      const current = get<T>(key);
      if (
        !current ||
        current.saving ||
        current.conflict ||
        hasIncompleteInputs(current.inputs)
      )
        return null;
      const submission = {
        value: deepCopy(current.value),
        baseline: deepCopy(current.baseline),
        generation: current.generation + 1,
      };
      put({
        ...current,
        saving: true,
        generation: submission.generation,
        submitted: submission.value,
        submittedInputs: deepCopy(current.inputs),
        errors: [],
      });
      return submission;
    },
    saved<T extends object>(key: string, generation: number, saved: T) {
      const current = get<T>(key);
      if (!current || current.generation !== generation) return;
      // A save response only clears the submitted version. Typing during the
      // request remains an unsaved edit, even when the response normalizes data.
      const value = deepEqual(current.value, current.submitted)
        ? deepCopy(saved)
        : current.value;
      const remainingInputs = Object.fromEntries(
        Object.entries(current.inputs ?? {}).filter(
          ([path, input]) => !deepEqual(input, current.submittedInputs?.[path]),
        ),
      );
      const inputs = Object.keys(remainingInputs).length
        ? remainingInputs
        : undefined;
      put({
        ...current,
        value,
        inputs,
        submittedInputs: undefined,
        baseline: deepCopy(saved),
        latest: deepCopy(saved),
        dirty: !deepEqual(value, saved) || hasIncompleteInputs(inputs),
        variants: deepEqual(value, saved) ? undefined : current.variants,
        saving: false,
        conflict: false,
        submitted: undefined,
        errors: [],
      });
    },
    failed<T extends object>(
      key: string,
      generation: number,
      message: string,
      latest?: T,
    ) {
      const current = get<T>(key);
      if (!current || current.generation !== generation) return;
      put({
        ...current,
        saving: false,
        submitted: undefined,
        submittedInputs: undefined,
        errors: [{ field: '', message }],
        ...(latest ? { latest: deepCopy(latest), conflict: true } : {}),
      });
    },
    /** Call only after displaying the competing values and an explicit choice. */
    rebase(key: string, keepFields: readonly string[]) {
      const current = get<Record<string, unknown>>(key);
      if (!current || current.saving) return;
      const value = deepCopy(current.latest);
      for (const field of keepFields) {
        const parts = field.startsWith('/') ? parseDraftPath(field) : [field];
        let target = value;
        let source = current.value;
        for (const part of parts.slice(0, -1)) {
          if (!Object.hasOwn(target, part) || !isDraftObject(target[part]))
            Object.defineProperty(target, part, {
              value: {},
              enumerable: true,
              writable: true,
              configurable: true,
            });
          target = target[part] as Record<string, unknown>;
          source = source[part] as Record<string, unknown>;
        }
        const last = parts.at(-1)!;
        if (Object.hasOwn(source, last))
          Object.defineProperty(target, last, {
            value: deepCopy(source[last]),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        else delete target[last];
      }
      put({
        ...current,
        baseline: deepCopy(current.latest),
        value,
        conflict: false,
        dirty:
          !deepEqual(value, current.latest) ||
          (keepFields.length > 0 && hasIncompleteInputs(current.inputs)),
        inputs:
          keepFields.length > 0
            ? Object.fromEntries(
                Object.entries(current.inputs ?? {}).filter(
                  ([, input]) => input.error,
                ),
              )
            : undefined,
        errors: [],
      });
    },
    forget(key: string) {
      records.delete(key);
      emit();
    },
  };
}
export const entityDraftStore = createEntityDraftStore();

function isDraftObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseDraftPath(path: string): string[] {
  return path
    .slice(1)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
}
export function draftPathValue(value: unknown, path: string): unknown {
  return parseDraftPath(path).reduce<unknown>(
    (current, key) => (isDraftObject(current) ? current[key] : undefined),
    value,
  );
}
/** Arrays and changed variants are reviewed as a unit; never merge reordered indices. */
export function changedDraftPaths<T extends object>(
  draft: EntityDraft<T>,
): string[] {
  const paths: string[] = [];
  const walk = (base: unknown, mine: unknown, saved: unknown, path: string) => {
    if (deepEqual(base, mine)) return;
    if (
      isDraftObject(base) &&
      isDraftObject(mine) &&
      isDraftObject(saved) &&
      (!path ||
        ['kind', 'action'].every(
          (key) =>
            deepEqual(base[key], mine[key]) && deepEqual(base[key], saved[key]),
        ))
    ) {
      for (const key of new Set([...Object.keys(base), ...Object.keys(mine)]))
        walk(
          base[key],
          mine[key],
          saved[key],
          `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        );
    } else paths.push(path);
  };
  walk(draft.baseline, draft.value, draft.latest, '');
  return paths;
}
export function changedDraftFields<T extends object>(
  draft: EntityDraft<T>,
): string[] {
  const base = draft.baseline as Record<string, unknown>;
  const value = draft.value as Record<string, unknown>;
  return [...new Set([...Object.keys(base), ...Object.keys(value)])].filter(
    (key) => !deepEqual(base[key], value[key]),
  );
}

/** `order[newIndex]` is the previous index; omitted indices were removed. */
export function remapArrayEditorPath(
  path: string,
  arrayPath: string,
  order: readonly number[],
): string | null {
  if (!path.startsWith(arrayPath + '/')) return path;
  const suffix = path.slice(arrayPath.length + 1);
  const match = /^(\d+)(\/.*)?$/.exec(suffix);
  if (!match) return path;
  const index = order.indexOf(Number(match[1]));
  return index < 0 ? null : `${arrayPath}/${index}${match[2] ?? ''}`;
}
