/**
 * Pure helpers backing the group/room floorplan previews. Selection is
 * deterministic: an explicit group placement on a floorplan always wins,
 * otherwise the floorplan holding the most of the group's devices wins, with
 * stable id tie-breaks so the same group always renders the same preview.
 */

/** Minimal shape of a group config, flattened or raw. */
export interface GroupPreviewSource {
  device_keys?: readonly string[] | null;
  linked_groups?: readonly string[] | null;
  devices?: ReadonlyArray<{
    integration_id: string;
    device_id: string;
  }> | null;
}

export type GroupPreviewMap = Record<
  string,
  GroupPreviewSource | null | undefined
>;

export interface FloorplanPreviewGrid {
  devices: ReadonlyArray<{ deviceKey: string }>;
  groups?: Record<string, readonly unknown[] | undefined> | null;
}

export interface FloorplanPreviewSource {
  id: string;
  name: string;
  grid: FloorplanPreviewGrid | null;
}

export type FloorplanSelectionReason = 'placement' | 'devices';

export interface GroupFloorplanSelection<
  T extends FloorplanPreviewSource = FloorplanPreviewSource,
> {
  floorplan: T;
  /** Resolved leaf device keys belonging to the group. */
  deviceKeys: string[];
  /** Of those, the keys placed on the selected floorplan. */
  placedDeviceKeys: string[];
  /** Why this floorplan was picked. */
  reason: FloorplanSelectionReason;
}

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

/**
 * Resolve a group to its leaf device keys, walking `linked_groups` when
 * present. Handles cycles and deduplicates; output is sorted so previews and
 * tests are deterministic.
 */
export function resolveGroupDeviceKeys(
  groupId: string,
  groups: GroupPreviewMap,
): string[] {
  const deviceKeys = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);

    const group = groups[id];
    if (!group) {
      return;
    }

    const directKeys = group.device_keys
      ? group.device_keys
      : (group.devices ?? []).map(
          (device) => `${device.integration_id}/${device.device_id}`,
        );

    for (const key of directKeys) {
      if (key.length > 0) {
        deviceKeys.add(key);
      }
    }

    for (const linked of group.linked_groups ?? []) {
      visit(linked);
    }
  };

  visit(groupId);
  return [...deviceKeys].sort();
}

function placedDeviceKeysOnFloorplan(
  floorplan: FloorplanPreviewSource,
  wanted: ReadonlySet<string>,
): string[] {
  if (!floorplan.grid) {
    return [];
  }

  const placed = new Set<string>();
  for (const device of floorplan.grid.devices) {
    if (wanted.has(device.deviceKey)) {
      placed.add(device.deviceKey);
    }
  }
  return [...placed];
}

function groupPlacementCells(
  floorplan: FloorplanPreviewSource,
  groupId: string,
): number {
  const cells = floorplan.grid?.groups?.[groupId];
  return Array.isArray(cells) ? cells.length : 0;
}

/**
 * Pick the floorplan to preview for a group. A non-empty group placement mask
 * (`grid.groups[groupId]`) wins even when it holds no devices; otherwise the
 * floorplan with the most of the group's devices wins. Ties fall back to the
 * placed-device count, then placement size, then floorplan id.
 */
export function selectGroupFloorplan<T extends FloorplanPreviewSource>(
  groupId: string,
  deviceKeys: readonly string[],
  floorplans: readonly T[],
): GroupFloorplanSelection<T> | null {
  const wanted = new Set(deviceKeys);
  let placementChoice: {
    floorplan: T;
    placedDeviceKeys: string[];
    cells: number;
  } | null = null;
  let deviceChoice: { floorplan: T; placedDeviceKeys: string[] } | null = null;

  for (const floorplan of floorplans) {
    const placedDeviceKeys = placedDeviceKeysOnFloorplan(floorplan, wanted);

    if (placedDeviceKeys.length > 0) {
      if (
        !deviceChoice ||
        placedDeviceKeys.length > deviceChoice.placedDeviceKeys.length ||
        (placedDeviceKeys.length === deviceChoice.placedDeviceKeys.length &&
          floorplan.id.localeCompare(deviceChoice.floorplan.id) < 0)
      ) {
        deviceChoice = { floorplan, placedDeviceKeys };
      }
    }

    const cells = groupPlacementCells(floorplan, groupId);
    if (cells > 0) {
      if (
        !placementChoice ||
        placedDeviceKeys.length > placementChoice.placedDeviceKeys.length ||
        (placedDeviceKeys.length === placementChoice.placedDeviceKeys.length &&
          (cells > placementChoice.cells ||
            (cells === placementChoice.cells &&
              floorplan.id.localeCompare(placementChoice.floorplan.id) < 0)))
      ) {
        placementChoice = { floorplan, placedDeviceKeys, cells };
      }
    }
  }

  const choice = placementChoice ?? deviceChoice;
  if (!choice) {
    return null;
  }

  return {
    floorplan: choice.floorplan,
    deviceKeys: [...deviceKeys],
    placedDeviceKeys: choice.placedDeviceKeys,
    reason: placementChoice ? 'placement' : 'devices',
  };
}

/**
 * Bounding box covering the given device positions, padded by a fraction of
 * its longest edge and clamped to the floorplan. Returns null when none of the
 * keys are placed.
 *
 * A lone device (or a very tight cluster) gets `minSpanRatio` of the
 * floorplan's longest edge as its minimum span, so previews show the
 * surrounding rooms instead of zooming into a single marker. The resulting
 * span is at least `max(deviceSpan, minSpan) * (1 + 2 * paddingRatio)`.
 */
export function getGroupFocusBounds(
  positions: Readonly<Record<string, PreviewPoint | undefined>>,
  deviceKeys: readonly string[],
  sceneSize: { width: number; height: number },
  paddingRatio = 0.25,
  minSpanRatio = 0.25,
): PreviewBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const key of deviceKeys) {
    const position = positions[key];
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      continue;
    }

    found = true;
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }

  if (!found) {
    return null;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const minSpan =
    Math.max(0, minSpanRatio) * Math.max(sceneSize.width, sceneSize.height);
  const spanX = Math.max(maxX - minX, minSpan);
  const spanY = Math.max(maxY - minY, minSpan);
  const padding = Math.max(spanX, spanY) * Math.max(0, paddingRatio);

  // Shift (rather than shrink) the box at floorplan edges so the minimum
  // span survives clamping and the zoom cap still applies.
  let x = centerX - spanX / 2 - padding;
  let right = centerX + spanX / 2 + padding;
  if (x < 0) {
    right = Math.min(sceneSize.width, right - x);
    x = 0;
  }
  if (right > sceneSize.width) {
    x = Math.max(0, x - (right - sceneSize.width));
    right = sceneSize.width;
  }

  let y = centerY - spanY / 2 - padding;
  let bottom = centerY + spanY / 2 + padding;
  if (y < 0) {
    bottom = Math.min(sceneSize.height, bottom - y);
    y = 0;
  }
  if (bottom > sceneSize.height) {
    y = Math.max(0, y - (bottom - sceneSize.height));
    bottom = sceneSize.height;
  }

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}
