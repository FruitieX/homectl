import { useWebsocketState } from '@/hooks/websocket';
import { Stage, Layer, Image } from 'react-konva';
import useImage from 'use-image';
import { Device } from '@/bindings/Device';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useResizeObserver } from 'usehooks-ts';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { konvaStageMultiTouchScale } from '@/lib/konvaStageMultiTouchScale';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { groupRects, ViewportGroup } from '@/ui/ViewportGroup';
import { excludeUndefined } from 'utils/excludeUndefined';

const scaleFactor = 0.39;

const Floorplan = () => {
  const [image] = useImage('/floorplan.svg');
  return <Image image={image} />;
};

export const Viewport = () => {
  const state = useWebsocketState();

  const devices: Device[] = Object.values(excludeUndefined(state?.devices));
  const groups = excludeUndefined(state?.groups);

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useResizeObserver({
    // @ts-expect-error: I'm literally doing what the docs say
    ref: containerRef,
  });

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

  const [initialScale, setInitialScale] = useState<
    { x: number; y: number } | undefined
  >();

  useEffect(() => {
    if (width && height) {
      const scale = scaleFactor * Math.min(width / 600, height / 800);
      setInitialScale({ x: scale, y: scale });
    }
  }, [width, height]);

  const sortedGroups = Object.entries(groups);
  sortedGroups.sort(([, a], [, b]) => {
    const groupRectA = groupRects[a.name];
    const groupRectB = groupRects[b.name];

    if (!groupRectA) {
      return 1;
    }
    if (!groupRectB) {
      return -1;
    }

    return (groupRectA.zIndex ?? 0) - (groupRectB.zIndex ?? 0);
  });

  return (
    <div ref={containerRef} className="absolute left-0 top-0 h-full w-full">
      {initialScale && height && width && (
        <Stage
          width={width}
          height={height}
          scale={initialScale}
          offsetX={750 + (width * -0.5) / initialScale.y}
          offsetY={600 + (height * -0.5) / initialScale.y}
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

            {sortedGroups.map(([groupId, group]) => (
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
      )}
    </div>
  );
};

export default Viewport;
