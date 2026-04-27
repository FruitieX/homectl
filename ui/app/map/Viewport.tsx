import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import {
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
  useFloorplans,
} from '@/hooks/useConfig';
import { Stage, Layer } from 'react-konva';
import { useImageState } from '@/hooks/useImageState';
import { Device } from '@/bindings/Device';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResizeObserver } from 'usehooks-ts';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { ViewportSensor } from '@/ui/ViewportSensor';
import { konvaStageMultiTouchScale } from '@/lib/konvaStageMultiTouchScale';
import {
  useSelectedDevices,
  useToggleSelectedDevice,
} from '@/hooks/selectedDevices';
import { ViewportGroup } from '@/ui/ViewportGroup';
import { SensorActionModal } from '@/ui/SensorActionModal';
import { useStoredFloorplan } from '@/hooks/useStoredFloorplan';
import {
  FloorplanBackground,
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/ui/FloorplanBackground';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { getSensorConfigRef } from '@/lib/sensorInteraction';
import { excludeUndefined } from 'utils/excludeUndefined';
import { buildFloorplanScene } from '@/lib/floorplan-scene';
import { PixiFloorplanRenderer } from '@/ui/floorplan';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { Label } from '@/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';

const scalePaddingFactor = 0.6;
const fallbackFloorplanWidth = 1500;
const fallbackFloorplanHeight = 1200;
type RendererMode = 'webgl' | 'classic';

export const Viewport = () => {
  const liveDevices = useDevicesState();
  const liveGroups = useGroupsState();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const { data: deviceSensorConfigs } = useDeviceSensorConfigs();
  const { data: floorplans } = useFloorplans();
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(
    null,
  );
  const [rendererMode, setRendererMode] = useState<RendererMode>('webgl');
  const [pixiFallbackReason, setPixiFallbackReason] = useState<string | null>(
    null,
  );
  const { grid: floorplanGrid, imageUrl } = useStoredFloorplan(
    selectedFloorplanId ?? undefined,
  );
  const floorplanImage = useImageState(imageUrl);

  const allDevices: Device[] = Object.values(
    excludeUndefined(liveDevices ?? undefined),
  );
  const controllableDevices = useMemo(
    () => allDevices.filter((d) => 'Controllable' in d.data),
    [allDevices],
  );
  const sensorDevices = useMemo(
    () => allDevices.filter((d) => 'Sensor' in d.data),
    [allDevices],
  );
  const groups = excludeUndefined(liveGroups ?? undefined);
  const groupMasks = floorplanGrid?.groups ?? {};
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
  const floorplanScene = buildFloorplanScene({
    grid: floorplanGrid,
    image: floorplanImage,
    devices: allDevices,
    groups,
    displayNames: deviceDisplayNameMap,
  });
  const deviceSensorConfigMap = Object.fromEntries(
    deviceSensorConfigs.map((row) => [row.device_ref, row]),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useResizeObserver({
    // @ts-expect-error: I'm literally doing what the docs say
    ref: containerRef,
  });

  const touchRegistersAsTap = useRef(true);
  const deviceTouchTimer = useRef<NodeJS.Timeout | null>(null);
  const [selectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();
  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();
  const [activeSensorKey, setActiveSensorKey] = useState<string | null>(null);

  useEffect(() => {
    if (floorplans.length === 0) {
      setSelectedFloorplanId(null);
      return;
    }

    if (
      !selectedFloorplanId ||
      !floorplans.some((floorplan) => floorplan.id === selectedFloorplanId)
    ) {
      setSelectedFloorplanId(floorplans[0].id);
    }
  }, [floorplans, selectedFloorplanId]);

  const onDragStart = useCallback(() => {
    if (deviceTouchTimer.current !== null) {
      clearTimeout(deviceTouchTimer.current);
      deviceTouchTimer.current = null;
    }

    touchRegistersAsTap.current = false;
  }, []);

  const [initialScale, setInitialScale] = useState<
    { x: number; y: number } | undefined
  >();

  useEffect(() => {
    if (width && height) {
      const metrics = getFloorplanRenderMetrics(floorplanGrid, floorplanImage);
      const floorplanWidth = metrics.width || fallbackFloorplanWidth;
      const floorplanHeight = metrics.height || fallbackFloorplanHeight;
      const scale =
        scalePaddingFactor *
        Math.min(width / floorplanWidth, height / floorplanHeight);
      setInitialScale({ x: scale, y: scale });
    }
  }, [floorplanGrid, floorplanImage, width, height]);

  const floorplanMetrics = useMemo(
    () => getFloorplanRenderMetrics(floorplanGrid, floorplanImage),
    [floorplanGrid, floorplanImage],
  );

  const floorplanWidth = floorplanMetrics.width || fallbackFloorplanWidth;
  const floorplanHeight = floorplanMetrics.height || fallbackFloorplanHeight;
  const floorplanDeviceScale = floorplanGrid?.deviceScale ?? 1;
  const floorplanDevicePositions = useMemo(
    () => getFloorplanDevicePositions(floorplanGrid, floorplanMetrics),
    [floorplanGrid, floorplanMetrics],
  );

  const getViewportDevicePlacement = useCallback(
    (deviceKey: string) => {
      const floorplanPosition = floorplanDevicePositions[deviceKey];
      if (!floorplanPosition) {
        return null;
      }

      return {
        position: floorplanPosition,
        scale: floorplanDeviceScale,
      };
    },
    [floorplanDevicePositions, floorplanDeviceScale],
  );

  const sortedGroups = Object.entries(groups)
    .filter(
      ([groupId, group]) =>
        !group.hidden && (groupMasks[groupId]?.length ?? 0) > 0,
    )
    .sort(([leftId, leftGroup], [rightId, rightGroup]) => {
      const sizeDelta =
        (groupMasks[rightId]?.length ?? 0) - (groupMasks[leftId]?.length ?? 0);
      if (sizeDelta !== 0) {
        return sizeDelta;
      }
      return leftGroup.name.localeCompare(rightGroup.name);
    });

  const activeSensor =
    activeSensorKey === null
      ? null
      : (allDevices.find(
          (device) => getDeviceKey(device) === activeSensorKey,
        ) ?? null);

  const webglRendererActive =
    rendererMode === 'webgl' &&
    floorplanScene.width > 0 &&
    floorplanScene.height > 0;

  const openDeviceModal = (deviceKeys: string[]) => {
    if (deviceKeys.length === 0) {
      return;
    }

    setDeviceModalState(deviceKeys);
    setDeviceModalOpen(true);
  };

  const toggleGroupDevices = (groupId: string) => {
    const group = groups[groupId];
    if (!group) {
      return;
    }

    const selectedGroupDevices = selectedDevices.filter((deviceKey) =>
      group.device_keys.includes(deviceKey),
    );
    const isSelected = selectedGroupDevices.length > 0;

    for (const deviceKey of group.device_keys) {
      toggleSelectedDevice(deviceKey, isSelected);
    }
  };

  const handlePixiDevicePress = (deviceKey: string) => {
    if (selectedDevices.length === 0) {
      openDeviceModal([deviceKey]);
      return;
    }

    toggleSelectedDevice(deviceKey);
  };

  const handlePixiGroupPress = (groupId: string) => {
    const group = groups[groupId];
    if (!group) {
      return;
    }

    if (selectedDevices.length === 0) {
      openDeviceModal(group.device_keys);
      return;
    }

    toggleGroupDevices(groupId);
  };

  const handleRendererModeChange = (value: string) => {
    const nextMode: RendererMode = value === 'classic' ? 'classic' : 'webgl';
    setRendererMode(nextMode);

    if (nextMode === 'webgl') {
      setPixiFallbackReason(null);
    }
  };

  return (
    <div ref={containerRef} className="absolute left-0 top-0 h-full w-full">
      {floorplans.length > 0 && (
        <div className="absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 rounded-3xl border border-border/70 bg-card/90 p-3 text-card-foreground shadow-xl backdrop-blur-xl sm:left-4 sm:right-auto sm:w-md">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Floorplan
              </Label>
              <Select
                value={selectedFloorplanId ?? ''}
                onValueChange={(value) => setSelectedFloorplanId(value || null)}
              >
                <SelectTrigger className="h-9 rounded-2xl bg-background/80">
                  <SelectValue placeholder="Choose floorplan" />
                </SelectTrigger>
                <SelectContent>
                  {floorplans.map((floorplan) => (
                    <SelectItem key={floorplan.id} value={floorplan.id}>
                      {floorplan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Renderer
              </Label>
              <Select
                value={rendererMode}
                onValueChange={handleRendererModeChange}
              >
                <SelectTrigger className="h-9 rounded-2xl bg-background/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webgl">WebGL</SelectItem>
                  <SelectItem value="classic">Classic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {pixiFallbackReason && (
            <p className="mt-2 text-xs text-muted-foreground">
              {pixiFallbackReason}
            </p>
          )}
        </div>
      )}

      {webglRendererActive ? (
        <PixiFloorplanRenderer
          key={selectedFloorplanId ?? 'default'}
          scene={floorplanScene}
          selectedDeviceKeys={selectedDevices}
          onDevicePress={handlePixiDevicePress}
          onDeviceLongPress={toggleSelectedDevice}
          onSensorPress={setActiveSensorKey}
          onGroupPress={handlePixiGroupPress}
          onGroupLongPress={toggleGroupDevices}
          onUnavailable={() => {
            setPixiFallbackReason(
              'WebGL renderer unavailable; using classic renderer.',
            );
            setRendererMode('classic');
          }}
        />
      ) : initialScale && height && width ? (
        <Stage
          width={width}
          height={height}
          scale={initialScale}
          offsetX={floorplanWidth / 2 + (width * -0.5) / initialScale.y}
          offsetY={floorplanHeight / 2 + (height * -0.5) / initialScale.y}
          draggable
          onDragStart={onDragStart}
          ref={(stage) => {
            if (stage !== null) {
              konvaStageMultiTouchScale(stage, onDragStart);
            }
          }}
        >
          <Layer name="bottom-layer" />
          <Layer>
            <FloorplanBackground grid={floorplanGrid} image={floorplanImage} />

            {sortedGroups.map(([groupId, group]) => {
              return (
                <ViewportGroup
                  key={groupId}
                  groupId={groupId}
                  group={group}
                  cells={groupMasks[groupId] ?? []}
                  tileWidth={floorplanMetrics.tileWidth}
                  tileHeight={floorplanMetrics.tileHeight}
                  touchRegistersAsTap={touchRegistersAsTap}
                  deviceTouchTimer={deviceTouchTimer}
                />
              );
            })}

            {controllableDevices.map((device) => {
              const placement = getViewportDevicePlacement(
                getDeviceKey(device),
              );
              if (!placement) return null;
              return (
                <ViewportDevice
                  key={getDeviceKey(device)}
                  device={device}
                  position={placement.position}
                  scale={placement.scale}
                  touchRegistersAsTap={touchRegistersAsTap}
                  deviceTouchTimer={deviceTouchTimer}
                  selected={
                    selectedDevices.find(
                      (deviceKey) => deviceKey === getDeviceKey(device),
                    ) !== undefined
                  }
                  interactive
                />
              );
            })}

            {sensorDevices.map((device) => {
              const placement = getViewportDevicePlacement(
                getDeviceKey(device),
              );
              if (!placement) return null;
              return (
                <ViewportSensor
                  key={getDeviceKey(device)}
                  device={device}
                  label={getDeviceDisplayLabel(device, deviceDisplayNameMap)}
                  position={placement.position}
                  scale={placement.scale}
                  onOpenActions={(sensor) =>
                    setActiveSensorKey(getDeviceKey(sensor))
                  }
                />
              );
            })}
          </Layer>
        </Stage>
      ) : null}

      <SensorActionModal
        device={activeSensor}
        sensorConfig={
          activeSensor === null
            ? null
            : (deviceSensorConfigMap[getSensorConfigRef(activeSensor)] ?? null)
        }
        label={
          activeSensor === null
            ? undefined
            : getDeviceDisplayLabel(activeSensor, deviceDisplayNameMap)
        }
        open={activeSensor !== null}
        onClose={() => setActiveSensorKey(null)}
      />
    </div>
  );
};

export default Viewport;
