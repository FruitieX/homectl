/**
 * Pure helpers for room (group) detail pages: nesting validation, "where is
 * this used" evidence, unresolved members, and id suggestions.
 */

export type GroupNode = {
  id: string;
  name?: string;
  linked_groups?: string[];
};

export type NamedRef = { id: string; name: string };

function indexNodes(nodes: readonly GroupNode[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * Path from `from` down through linked rooms to `to`, inclusive, or null.
 * Cycle-safe: an existing loop below `from` is skipped instead of recursing.
 */
function pathBetween(
  nodes: Map<string, GroupNode>,
  from: string,
  to: string,
): string[] | null {
  const seen = new Set<string>();
  const stack: string[][] = [[from]];
  while (stack.length > 0) {
    const path = stack.pop() as string[];
    const current = path[path.length - 1];
    if (current === to) return path;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of nodes.get(current)?.linked_groups ?? []) {
      stack.push([...path, next]);
    }
  }
  return null;
}

/**
 * Nesting `candidateId` under `groupId` is invalid when the candidate already
 * contains the group — that would make the nesting graph cyclic.
 */
export function findNestedCycle(
  groups: readonly GroupNode[],
  groupId: string,
  candidateId: string,
): string[] | null {
  return pathBetween(indexNodes(groups), candidateId, groupId);
}

/**
 * The candidate is already included below the group. Not an error, but worth
 * saying so instead of silently adding a duplicate path.
 */
export function findExistingPath(
  groups: readonly GroupNode[],
  groupId: string,
  candidateId: string,
): string[] | null {
  return pathBetween(indexNodes(groups), groupId, candidateId);
}

type GroupKeyCarrier = Record<string, unknown>;

/** Walk any nested structure looking for `group_keys` arrays. */
function collectGroupKeys(
  value: unknown,
  found: Set<string>,
  seen: Set<unknown>,
) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectGroupKeys(item, found, seen);
    return;
  }
  for (const [key, item] of Object.entries(value as GroupKeyCarrier)) {
    if (key === 'group_keys' && Array.isArray(item)) {
      for (const entry of item) {
        if (typeof entry === 'string') found.add(entry);
      }
      continue;
    }
    collectGroupKeys(item, found, seen);
  }
}

export type GroupUsage = { scenes: NamedRef[]; routines: NamedRef[] };

/**
 * Which scenes and routines target this room. This is the evidence the detail
 * page leads with: it comes from the loaded configuration, not from a guess.
 */
export function describeGroupUsage(
  { scenes, routines }: { scenes: readonly any[]; routines: readonly any[] },
  groupId: string,
): GroupUsage {
  const usedByScenes = scenes
    .filter((scene) => {
      const states = scene?.group_states;
      return states !== null && typeof states === 'object' && groupId in states;
    })
    .map((scene) => ({
      id: String(scene.id),
      name: String(scene.name ?? scene.id),
    }));

  const usedByRoutines = routines
    .filter((routine) => {
      const keys = new Set<string>();
      collectGroupKeys(routine, keys, new Set());
      return keys.has(groupId);
    })
    .map((routine) => ({
      id: String(routine.id),
      name: String(routine.name ?? routine.id),
    }));

  return { scenes: usedByScenes, routines: usedByRoutines };
}

export type GroupLike = {
  id: string;
  devices?: { integration_id: string; device_id: string }[];
};

export const groupDeviceKey = (device: {
  integration_id: string;
  device_id: string;
}) => `${device.integration_id}/${device.device_id}`;

/** Members that no longer resolve to a known device, kept visible for repair. */
export function missingGroupDevices(
  group: GroupLike,
  presentKeys: ReadonlySet<string>,
): string[] {
  return (group.devices ?? [])
    .map(groupDeviceKey)
    .filter((key) => !presentKeys.has(key));
}

const FALLBACK_ID = 'room';

/** Suggested id from a name: ascii slug, underscore-separated, collision-free. */
export function suggestId(
  name: string,
  existingIds: readonly string[],
): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = slug === '' ? FALLBACK_ID : slug;
  if (!existingIds.includes(base)) return base;
  let suffix = 2;
  while (existingIds.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
