import { Stage, Layer } from 'react-konva';
import useImage from 'use-image';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { useStoredFloorplan } from '@/hooks/useStoredFloorplan';
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
  const { grid: floorplanGrid, imageUrl } = useStoredFloorplan();
  const [floorplanImage] = useImage(imageUrl);

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
      <Layer name="bottom-layer" />
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
