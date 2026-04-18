function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeJsonPointerToken(token: string) {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapeJsonPointerToken(token: string) {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function extractJsonPointers(value: unknown) {
  const pointers = new Set<string>();

  const walk = (currentValue: unknown, currentPath: string) => {
    if (currentPath) {
      pointers.add(currentPath);
    }

    if (Array.isArray(currentValue)) {
      currentValue.forEach((item, index) => {
        walk(item, `${currentPath}/${index}`);
      });
      return;
    }

    if (!isJsonRecord(currentValue)) {
      return;
    }

    Object.entries(currentValue).forEach(([key, item]) => {
      walk(item, `${currentPath}/${escapeJsonPointerToken(key)}`);
    });
  };

  walk(value, '');

  return Array.from(pointers).sort((left, right) => left.localeCompare(right));
}

export function resolveJsonPointer(value: unknown, pointer: string) {
  if (!pointer) {
    return value;
  }

  if (!pointer.startsWith('/')) {
    return undefined;
  }

  const tokens = pointer
    .split('/')
    .slice(1)
    .map((token) => unescapeJsonPointerToken(token));

  let currentValue: unknown = value;

  for (const token of tokens) {
    if (Array.isArray(currentValue)) {
      const index = Number(token);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      currentValue = currentValue[index];
      continue;
    }

    if (!isJsonRecord(currentValue)) {
      return undefined;
    }

    currentValue = currentValue[token];
  }

  return currentValue;
}