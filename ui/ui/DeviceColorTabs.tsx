import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { getBrightness, getColor } from '@/lib/colors';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { usePastedImage } from '@/hooks/pastedImage';
import { DeviceColorMode } from '@/ui/DeviceColorMode';
import { ColorSlider } from '@/ui/ColorSlider';
import { Input } from '@/ui/primitives/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import Circle from '@uiw/react-color-circle';
import Wheel from '@uiw/react-color-wheel';
import { getColorSync, getPaletteSync } from 'colorthief';
import type { ColorResult } from 'react-color';
import Color, { type ColorInstance } from 'color';

type Color = ColorInstance;
import { Clipboard, Dices } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ColorTabProps = {
  color: Color;
  brightness: number;
  onChange?: (color: Color, brightness: number) => void;
  onChangeComplete?: (color: Color, brightness: number) => void;
  open: boolean;
};

const colorToHsva = (color: Color) => {
  const hsva = color.hsv();
  return {
    h: hsva.hue(),
    s: hsva.saturationv(),
    v: 100,
    a: hsva.alpha(),
  };
};

const presetColors = [
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#03a9f4',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#cddc39',
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#ff5722',
  '#795548',
  '#607d8b',
].map((hex) => Color(hex).value(100).hex());

const ColorWheelTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open,
}: ColorTabProps) => {
  const wheelContainer = useRef<HTMLDivElement>(null);
  const [wheelSize, setWheelSize] = useState(0);
  const [hsva, setHsva] = useState(colorToHsva(color));
  const [bri, setBri] = useState(brightness);
  const latestColor = useRef<Color>(color);

  useEffect(() => {
    const container = wheelContainer.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setWheelSize(
        Math.max(
          0,
          Math.floor(
            Math.min(entry.contentRect.width, entry.contentRect.height),
          ),
        ),
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHsva(colorToHsva(color));
    setBri(brightness);
    latestColor.current = color;
  }, [brightness, color, open]);

  const hsvaWithBrightness = useMemo(
    () => ({ ...hsva, v: (100 + bri * 100) / 2 }),
    [bri, hsva],
  );
  const handleChange = useCallback(
    (result: ColorResult) => {
      const hsv = Color(result.rgb).hsv();
      const next = Color({ h: hsv.hue(), s: hsv.saturationv(), v: 100 });
      latestColor.current = next;
      setHsva(colorToHsva(next));
      onChange?.(next, bri);
    },
    [bri, onChange],
  );
  const handleBrightnessChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setBri(value);
      onChange?.(latestColor.current, value);
    },
    [onChange],
  );
  const complete = useCallback(
    () => onChangeComplete?.(latestColor.current, bri),
    [bri, onChangeComplete],
  );

  return (
    <>
      <div
        ref={wheelContainer}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {wheelSize > 0 && (
          <Wheel
            color={hsvaWithBrightness}
            onChange={handleChange}
            onTouchEnd={complete}
            onMouseUp={complete}
            width={wheelSize}
            height={wheelSize}
            className="mx-auto"
          />
        )}
      </div>
      <ColorSlider
        label="Brightness"
        channel="brightness"
        color={Color.hsv(hsva.h, hsva.s, 100)}
        onChange={handleBrightnessChange}
        onTouchEnd={complete}
        onMouseUp={complete}
        min={0}
        max={100}
        value={bri * 100}
      />
    </>
  );
};

const SwatchesTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open,
}: ColorTabProps) => {
  const [hex, setHex] = useState(color.value(100).hex());
  const [bri, setBri] = useState(brightness);
  const latestColor = useRef<Color>(color);

  useEffect(() => {
    setHex(color.value(100).hex());
    setBri(brightness);
    latestColor.current = color;
  }, [brightness, color, open]);
  const handleChange = useCallback(
    (result: ColorResult) => {
      const hsv = Color(result.rgb).hsv();
      const next = Color({
        h: hsv.hue(),
        s: hsv.saturationv(),
        v: latestColor.current.value(),
      });
      latestColor.current = next;
      setHex(next.value(100).hex());
      onChange?.(next, bri);
    },
    [bri, onChange],
  );
  const handleBrightnessChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setBri(value);
      onChange?.(latestColor.current, value);
    },
    [onChange],
  );
  const complete = useCallback(
    () => onChangeComplete?.(latestColor.current, bri),
    [bri, onChangeComplete],
  );

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Circle colors={presetColors} color={hex} onChange={handleChange} />
      </div>
      <ColorSlider
        label="Brightness"
        channel="brightness"
        color={Color(hex)}
        onChange={handleBrightnessChange}
        onTouchEnd={complete}
        onMouseUp={complete}
        min={0}
        max={100}
        value={bri * 100}
      />
    </>
  );
};

const SlidersTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open,
}: ColorTabProps) => {
  const [hue, setHue] = useState(color.hue());
  const [sat, setSat] = useState(color.saturationv());
  const [bri, setBri] = useState(brightness);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (inputFocused) return;
    setHue(color.hue());
    setSat(color.saturationv());
    setBri(brightness);
  }, [brightness, color, inputFocused, open]);

  const currentColor = useCallback(
    (nextHue = hue, nextSat = sat) => Color({ h: nextHue, s: nextSat, v: 100 }),
    [hue, sat],
  );
  const complete = useCallback(
    () => onChangeComplete?.(currentColor(), bri),
    [bri, currentColor, onChangeComplete],
  );
  const update = useCallback(
    (nextHue: number, nextSat: number, nextBri: number) => {
      setHue(nextHue);
      setSat(nextSat);
      setBri(nextBri);
      if (!inputFocused) onChange?.(currentColor(nextHue, nextSat), nextBri);
    },
    [currentColor, inputFocused, onChange],
  );
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        complete();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      const amount = event.shiftKey ? 10 : 1;
      const nextHue =
        event.currentTarget.name === 'hue-input'
          ? Math.max(0, Math.min(360, hue + direction * amount))
          : hue;
      const nextSat =
        event.currentTarget.name === 'sat-input'
          ? Math.max(0, Math.min(100, sat + direction * amount))
          : sat;
      const nextBri =
        event.currentTarget.name === 'bri-input'
          ? Math.max(0, Math.min(1, bri + (direction * amount) / 100))
          : bri;
      update(nextHue, nextSat, nextBri);
    },
    [bri, complete, hue, sat, update],
  );
  const input = (
    name: string,
    label: string,
    value: number,
    onChangeValue: (value: number) => void,
  ) => (
    <Input
      aria-label={label}
      name={name}
      className="ml-3 w-24"
      value={Math.round(value)}
      onChange={(event) => onChangeValue(Number(event.currentTarget.value))}
      onKeyDown={handleKeyDown}
      onFocus={() => setInputFocused(true)}
      onBlur={() => {
        setInputFocused(false);
        complete();
      }}
    />
  );

  return (
    <>
      <div className="flex items-center">
        <ColorSlider
          label="Hue"
          className="flex-1"
          channel="hue"
          color={Color.hsv(hue, sat, 100)}
          onChange={(event) =>
            update(Number(event.currentTarget.value), sat, bri)
          }
          onTouchEnd={complete}
          onMouseUp={complete}
          min={0}
          max={360}
          value={hue}
        />
        {input('hue-input', 'Hue in degrees', hue, (value) =>
          update(value, sat, bri),
        )}
      </div>
      <div className="flex items-center">
        <ColorSlider
          label="Saturation"
          className="flex-1"
          channel="saturation"
          color={Color.hsv(hue, sat, 100)}
          onChange={(event) =>
            update(hue, Number(event.currentTarget.value), bri)
          }
          onTouchEnd={complete}
          onMouseUp={complete}
          min={0}
          max={100}
          value={sat}
        />
        {input('sat-input', 'Saturation percent', sat, (value) =>
          update(hue, value, bri),
        )}
      </div>
      <div className="flex items-center">
        <ColorSlider
          label="Brightness"
          className="flex-1"
          channel="brightness"
          color={Color.hsv(hue, sat, 100)}
          onChange={(event) =>
            update(hue, sat, Number(event.currentTarget.value) / 100)
          }
          onTouchEnd={complete}
          onMouseUp={complete}
          min={0}
          max={100}
          value={bri * 100}
        />
        {input('bri-input', 'Brightness percent', bri * 100, (value) =>
          update(hue, sat, value / 100),
        )}
      </div>
    </>
  );
};

async function clipboardToImg(): Promise<HTMLImageElement | undefined> {
  const items = await navigator.clipboard.read().catch((error) => {
    console.error(error);
  });
  if (!items) return;

  for (const item of items) {
    for (const type of item.types) {
      if (!type.startsWith('image/')) continue;
      const blob = await item.getType(type);
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = window.URL.createObjectURL(blob);
      });
    }
  }
}

const ImageTab = ({
  brightness,
  color,
  devices,
  onChange,
  onApply,
  open,
}: ColorTabProps & {
  devices: Device[];
  onApply: (device: Device, color: Color, brightness: number) => void;
}) => {
  const pastedImageColors = useRef<string[]>([]);
  const [computedColors, setComputedColors] = useState<Color[]>([]);
  const [pastedImage, setPastedImage] = usePastedImage();
  const pastedImageContainer = useRef<HTMLDivElement | null>(null);
  const [hsva, setHsva] = useState(colorToHsva(color));
  const [bri, setBri] = useState(brightness);
  const [sat, setSat] = useState(0.5);

  const recomputeColors = useCallback(
    (currentBri: number | null, currentSat: number | null) => {
      const saturation = currentSat ?? sat;
      setComputedColors(
        pastedImageColors.current.map((hex) => {
          const hsv = Color(hex).hsv();
          const adjusted =
            saturation > 0.5
              ? hsv.saturate(saturation * 2 - 1)
              : hsv.desaturate(1 - saturation * 2);
          return Color({
            h: adjusted.hue(),
            s: adjusted.saturationv(),
            v: (currentBri ?? bri) * 100,
          });
        }),
      );
    },
    [bri, sat],
  );

  const handlePastedImage = useCallback(() => {
    if (!pastedImage) return;
    pastedImage.style.objectFit = 'contain';
    pastedImage.style.width = '100%';
    pastedImage.style.height = '100%';
    pastedImage.style.marginLeft = 'auto';
    pastedImage.style.marginRight = 'auto';
    pastedImageContainer.current?.replaceChildren(pastedImage);

    const dominant = getColorSync(pastedImage);
    const palette = getPaletteSync(pastedImage) ?? [];
    pastedImageColors.current = [dominant, ...palette]
      .filter((color) => color !== null)
      .map((color) => color.array())
      .map((components) => Color(components, 'rgb').value(100).hex());
    recomputeColors(null, null);
  }, [pastedImage, recomputeColors]);

  useEffect(() => {
    handlePastedImage();
  }, [handlePastedImage]);
  useEffect(() => {
    setHsva(colorToHsva(color));
    setBri(brightness);
  }, [brightness, color, open]);

  const handlePasteClick = useCallback(async () => {
    const image = await clipboardToImg();
    if (!image) return;
    setPastedImage(image);
    handlePastedImage();
  }, [handlePastedImage, setPastedImage]);
  const handleApply = useCallback(() => {
    if (!computedColors.length) return;
    devices.forEach((device, index) => {
      const next = computedColors[index % computedColors.length];
      onApply(device, next, next.value() / 100);
    });
  }, [computedColors, devices, onApply]);
  const handleChange = useCallback(
    (result: ColorResult) => {
      const hsv = Color(result.rgb).hsv();
      const next = Color({
        h: hsv.hue(),
        s: hsv.saturationv(),
        v: bri * 100,
      });
      setHsva(colorToHsva(next));
      onChange?.(next, bri);
    },
    [bri, onChange],
  );
  const handleBrightnessChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setBri(value);
      recomputeColors(value, null);
    },
    [recomputeColors],
  );
  const handleSaturationChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setSat(value);
      recomputeColors(null, value);
    },
    [recomputeColors],
  );

  return (
    <>
      <div ref={pastedImageContainer} className="min-h-0 w-full flex-1 pb-4" />
      <div className="flex w-full shrink-0 flex-wrap justify-center gap-2 [&>button]:px-2 [&>button]:text-xs">
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted"
          onClick={() => void handlePasteClick()}
        >
          <Clipboard className="size-4" />
          Paste image
        </button>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50"
          disabled={!computedColors.length}
          onClick={handleApply}
        >
          <Dices className="size-4" />
          Apply colors
        </button>
      </div>
      <Circle
        colors={computedColors.map((next) => next.hex())}
        color={hsva}
        onChange={handleChange}
        className="min-h-8 shrink-0 flex-nowrap! justify-center overflow-x-auto pt-1 *:shrink-0"
      />
      <div className="flex shrink-0 gap-2 text-xs [&>div]:min-w-0 [&>div]:flex-1">
        <ColorSlider
          label="Saturation"
          channel="saturation"
          color={Color.hsv(hsva.h, hsva.s, 100)}
          onChange={handleSaturationChange}
          min={0}
          max={100}
          value={sat * 100}
        />
        <ColorSlider
          label="Brightness"
          channel="brightness"
          color={Color.hsv(hsva.h, hsva.s, 100)}
          onChange={handleBrightnessChange}
          min={0}
          max={100}
          value={bri * 100}
        />
      </div>
    </>
  );
};

type DeviceColorTabsProps = {
  devices: Device[];
  connected: boolean;
  open?: boolean;
  onChange: (device: Device, color: Color, brightness: number) => void;
  onNativeChange: (
    device: Device,
    power: boolean,
    brightness?: number,
    color?: DeviceColor,
  ) => void;
};

/** Rich color controls shared by the floorplan and device settings views. */
export function DeviceColorTabs({
  devices,
  connected,
  open = true,
  onChange,
  onNativeChange,
}: DeviceColorTabsProps) {
  const colorDevices = devices.filter((device) => {
    if (!('Controllable' in device.data) || isDeviceReadOnly(device))
      return false;
    const capabilities = device.data.Controllable.capabilities;
    return Boolean(
      capabilities.hs || capabilities.xy || capabilities.rgb || capabilities.ct,
    );
  });
  const temperatureDevices = colorDevices.filter(
    (device) =>
      'Controllable' in device.data &&
      device.data.Controllable.capabilities.ct !== null,
  );
  const hasChromaticColor = colorDevices.some(
    (device) =>
      'Controllable' in device.data &&
      (device.data.Controllable.capabilities.hs ||
        device.data.Controllable.capabilities.xy ||
        device.data.Controllable.capabilities.rgb),
  );
  const first = colorDevices[0];
  const deviceColor = first ? getColor(first.data) : Color('black');
  const deviceBrightness = first ? getBrightness(first.data) : 1;
  const [tab, setTab] = useState(hasChromaticColor ? 'sliders' : 'temperature');
  const colorTab =
    tab === 'temperature' && temperatureDevices.length === 0
      ? hasChromaticColor
        ? 'sliders'
        : ''
      : tab;

  useEffect(() => {
    if (colorTab) return;
    setTab(hasChromaticColor ? 'sliders' : 'temperature');
  }, [colorTab, hasChromaticColor]);

  const setColor = useCallback(
    (color: Color, brightness: number) => {
      colorDevices.forEach((device) => onChange(device, color, brightness));
    },
    [colorDevices, onChange],
  );

  if (!colorDevices.length) return null;
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <Tabs value={colorTab} onValueChange={setTab} className="flex flex-col">
        <TabsList className="min-h-10 flex-nowrap! justify-start overflow-x-auto">
          {hasChromaticColor && (
            <>
              <TabsTrigger value="wheel" className="shrink-0">
                Wheel
              </TabsTrigger>
              <TabsTrigger value="swatches" className="shrink-0">
                Swatches
              </TabsTrigger>
              <TabsTrigger value="image" className="shrink-0">
                Image
              </TabsTrigger>
              <TabsTrigger value="sliders" className="shrink-0">
                Sliders
              </TabsTrigger>
            </>
          )}
          {temperatureDevices.length > 0 && (
            <TabsTrigger value="temperature" className="shrink-0">
              Temperature
            </TabsTrigger>
          )}
        </TabsList>
        <div className="mt-3 min-h-0 rounded-2xl border border-border/60 p-3">
          <TabsContent
            value="wheel"
            className="m-0 flex min-h-72 flex-col gap-3"
          >
            <ColorWheelTab
              color={deviceColor}
              brightness={deviceBrightness}
              onChange={setColor}
              onChangeComplete={setColor}
              open={open}
            />
          </TabsContent>
          <TabsContent value="swatches" className="m-0 flex min-h-72 flex-col">
            <SwatchesTab
              color={deviceColor}
              brightness={deviceBrightness}
              onChange={setColor}
              onChangeComplete={setColor}
              open={open}
            />
          </TabsContent>
          <TabsContent
            value="sliders"
            className="m-0 flex flex-col gap-3 [&_input[type=range]]:min-w-0 [&_input:not([type=range])]:w-16 [&_input:not([type=range])]:shrink-0"
          >
            <SlidersTab
              color={deviceColor}
              brightness={deviceBrightness}
              onChange={setColor}
              onChangeComplete={setColor}
              open={open}
            />
          </TabsContent>
          <TabsContent
            value="image"
            className="m-0 flex min-h-72 flex-col gap-3 overflow-y-auto"
          >
            <ImageTab
              color={deviceColor}
              brightness={deviceBrightness}
              devices={colorDevices}
              onChange={setColor}
              onApply={onChange}
              open={open}
            />
          </TabsContent>
          <TabsContent value="temperature" className="m-0">
            <DeviceColorMode
              devices={temperatureDevices}
              connected={connected}
              onChange={onNativeChange}
              temperatureOnly
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export function colorToDeviceHs(color: Color): DeviceColor {
  const hsv = color.hsv();
  return { h: Math.round(hsv.hue()), s: hsv.saturationv() / 100 };
}
