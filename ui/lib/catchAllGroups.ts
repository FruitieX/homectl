import {
  resolveGroupDeviceKeys,
  type GroupPreviewMap,
  type GroupPreviewSource,
} from './group-floorplan-preview.ts';

type GroupWithVisibility = GroupPreviewSource & { hidden?: boolean | null };

/**
 * Groups such as "All" or "Whole home" that cover every device of every other
 * room. They are useful for switching everything off, but listing them as one
 * more room, or as a membership of every device, only adds noise.
 *
 * A group qualifies when at least two other rooms with devices exist and its
 * nested-resolved devices include all of theirs. `isKnown` limits the
 * comparison, typically to lights and switches that currently exist: a stale
 * reference or a room's motion sensor does not hide an "All lights" group.
 */
export function catchAllGroupIds(
  groups: Record<string, GroupWithVisibility | null | undefined>,
  isKnown: (deviceKey: string) => boolean = () => true,
): Set<string> {
  const map = groups as GroupPreviewMap;
  const resolved = new Map<string, Set<string>>();
  for (const [id, group] of Object.entries(groups)) {
    if (!group || group.hidden) continue;
    const keys = resolveGroupDeviceKeys(id, map).filter(isKnown);
    if (keys.length) resolved.set(id, new Set(keys));
  }
  const result = new Set<string>();
  for (const [id, keys] of resolved) {
    const others = [...resolved].filter(([other]) => other !== id);
    if (others.filter(([, otherKeys]) => otherKeys.size < keys.size).length < 2)
      continue;
    // Every other room must be inside it: "Upstairs" holding Bedroom and
    // Office is a floor, not the home, while Kitchen is elsewhere.
    if (
      others.every(([, otherKeys]) =>
        [...otherKeys].every((key) => keys.has(key)),
      )
    )
      result.add(id);
  }
  return result;
}
