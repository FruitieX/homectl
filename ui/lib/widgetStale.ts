/** Parses `x-homectl-stale-since` (Unix ms); null when absent or invalid. */
export function parseStaleSince(header: string | null): Date | null {
  if (!header) return null;
  const ms = Number(header);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

/** "; showing data from 15:49." for a refresh notice, or "." without data. */
export function earlierDataSuffix(hasData: boolean, since: Date | null) {
  if (!hasData) return '.';
  if (!since) return '; showing earlier results.';
  const time = since.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `; showing data from ${time}.`;
}
