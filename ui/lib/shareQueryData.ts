/** Reuse unchanged JSON branches without invoking setters for user-authored keys. */
export function shareQueryData(
  previous: unknown,
  next: unknown,
  depth = 0,
): unknown {
  if (Object.is(previous, next)) return previous;
  if (depth > 500) return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const shared = next.map((value, index) =>
      shareQueryData(previous[index], value, depth + 1),
    );
    return previous.length === shared.length &&
      shared.every((value, index) => Object.is(value, previous[index]))
      ? previous
      : shared;
  }
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype;
  if (!record(previous) || !record(next)) return next;
  let unchanged = Object.keys(previous).length === Object.keys(next).length;
  const entries = Object.entries(next).map(([key, value]) => {
    const present = Object.hasOwn(previous, key);
    const shared = shareQueryData(
      present ? previous[key] : undefined,
      value,
      depth + 1,
    );
    if (!present || !Object.is(shared, previous[key])) unchanged = false;
    return [key, shared];
  });
  return unchanged ? previous : Object.fromEntries(entries);
}
