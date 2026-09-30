import type { ValueHistoryEntry } from '@/bindings/ValueHistoryEntry';
export function sensorHistoryFields(entries: ValueHistoryEntry[]) {
  const fields = new Map<
    string,
    { time: number; value: number | string | boolean }[]
  >();
  const visit = (value: unknown, path: string, time: number, depth = 0) => {
    if (depth > 4) return;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value))
        visit(child, path ? `${path} / ${key}` : key, time, depth + 1);
    } else if (
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      const key = path || 'Value';
      fields.set(key, [...(fields.get(key) ?? []), { time, value }]);
    }
  };
  for (const e of entries) visit(e.value, '', Number(e.changed_at_ms));
  return [...fields].map(([name, samples]) => ({
    name,
    samples: samples.sort((a, b) => a.time - b.time),
  }));
}
export const sensorValueLabel = (value: unknown) =>
  typeof value === 'boolean'
    ? value
      ? 'On'
      : 'Off'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
