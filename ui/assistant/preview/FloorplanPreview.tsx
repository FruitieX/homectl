import { MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AssistantPlan } from '@/bindings/AssistantPlan';
import { useImageState } from '@/hooks/useImageState';
import { useAllFloorplans } from '@/hooks/useStoredFloorplan';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { useDevicesByKeysState, useGroupsState } from '@/hooks/websocket';
import {
  collectChangedDeviceKeys,
  collectChangedGroupIds,
  operationTarget,
} from '@/lib/assistant-diff';
import { buildFloorplanScene } from '@/lib/floorplan-scene';
import { PixiFloorplanRenderer } from '@/ui/floorplan';
import { Badge } from '@/ui/primitives/badge';
import { excludeUndefined } from 'utils/excludeUndefined';

import { AssistantEntityIcon } from '../AttachmentChip';

function AffectedEntityList({ plan }: { plan: AssistantPlan }) {
  const changedDeviceKeys = collectChangedDeviceKeys(plan.operations);
  const changedGroupIds = collectChangedGroupIds(plan.operations);
  const targets = plan.operations
    .map((operation) => operationTarget(operation))
    .filter((target): target is NonNullable<typeof target> => target !== null);
  const seen = new Set(targets.map((target) => `${target.kind}:${target.id}`));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {targets.map((target) => (
        <Badge
          key={`${target.kind}:${target.id}`}
          variant="muted"
          className="gap-1.5 font-medium"
        >
          <AssistantEntityIcon kind={target.kind} />
          {target.label}
        </Badge>
      ))}
      {changedGroupIds
        .filter((id) => !seen.has(`group:${id}`))
        .map((id) => (
          <Badge key={`group:${id}`} variant="muted" className="gap-1.5">
            <AssistantEntityIcon kind="group" />
            {id}
          </Badge>
        ))}
      {changedDeviceKeys
        .filter((key) => !seen.has(`device:${key}`))
        .map((key) => (
          <Badge key={`device:${key}`} variant="muted" className="gap-1.5">
            <AssistantEntityIcon kind="device" />
            {key}
          </Badge>
        ))}
    </div>
  );
}

/**
 * Static floorplan preview for a plan. The renderer reuses the live map
 * pipeline; devices referenced by the plan are highlighted through the
 * existing selection styling. Floorplan operations only change metadata in v1,
 * so layout edits are not visualized.
 */
export function FloorplanPreview({ plan }: { plan: AssistantPlan }) {
  const { floorplans } = useAllFloorplans();
  const groups = useGroupsState();
  const { data: displayNames } = useDeviceDisplayNames();
  const [unavailable, setUnavailable] = useState(false);

  const changedDeviceKeys = useMemo(
    () => collectChangedDeviceKeys(plan.operations),
    [plan.operations],
  );

  const selectedFloorplan = useMemo(() => {
    if (floorplans.length === 0) {
      return null;
    }
    let best = floorplans[0];
    let bestScore = -1;
    for (const floorplan of floorplans) {
      const placed = new Set(
        floorplan.grid?.devices.map((device) => device.deviceKey) ?? [],
      );
      const score = changedDeviceKeys.filter((key) => placed.has(key)).length;
      if (score > bestScore) {
        bestScore = score;
        best = floorplan;
      }
    }
    return best;
  }, [floorplans, changedDeviceKeys]);

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

  const canRender =
    !unavailable &&
    selectedFloorplan !== null &&
    selectedFloorplan.grid !== null &&
    scene.width > 0 &&
    scene.height > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5" />
        <span>
          {canRender
            ? `Static preview · highlighted devices are referenced by this plan${selectedFloorplan ? ` · ${selectedFloorplan.name}` : ''}`
            : 'Floorplan renderer unavailable for this plan; showing affected entities instead.'}
        </span>
      </div>
      {canRender && selectedFloorplan ? (
        <div className="h-56 overflow-hidden rounded-2xl border border-border bg-muted/20">
          <PixiFloorplanRenderer
            key={selectedFloorplan.id}
            scene={scene}
            className="size-full"
            fitOnResize
            interactive={false}
            renderLabels
            selectedDeviceKeys={changedDeviceKeys}
            onUnavailable={() => setUnavailable(true)}
          />
        </div>
      ) : null}
      <AffectedEntityList plan={plan} />
      <p className="text-[0.7rem] text-muted-foreground">
        Floorplan operations only change name and metadata, so layout edits are
        not drawn here.
      </p>
    </div>
  );
}
