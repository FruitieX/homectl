import { useWebsocketState } from '@/hooks/websocket';
import { Stage, Layer, Image } from 'react-konva';
import useImage from 'use-image';
import { Device } from '@/bindings/Device';
import { useCallback, useRef } from 'react';
import { useElementSize } from 'usehooks-ts';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { konvaStageMultiTouchScale } from '@/lib/konvaStageMultiTouchScale';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { ViewportGroup } from '@/ui/ViewportGroup';

const scale = { x: 0.265, y: 0.265 };

const Floorplan = () => {
  const [image] = useImage('/floorplan.svg');
  return <Image image={image} />;
};

export const Viewport = () => {
  const state = useWebsocketState();

  const devices: Device[] = Object.values(state?.devices ?? {});
  const groups: FlattenedGroupsConfig = state?.groups ?? {};

  const [containerRef, { width, height }] = useElementSize();

  const touchRegistersAsTap = useRef(true);
  const deviceTouchTimer = useRef<NodeJS.Timeout | null>(null);
  const [selectedDevices] = useSelectedDevices();

  const onDragStart = useCallback(() => {
    if (deviceTouchTimer.current !== null) {
      clearTimeout(deviceTouchTimer.current);
      deviceTouchTimer.current = null;
    }

    touchRegistersAsTap.current = false;
  }, []);

  return (
    <div ref={containerRef} className="absolute left-0 top-0 h-screen w-screen">
      <Stage
        // fix for 0 dimension errors
        width={width || 1}
        height={height || 1}
        scale={scale}
        offsetY={-800}
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
          <Floorplan />

          {Object.entries(groups).map(([groupId, group]) => (
            <ViewportGroup
              key={groupId}
              groupId={groupId}
              group={group}
              touchRegistersAsTap={touchRegistersAsTap}
              deviceTouchTimer={deviceTouchTimer}
            />
          ))}

          {devices.map((device) => (
            <ViewportDevice
              key={getDeviceKey(device)}
              device={device}
              touchRegistersAsTap={touchRegistersAsTap}
              deviceTouchTimer={deviceTouchTimer}
              selected={
                selectedDevices.find(
                  (deviceKey) => deviceKey === getDeviceKey(device),
                ) !== undefined
              }
              interactive
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

export default Viewport;
