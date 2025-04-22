import { Device } from '@/bindings/Device';
import { useActiveColor } from '@/hooks/activeColor';
import { useWebsocketState } from '@/hooks/websocket';
import { getColor } from '@/lib/colors';
import clsx from 'clsx';
import Color from 'color';
import { uniqBy } from 'lodash';
import { excludeUndefined } from 'utils/excludeUndefined';

export const ColorPickerTray = () => {
  const state = useWebsocketState();
  const [activeColor, setActiveColor] = useActiveColor();

  const devices: Device[] = Object.values(excludeUndefined(state?.devices));

  const colors = uniqBy(
    devices.map((device) => {
      const color = getColor(device.data);
      return color;
    }),
    (color) => color.hsl().string(),
  );

  const handleClick = (color: Color) => () => {
    if (activeColor?.hsl().string() === color.hsl().string()) {
      setActiveColor(null);
    } else {
      setActiveColor(color);
    }
  };

  return (
    <div className="flex h-12 shrink-0 gap-4 overflow-x-auto overflow-y-hidden p-2">
      {colors.map((color) => (
        <div
          key={color.hsl().string()}
          style={{ backgroundColor: color.hsl().string() }}
          className={clsx([
            'h-9 w-9 shrink-0 rounded-full shadow-sm outline transition-all',
            activeColor?.hsl().string() === color.hsl().string()
              ? 'outline-4 outline-white'
              : 'outline-2 outline-black',
          ])}
          onClick={handleClick(color)}
        ></div>
      ))}
    </div>
  );
};
