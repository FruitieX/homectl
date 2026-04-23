import { Stage, Layer } from 'react-konva';
import { useImageState } from '@/hooks/useImageState';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { useAllFloorplans } from '@/hooks/useStoredFloorplan';
import {
  FloorplanBackground,
  getFloorplanDevicePositions,
  getFloorplanRenderMetrics,
} from '@/ui/FloorplanBackground';
import Color from 'color';
import { useMemo } from 'react';

const stageWidth = 112;
const stageHeight = 96;
const previewPaddingFactor = 0.9;
const fallbackFloorplanWidth = 1500;
const fallbackFloorplanHeight = 1200;

type Props = {
  devices: Device[];
  overrideColor?: Color;
};

export const Preview = (props: Props) => {
  const { floorplans } = useAllFloorplans();

  // Pick the floorplan that places the most of this group's devices. Falls
  // back to the first floorplan if no floorplan has any of these devices
  // (e.g. brand-new group).
  const deviceKeys = useMemo(
    () => new Set(props.devices.map((device) => getDeviceKey(device))),
    [props.devices],
  );
  const selectedFloorplan = useMemo(() => {
    if (floorplans.length === 0) {
      return null;
    }

    let best = floorplans[0];
    let bestScore = -1;
    for (const floorplan of floorplans) {
      const score =
        floorplan.grid?.devices.filter((device) => deviceKeys.has(device.deviceKey)).length ?? 0;
      if (score > bestScore) {
        best = floorplan;
        bestScore = score;
      }
    }

    return best;
  }, [deviceKeys, floorplans]);

  const floorplanGrid = selectedFloorplan?.grid ?? null;
  const floorplanImage = useImageState(selectedFloorplan?.imageUrl);

  const metrics = useMemo(
    () => getFloorplanRenderMetrics(floorplanGrid, floorplanImage),
    [floorplanGrid, floorplanImage],
  );
  const floorplanWidth = metrics.width || fallbackFloorplanWidth;
  const floorplanHeight = metrics.height || fallbackFloorplanHeight;
  const floorplanDeviceScale = floorplanGrid?.deviceScale ?? 1;
  const floorplanDevicePositions = useMemo(
    () => getFloorplanDevicePositions(floorplanGrid, metrics),
    [floorplanGrid, metrics],
  );
  const scale = useMemo(() => {
    const factor =
      previewPaddingFactor * Math.min(stageWidth / floorplanWidth, stageHeight / floorplanHeight);
    return { x: factor, y: factor };
  }, [floorplanHeight, floorplanWidth]);
  const contentX = (stageWidth / scale.x - floorplanWidth) / 2;
  const contentY = (stageHeight / scale.y - floorplanHeight) / 2;

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      scale={scale}
      ref={(stage) => {
        // Disable interaction with Konva stage
        if (stage !== null) {
          stage.listening(false);
        }
      }}
    >
      <Layer name="bottom-layer" x={contentX} y={contentY} />
      <Layer x={contentX} y={contentY}>
        <FloorplanBackground grid={floorplanGrid} image={floorplanImage} />

        {props.devices.map((device) => {
          const floorplanPosition = floorplanDevicePositions[getDeviceKey(device)];
          if (!floorplanPosition) return null;
          return (
            <ViewportDevice
              key={getDeviceKey(device)}
              device={device}
              position={floorplanPosition}
              scale={floorplanDeviceScale}
              selected={false}
              interactive={false}
              overrideColor={props.overrideColor}
            />
          );
        })}
      </Layer>
    </Stage>
  );
};

export default Preview;
