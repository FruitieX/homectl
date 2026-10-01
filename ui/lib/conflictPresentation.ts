import { parseDraftPath } from './entityDraft.ts';
const sensitiveName =
  /(?:password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key|credential|authorization)/i;
/** A conflict review never prints credentials, including inside array entries. */
export function describeConflictValue(
  value: unknown,
  path: string,
  sensitivePaths: readonly string[] = [],
): string {
  const sensitive = (parts: string[]) =>
    parts.some((key) => sensitiveName.test(key)) ||
    sensitivePaths.some((item) => {
      const prefix = parseDraftPath(item);
      return (
        prefix.length <= parts.length &&
        prefix.every((key, index) => key === parts[index])
      );
    });
  const scrub = (entry: unknown, parts: string[]): unknown => {
    if (sensitive(parts))
      return entry === undefined || entry === null || entry === ''
        ? 'Not set'
        : 'Hidden value';
    if (parts.at(-1) === 'data_base64' && typeof entry === 'string')
      return 'Uploaded image data';
    if (Array.isArray(entry))
      return entry.map((item, index) => scrub(item, [...parts, String(index)]));
    if (entry && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry).map(([key, item]) => [
          key,
          scrub(item, [...parts, key]),
        ]),
      );
    if (typeof entry === 'string')
      return entry
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[hidden]@')
        .replace(
          /([?&](?:token|key|api[_-]?key|password|secret)=)[^&#\s]+/gi,
          '$1[hidden]',
        );
    return entry;
  };
  if (value === undefined) return 'Not specified';
  if (value === null) return 'None';
  const parts = parseDraftPath(path);
  if (
    !sensitive(parts) &&
    parts.at(-1) === 'grid_data' &&
    typeof value === 'string'
  ) {
    try {
      const grid = JSON.parse(value);
      if (
        grid &&
        typeof grid.width === 'number' &&
        typeof grid.height === 'number'
      )
        return `${grid.width} × ${grid.height} tiles · ${Array.isArray(grid.devices) ? grid.devices.length : 0} placed devices · ${Object.keys(grid.groups ?? {}).length} room masks`;
    } catch {
      /* Show the original malformed layout for inspection below. */
    }
  }
  const safe = scrub(value, parts);
  const text =
    typeof safe === 'string' || typeof safe === 'bigint'
      ? String(safe)
      : typeof safe === 'boolean'
        ? safe
          ? 'Yes'
          : 'No'
        : JSON.stringify(
            safe,
            (_, entry) =>
              typeof entry === 'bigint' ? entry.toString() : entry,
            2,
          );
  return text.length > 2000 ? text.slice(0, 2000) + '\n…' : text;
}
