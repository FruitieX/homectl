import { Stage, Layer, Image } from 'react-konva';
import useImage from 'use-image';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { ViewportDevice } from '@/ui/ViewportDevice';
import Color from 'color';

const scale = { x: 0.06, y: 0.06 };

const Floorplan = () => {
  const [image] = useImage('/floorplan.svg');
  return <Image image={image} />;
};

type Props = {
  devices: Device[];
  overrideColor?: Color;
};

export const Preview = (props: Props) => {
  console.log(props);
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

        {props.devices.map((device) => (
          <ViewportDevice
            key={getDeviceKey(device)}
            device={device}
            selected={false}
            interactive={false}
            overrideColor={props.overrideColor}
          />
        ))}
      </Layer>
    </Stage>
  );
};

export default Preview;
