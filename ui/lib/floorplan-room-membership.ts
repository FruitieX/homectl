import type { FloorplanGrid } from '../ui/FloorplanGridEditor';

export interface RoomMembershipGroup {
  id: string;
  name: string;
  device_keys?: string[] | null;
  devices?: ReadonlyArray<{ integration_id: string; device_id: string }>;
}

export interface RoomMembershipSuggestion {
  deviceKey: string;
  deviceName: string;
  groupId: string;
  groupName: string;
}

const memberKeys = (group: RoomMembershipGroup) =>
  new Set(
    group.device_keys ??
      (group.devices ?? []).map((d) => `${d.integration_id}/${d.device_id}`),
  );

/**
 * The room a placed device sits in: the room area covering its tile. Where
 * room areas overlap, the smallest wins, like selecting a room on the canvas.
 */
export function roomAtPlacement(
  grid: FloorplanGrid,
  groups: readonly RoomMembershipGroup[],
  placement: { x: number; y: number },
): RoomMembershipGroup | undefined {
  // Placement coordinates are tile centres, so x = 2 covers tile 2.
  const cell = {
    x: Math.floor(placement.x + 0.5),
    y: Math.floor(placement.y + 0.5),
  };
  return Object.entries(grid.groups)
    .filter(([, cells]) => cells.some((c) => c.x === cell.x && c.y === cell.y))
    .sort(([a, ac], [b, bc]) => ac.length - bc.length || a.localeCompare(b))
    .map(([id]) => groups.find((group) => group.id === id))
    .find((group) => group !== undefined);
}

/** Placed devices standing in a room they are not yet a member of. */
export function roomMembershipSuggestions(
  grid: FloorplanGrid | null,
  groups: readonly RoomMembershipGroup[],
): RoomMembershipSuggestion[] {
  if (!grid) return [];
  return grid.devices.flatMap((placement) => {
    const room = roomAtPlacement(grid, groups, placement);
    if (!room || memberKeys(room).has(placement.deviceKey)) return [];
    return [
      {
        deviceKey: placement.deviceKey,
        deviceName: placement.deviceName,
        groupId: room.id,
        groupName: room.name,
      },
    ];
  });
}

/** Device references to append per group, for the groups API. */
export function membershipAdditions(
  suggestions: readonly RoomMembershipSuggestion[],
): Map<string, { integration_id: string; device_id: string }[]> {
  const additions = new Map<
    string,
    { integration_id: string; device_id: string }[]
  >();
  for (const { deviceKey, groupId } of suggestions) {
    const slash = deviceKey.indexOf('/');
    if (slash <= 0) continue;
    const refs = additions.get(groupId) ?? [];
    if (
      !refs.some(
        (ref) => `${ref.integration_id}/${ref.device_id}` === deviceKey,
      )
    )
      refs.push({
        integration_id: deviceKey.slice(0, slash),
        device_id: deviceKey.slice(slash + 1),
      });
    additions.set(groupId, refs);
  }
  return additions;
}
