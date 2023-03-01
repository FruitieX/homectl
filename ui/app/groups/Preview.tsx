import { useWebsocketState } from '@/hooks/websocket';
import { Stage, Layer, Image } from 'react-konva';
import useImage from 'use-image';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import { DevicesState } from '@/bindings/DevicesState';
import Color from 'color';

const scale = { x: 0.06, y: 0.06 };

const Floorplan = () => {
  const [image] = useImage('/floorplan.svg');
  return <Image image={image} />;
};

type Props = {
  deviceKeys: string[];
};

export const Preview = (props: Props) => {
  const state = useWebsocketState();

  const devices: Device[] = Object.values(
    state?.devices ?? ({} as DevicesState),
  );
  const filtered = devices.filter((device) =>
    props.deviceKeys.includes(getDeviceKey(device)),
  );

  return (
    <Stage
      width={112}
      height={96}
      scale={scale}
      offsetY={-120}
      ref={(stage) => {
        // Disable interaction with Konva stage
        if (stage !== null) {
          stage.listening(false);
        }
      }}
    >
      <Layer name="bottom-layer" />
      <Layer>
        <Floorplan />

        {filtered.map((device) => (
          <ViewportDevice
            key={getDeviceKey(device)}
            device={device}
            selected={false}
            interactive={false}
            overrideColor={Color({ h: 35, s: 50, v: 100 })}
          />
        ))}
      </Layer>
    </Stage>
  );
};

export default Preview;
