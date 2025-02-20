export type ExcludeUndefined<T> = {
  [P in keyof T]: Exclude<T[P], undefined>;
};

export function excludeUndefined<T extends object>(
  input: T | undefined,
): ExcludeUndefined<T> {
  const result = {} as ExcludeUndefined<T>;

  for (const key in input) {
    if (input[key] !== undefined) {
      result[key] = input[key] as Exclude<
        (typeof input)[typeof key],
        undefined
      >;
    }
  }

  return result;
}
