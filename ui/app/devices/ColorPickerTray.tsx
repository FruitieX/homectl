import { Device } from '@/bindings/Device';
import { useActiveColor } from '@/hooks/activeColor';
import { useWebsocketState } from '@/hooks/websocket';
import { getColor } from '@/lib/colors';
import clsx from 'clsx';
import { uniqBy } from 'lodash';

export const ColorPickerTray = () => {
  const state = useWebsocketState();
  const [activeColor, setActiveColor] = useActiveColor();

  const devices: Device[] = Object.values(state?.devices ?? {});

  const colors = uniqBy(
    devices.map((device) => {
      const color = getColor(device.state);
      return color;
    }),
    (color) => color.hsl().string(),
  );

  return (
    <div className="flex h-12 flex-shrink-0 gap-4 overflow-x-auto overflow-y-hidden p-2">
      {colors.map((color) => (
        <div
          key={color.hsl().string()}
          style={{ backgroundColor: color.hsl().string() }}
          className={clsx([
            'h-9 w-9 flex-shrink-0 rounded-full shadow outline',
            activeColor === color
              ? 'outline-4 outline-white'
              : 'outline-2 outline-black',
          ])}
          onClick={() => setActiveColor(color)}
        ></div>
      ))}
    </div>
  );
};
