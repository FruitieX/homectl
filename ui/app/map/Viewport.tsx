import { useWebsocketState } from '@/hooks/websocket';
import {
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
  useFloorplans,
} from '@/hooks/useConfig';
import { Stage, Layer } from 'react-konva';
import useImage from 'use-image';
import { Device } from '@/bindings/Device';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResizeObserver } from 'usehooks-ts';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { ViewportSensor } from '@/ui/ViewportSensor';
import { konvaStageMultiTouchScale } from '@/lib/konvaStageMultiTouchScale';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { ViewportGroup } from '@/ui/ViewportGroup';
import { SensorActionModal } from '@/ui/SensorActionModal';
import { useDevicePositions } from '@/hooks/useFloorplanPositions';
import { useStoredFloorplan } from '@/hooks/useStoredFloorplan';
import {
  FloorplanBackground,
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/ui/FloorplanBackground';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { getSensorConfigRef } from '@/lib/sensorInteraction';
import { excludeUndefined } from 'utils/excludeUndefined';

const scalePaddingFactor = 0.6;
const fallbackFloorplanWidth = 1500;
const fallbackFloorplanHeight = 1200;

export const Viewport = () => {
  const state = useWebsocketState();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const { data: deviceSensorConfigs } = useDeviceSensorConfigs();
  const { data: floorplans } = useFloorplans();
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(null);
  const { grid: floorplanGrid, imageUrl } = useStoredFloorplan(selectedFloorplanId ?? undefined);
  const [floorplanImage] = useImage(imageUrl);
  const { positions: devicePositions } = useDevicePositions();

  const allDevices: Device[] = Object.values(excludeUndefined(state?.devices));
  const controllableDevices = useMemo(
    () => allDevices.filter((d) => 'Controllable' in d.data),
    [allDevices],
  );
  const sensorDevices = useMemo(
    () => allDevices.filter((d) => 'Sensor' in d.data),
    [allDevices],
  );
  const groups = excludeUndefined(state?.groups);
  const groupMasks = floorplanGrid?.groups ?? {};
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
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
  const [activeSensorKey, setActiveSensorKey] = useState<string | null>(null);

  useEffect(() => {
    if (floorplans.length === 0) {
      setSelectedFloorplanId(null);
      return;
    }

    if (!selectedFloorplanId || !floorplans.some((floorplan) => floorplan.id === selectedFloorplanId)) {
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
        scalePaddingFactor * Math.min(width / floorplanWidth, height / floorplanHeight);
      setInitialScale({ x: scale, y: scale });
    }
  }, [floorplanGrid, floorplanImage, width, height]);

  const floorplanMetrics = useMemo(
    () => getFloorplanRenderMetrics(floorplanGrid, floorplanImage),
    [floorplanGrid, floorplanImage],
  );

  const floorplanWidth = floorplanMetrics.width || fallbackFloorplanWidth;
  const floorplanHeight = floorplanMetrics.height || fallbackFloorplanHeight;
  const floorplanDevicePositions = useMemo(
    () => getFloorplanDevicePositions(floorplanGrid, floorplanMetrics),
    [floorplanGrid, floorplanMetrics],
  );

  const getViewportDevicePosition = useCallback(
    (deviceKey: string) => {
      const floorplanPosition = floorplanDevicePositions[deviceKey];
      if (floorplanPosition) {
        return floorplanPosition;
      }

      const legacyPosition = devicePositions[deviceKey];
      if (!legacyPosition) {
        return null;
      }

      return { x: legacyPosition.x, y: legacyPosition.y };
    },
    [devicePositions, floorplanDevicePositions],
  );

  const sortedGroups = Object.entries(groups)
    .filter(
      ([groupId, group]) => !group.hidden && (groupMasks[groupId]?.length ?? 0) > 0,
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
      : allDevices.find((device) => getDeviceKey(device) === activeSensorKey) ?? null;

  return (
    <div ref={containerRef} className="absolute left-0 top-0 h-full w-full">
      {floorplans.length > 0 && (
        <div className="absolute left-4 top-4 z-10 rounded-box bg-base-100/90 p-3 shadow-lg backdrop-blur">
          <label className="form-control w-52">
            <span className="label-text text-xs uppercase opacity-60">Floorplan</span>
            <select
              className="select select-bordered select-sm"
              value={selectedFloorplanId ?? ''}
              onChange={(e) => setSelectedFloorplanId(e.target.value || null)}
            >
              {floorplans.map((floorplan) => (
                <option key={floorplan.id} value={floorplan.id}>
                  {floorplan.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {initialScale && height && width && (
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
              const pos = getViewportDevicePosition(getDeviceKey(device));
              if (!pos) return null;
              return (
                <ViewportDevice
                  key={getDeviceKey(device)}
                  device={device}
                  position={{ x: pos.x, y: pos.y }}
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
              const pos = getViewportDevicePosition(getDeviceKey(device));
              if (!pos) return null;
              return (
                <ViewportSensor
                  key={getDeviceKey(device)}
                  device={device}
                  label={getDeviceDisplayLabel(device, deviceDisplayNameMap)}
                  position={{ x: pos.x, y: pos.y }}
                  onOpenActions={(sensor) => setActiveSensorKey(getDeviceKey(sensor))}
                />
              );
            })}
          </Layer>
        </Stage>
      )}

      <SensorActionModal
        device={activeSensor}
        sensorConfig={
          activeSensor === null
            ? null
            : deviceSensorConfigMap[getSensorConfigRef(activeSensor)] ?? null
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
