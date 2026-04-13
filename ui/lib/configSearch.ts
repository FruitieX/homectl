function stringifyConfigSearchValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stringifyConfigSearchValue(entry)).join(' ');
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function matchesConfigSearch(search: string, ...values: unknown[]): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values
    .map((value) => stringifyConfigSearchValue(value))
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}