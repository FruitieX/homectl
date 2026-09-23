import { useMemo, useState } from 'react';

import type { AssistantActionChange } from '@/bindings/AssistantActionChange';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { useImageState } from '@/hooks/useImageState';
import { useAllFloorplans } from '@/hooks/useStoredFloorplan';
import { useDevicesByKeysState, useGroupsState } from '@/hooks/websocket';
import { hsToRgbBytes } from '@/lib/colorBytes';
import { cn } from '@/lib/cn';
import { buildFloorplanScene } from '@/lib/floorplan-scene';
import {
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/lib/floorplan-metrics';
import {
  getGroupFocusBounds,
  selectGroupFloorplan,
} from '@/lib/group-floorplan-preview';
import { PixiFloorplanRenderer } from '@/ui/floorplan/PixiFloorplanRenderer';
import { excludeUndefined } from 'utils/excludeUndefined';

/**
 * Floorplan preview of how the affected lights will look once the proposed
 * changes are applied: the chosen floorplan is zoomed to the changed devices
 * and their markers render with the proposed power/brightness/color.
 */
export function ActionFloorplanPreview({
  changes,
  className,
}: {
  changes: AssistantActionChange[];
  className?: string;
}) {
  const { floorplans } = useAllFloorplans();
  const groups = useGroupsState();
  const { data: displayNames } = useDeviceDisplayNames();
  const [unavailable, setUnavailable] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);

  const deviceKeys = useMemo(
    () => [...new Set(changes.map((change) => change.deviceKey))].sort(),
    [changes],
  );
  const selection = useMemo(
    () => selectGroupFloorplan('', deviceKeys, floorplans),
    [deviceKeys, floorplans],
  );
  const selectedFloorplan = selection?.floorplan ?? null;
  const placedKeys = useMemo(
    () => selection?.placedDeviceKeys ?? [],
    [selection],
  );

  const devicesByKey = useDevicesByKeysState(placedKeys);
  const devices = useMemo(
    () => Object.values(excludeUndefined(devicesByKey ?? undefined)),
    [devicesByKey],
  );
  const image = useImageState(selectedFloorplan?.imageUrl);
  const displayNameMap = useMemo(
    () =>
      Object.fromEntries(
        displayNames.map((row) => [row.device_key, row.display_name]),
      ),
    [displayNames],
  );
  const overrides = useMemo(() => {
    const map: Record<
      string,
      { power?: boolean; brightness?: number; color?: [number, number, number] }
    > = {};
    for (const change of changes) {
      map[change.deviceKey] = {
        ...(change.power === undefined ? {} : { power: change.power }),
        ...(change.brightness === undefined
          ? {}
          : { brightness: change.brightness }),
        ...(change.color === undefined ? {} : { color: hsToRgbBytes(change.color) }),
      };
    }
    return map;
  }, [changes]);
  const scene = useMemo(
    () =>
      buildFloorplanScene({
        grid: selectedFloorplan?.grid ?? null,
        image,
        devices,
        groups: groups ?? {},
        displayNames: displayNameMap,
        deviceVisualOverrides: overrides,
        deviceKeys: placedKeys,
      }),
    [
      selectedFloorplan,
      image,
      devices,
      groups,
      displayNameMap,
      overrides,
      placedKeys,
    ],
  );
  const focusBounds = useMemo(() => {
    if (!selectedFloorplan?.grid || !selection) {
      return null;
    }
    const metrics = getFloorplanRenderMetrics(selectedFloorplan.grid, image);
    const positions = getFloorplanDevicePositions(
      selectedFloorplan.grid,
      metrics,
    );
    return getGroupFocusBounds(positions, selection.placedDeviceKeys, {
      width: metrics.width,
      height: metrics.height,
    });
  }, [selectedFloorplan, selection, image]);

  const canRender =
    !unavailable &&
    selectedFloorplan !== null &&
    selectedFloorplan.grid !== null &&
    selection !== null &&
    scene.width > 0 &&
    scene.height > 0;

  if (!canRender || !selectedFloorplan || !selection) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-muted/20',
        className,
      )}
    >
      <PixiFloorplanRenderer
        key={`${selectedFloorplan.id}:${rendererGeneration}`}
        scene={scene}
        className="size-full"
        fitOnResize
        focusBounds={focusBounds}
        interactive={false}
        renderLabels
        onUnavailable={() => setUnavailable(true)}
        onContextLost={() => setRendererGeneration((current) => current + 1)}
      />
    </div>
  );
}

export default ActionFloorplanPreview;
