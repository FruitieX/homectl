import { MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { excludeUndefined } from 'utils/excludeUndefined';

import { PixiFloorplanRenderer } from './PixiFloorplanRenderer';

type GroupFloorplanPreviewProps = {
  groupId: string;
  group?: FlattenedGroupConfig | null;
  /** Sizing/rounding for the map container; include an explicit height. */
  className?: string;
  /** Render an explanatory caption above the map. */
  showCaption?: boolean;
  /** Allow pan/zoom gestures inside the preview. */
  interactive?: boolean;
};

/**
 * Zoomed floorplan preview for a room/group. Picks the floorplan the group is
 * placed on, or else the one holding the most of its (nested-resolved) devices,
 * then frames the bounding box of those placed devices.
 */
export function GroupFloorplanPreview({
  groupId,
  group,
  className,
  showCaption = false,
  interactive = false,
}: GroupFloorplanPreviewProps) {
  const { floorplans } = useAllFloorplans();
  const groups = useGroupsState();
  const { data: displayNames } = useDeviceDisplayNames();
  const [unavailable, setUnavailable] = useState(false);
  // Mount the Pixi app only while near the viewport so a long rooms list
  // never keeps dozens of WebGL contexts alive at once.
  const { ref: containerRef, isIntersecting } = useIntersectionObserver({
    rootMargin: '200px',
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
    () =>
      selectedFloorplan?.grid?.devices.map((device) => device.deviceKey) ?? [],
    [selectedFloorplan],
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
      }),
    [selectedFloorplan, image, devices, groups, displayNameMap],
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

  if (!group || !canRender || !selectedFloorplan || !selection) {
    return null;
  }

  return (
    <div className="space-y-2">
      {showCaption ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-3.5" />
          <span>
            Zoomed to this room&rsquo;s devices · {selectedFloorplan.name}
          </span>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border bg-muted/20',
          className,
        )}
      >
        {isIntersecting ? (
          <PixiFloorplanRenderer
            key={selectedFloorplan.id}
            scene={scene}
            className="size-full"
            fitOnResize
            focusBounds={focusBounds}
            interactive={interactive}
            renderLabels
            selectedDeviceKeys={groupDeviceKeys}
            onUnavailable={() => setUnavailable(true)}
          />
        ) : null}
      </div>
    </div>
  );
}

export default GroupFloorplanPreview;
