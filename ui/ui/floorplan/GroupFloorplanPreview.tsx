import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useIntersectionObserver } from 'usehooks-ts';

import type { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { useImageState } from '@/hooks/useImageState';
import { useAllFloorplans } from '@/hooks/useStoredFloorplan';
import { useDevicesByKeysState, useGroupsState } from '@/hooks/websocket';
import { cn } from '@/lib/cn';
import { buildFloorplanScene } from '@/lib/floorplan-scene';
import {
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/lib/floorplan-metrics';
import {
  getGroupFocusBounds,
  resolveGroupDeviceKeys,
  selectGroupFloorplan,
} from '@/lib/group-floorplan-preview';
import { previewMountBudget } from '@/lib/preview-mount-budget';
import { excludeUndefined } from 'utils/excludeUndefined';

import { PixiFloorplanRenderer } from './PixiFloorplanRenderer';

type GroupFloorplanPreviewProps = {
  groupId: string;
  group?: FlattenedGroupConfig | null;
  /** Sizing/rounding for the map container; include an explicit height. */
  className?: string;
  /** Allow pan/zoom gestures inside the preview. */
  interactive?: boolean;
};

/**
 * Claims a slot in the shared preview mount budget while `active`. Once
 * claimed, the slot is kept while the budget has room even if the preview
 * scrolls away, so an already-rendered preview shows immediately when it comes
 * back into view.
 */
function usePreviewMountSlot(id: string, active: boolean, visible: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    previewMountBudget.register(id);
    return () => previewMountBudget.unregister(id);
  }, [active, id]);

  useEffect(() => {
    if (!active) {
      return;
    }

    previewMountBudget.setVisible(id, visible);
  }, [active, id, visible]);

  return useSyncExternalStore(
    previewMountBudget.subscribe,
    () => active && previewMountBudget.isMounted(id),
    () => false,
  );
}

/**
 * Zoomed floorplan preview for a room/group. Picks the floorplan the group is
 * placed on, or else the one holding the most of its (nested-resolved) devices,
 * then frames the bounding box of those placed devices. Only the group's
 * member devices are drawn; other devices on the floorplan are hidden.
 */
export function GroupFloorplanPreview({
  groupId,
  group,
  className,
  interactive = false,
}: GroupFloorplanPreviewProps) {
  const { floorplans } = useAllFloorplans();
  const groups = useGroupsState();
  const { data: displayNames } = useDeviceDisplayNames();
  const [unavailable, setUnavailable] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const previewId = useId();
  // Watch intersections over a margin wider than the viewport so a preview
  // does not flap near the fold; the mount budget decides what stays alive.
  const { ref: containerRef, isIntersecting } = useIntersectionObserver({
    rootMargin: '400px',
  });

  const groupDeviceKeys = useMemo(
    () =>
      group
        ? resolveGroupDeviceKeys(groupId, {
            ...groups,
            [groupId]: group,
          })
        : [],
    [groupId, group, groups],
  );

  const selection = useMemo(
    () => selectGroupFloorplan(groupId, groupDeviceKeys, floorplans),
    [groupId, groupDeviceKeys, floorplans],
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
  const scene = useMemo(
    () =>
      buildFloorplanScene({
        grid: selectedFloorplan?.grid ?? null,
        image,
        devices,
        groups: groups ?? {},
        displayNames: displayNameMap,
        deviceKeys: placedKeys,
      }),
    [selectedFloorplan, image, devices, groups, displayNameMap, placedKeys],
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
  const canMountRenderer = usePreviewMountSlot(
    previewId,
    canRender,
    isIntersecting,
  );

  if (!group || !canRender || !selectedFloorplan || !selection) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border bg-muted/20',
          className,
        )}
      >
        {canMountRenderer ? (
          <PixiFloorplanRenderer
            key={`${selectedFloorplan.id}:${rendererGeneration}`}
            scene={scene}
            className="size-full"
            fitOnResize
            focusBounds={focusBounds}
            interactive={interactive}
            paused={!isIntersecting}
            renderLabels
            onUnavailable={() => setUnavailable(true)}
            onContextLost={() =>
              setRendererGeneration((current) => current + 1)
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export default GroupFloorplanPreview;
