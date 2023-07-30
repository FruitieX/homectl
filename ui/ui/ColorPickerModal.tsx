'use client';

import { Button, Input, Modal, Range, Tabs, Toggle } from 'react-daisyui';
import { ColorResult } from 'react-color';
import Wheel from '@uiw/react-color-wheel';
import Circle from '@uiw/react-color-circle';
import Color from 'color';
import ColorThief from 'colorthief';
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { black, getBrightness, getColor, getPower } from '@/lib/colors';
import { useThrottleCallback } from '@react-hook/throttle';
import { useSetDeviceColor } from '@/hooks/useSetDeviceColor';
import { useWebsocketState } from '@/hooks/websocket';
import { findDevice } from '@/lib/device';
import { Clipboard, X, Dices } from 'lucide-react';
import { useSetDevicePower } from '@/hooks/useSetDevicePower';
import { usePastedImage } from '@/hooks/pastedImage';
import { SceneList } from 'app/groups/[id]/SceneList';

const colorToHsva = (color: Color) => {
  const hsva = color.hsv();
  return {
    h: hsva.hue(),
    s: hsva.saturationv(),
    v: 100,
    a: hsva.alpha(),
  };
};

const setMaxColorValue = (color: Color): Color => color.value(100);
type TabProps = {
  color: Color;
  brightness: number;
  onChange?: (color: Color, brightness: number) => void;
  onChangeComplete?: (color: Color, brightness: number) => void;
  open: boolean;
};

const ColorWheelTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open,
}: TabProps) => {
  const [hsva, setHsva] = useState(colorToHsva(color));
  const [bri, setBri] = useState(brightness);

  const hsvaWithMaxValue = useMemo(() => {
    const result = { ...hsva };
    // Limit range to [50, 100]
    result.v = (100 + bri * 100) / 2;
    return result;
  }, [bri, hsva]);

  useEffect(() => {
    setHsva(colorToHsva(color));
    setBri(brightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const latestColor = useRef<Color>(color);
  useEffect(() => {
    latestColor.current = color;
  }, [color]);

  const handleChange = useCallback(
    (result: ColorResult) => {
      const hsv = Color(result.rgb).hsv();
      const color = Color({
        h: hsv.hue(),
        s: hsv.saturationv(),
        v: 100,
      });
      latestColor.current = color;
      setHsva(colorToHsva(color));
      onChange && onChange(color, bri);
    },
    [bri, onChange],
  );

  const handleChangeComplete = useCallback(() => {
    onChangeComplete && onChangeComplete(latestColor.current, bri);
  }, [bri, onChangeComplete]);

  const handleBrightnessChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setBri(value);
      onChange && onChange(latestColor.current, value);
    },
    [onChange],
  );

  return (
    <>
      <div className="flex-1">
        <Wheel
          color={hsvaWithMaxValue}
          onChange={handleChange}
          onTouchEnd={handleChangeComplete}
          onMouseUp={handleChangeComplete}
          width={300}
          height={300}
          className="mx-auto"
        />
      </div>
      <Range
        className="mt-6"
        size="lg"
        onChange={handleBrightnessChange}
        onTouchEnd={handleChangeComplete}
        onMouseUp={handleChangeComplete}
        min={0}
        max={100}
        value={bri * 100}
      />
    </>
  );
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
]
  .map((hex) => Color(hex, 'rgb'))
  .map(setMaxColorValue)
  .map((color) => color.hex());

const SwatchesTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open,
}: TabProps) => {
  const [hex, setHex] = useState(color.value(100).hex());
  const [bri, setBri] = useState(brightness);

  useEffect(() => {
    setHex(color.value(100).hex());
    setBri(brightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const latestColor = useRef<Color>(color);
  useEffect(() => {
    latestColor.current = color;
  }, [color]);

  const handleChange = useCallback(
    (result: ColorResult) => {
      const hsv = Color(result.rgb).hsv();
      const color = Color({
        h: hsv.hue(),
        s: hsv.saturationv(),
        v: latestColor.current.value(),
      });
      latestColor.current = color;
      setHex(color.value(100).hex());
      onChange && onChange(color, bri);
    },
    [bri, onChange],
  );

  const handleChangeComplete = useCallback(() => {
    onChangeComplete && onChangeComplete(latestColor.current, bri);
  }, [bri, onChangeComplete]);

  const handleBrightnessChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setBri(value);
      onChange && onChange(latestColor.current, value);
    },
    [onChange],
  );

  return (
    <>
      <div className="flex-1 overflow-y-auto p-3">
        <Circle
          colors={presetColors}
          color={hex}
          onChange={handleChange}
          className="flex-1"
        />
      </div>
      <Range
        className="mt-6"
        size="lg"
        onChange={handleBrightnessChange}
        onTouchEnd={handleChangeComplete}
        onMouseUp={handleChangeComplete}
        min={0}
        max={100}
        value={bri * 100}
      />
    </>
  );
};

async function clipboardToImg(): Promise<HTMLImageElement | undefined> {
  const items = await navigator.clipboard.read().catch((err) => {
    console.error(err);
  });

  if (!items) return;

  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith('image/')) {
        const blob = await item.getType(type);
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = window.URL.createObjectURL(blob);
        });
      }
    }
  }
}

const SlidersTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open,
}: TabProps) => {
  const [hue, setHue] = useState(color.hue());
  const [sat, setSat] = useState(color.saturationv());
  const [bri, setBri] = useState(brightness);

  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (inputFocused) return;

    setHue(color.hue());
    setSat(color.saturationv());
    setBri(brightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleChangeComplete = useCallback(() => {
    const color = Color({
      h: hue,
      s: sat,
      v: 100,
    });

    onChangeComplete && onChangeComplete(color, bri);
  }, [bri, hue, onChangeComplete, sat]);

  const handleHueChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const hue = Number(event.currentTarget.value);
      setHue(hue);

      if (inputFocused) return;

      const color = Color({
        h: hue,
        s: sat,
        v: 100,
      });

      onChange && onChange(color, bri);
    },
    [bri, inputFocused, onChange, sat],
  );

  const handleSatChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const sat = Number(event.currentTarget.value);
      setSat(sat);

      if (inputFocused) return;

      const color = Color({
        h: hue,
        s: sat,
        v: 100,
      });

      onChange && onChange(color, bri);
    },
    [bri, hue, inputFocused, onChange],
  );

  const handleBriChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const bri = Number(event.currentTarget.value) / 100;
      setBri(bri);

      if (inputFocused) return;

      const color = Color({
        h: hue,
        s: sat,
        v: 100,
      });

      onChange && onChange(color, bri);
    },
    [hue, inputFocused, onChange, sat],
  );

  const focusInput = useCallback(() => {
    setInputFocused(true);
  }, []);

  const blurInput = useCallback(() => {
    setInputFocused(false);
    handleChangeComplete();
  }, [handleChangeComplete]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        handleChangeComplete();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        let modifier = event.key === 'ArrowUp' ? 1 : -1;
        if (event.shiftKey) modifier *= 10;
        let newHue = hue;
        let newSat = sat;
        let newBri = bri;

        if (event.currentTarget.name === 'hue-input') {
          newHue = Math.max(Math.min(hue + modifier, 360), 0);
          setHue(newHue);
        } else if (event.currentTarget.name === 'sat-input') {
          newSat = Math.max(Math.min(sat + modifier, 100), 0);
          setSat(newSat);
        } else if (event.currentTarget.name === 'bri-input') {
          newBri = Math.max(Math.min(bri + modifier / 100, 1), 0);
          setBri(newBri);
        }

        const color = Color({
          h: newHue,
          s: newSat,
          v: 100,
        });

        onChange && onChange(color, newBri);
      }
    },
    [bri, handleChangeComplete, hue, onChange, sat],
  );

  return (
    <>
      Hue:
      <div className="flex items-center">
        <Range
          size="lg"
          onChange={handleHueChange}
          onTouchEnd={handleChangeComplete}
          onMouseUp={handleChangeComplete}
          min={0}
          max={360}
          value={hue}
        />
        <Input
          name="hue-input"
          className="ml-3 w-24"
          value={Math.round(hue)}
          onChange={handleHueChange}
          onKeyDown={handleKeyDown}
          onFocus={focusInput}
          onBlur={blurInput}
        />
      </div>
      Saturation:
      <div className="flex items-center">
        <Range
          size="lg"
          onChange={handleSatChange}
          onTouchEnd={handleChangeComplete}
          onMouseUp={handleChangeComplete}
          min={0}
          max={100}
          value={sat}
        />
        <Input
          name="sat-input"
          className="ml-3 w-24"
          value={Math.round(sat)}
          onChange={handleSatChange}
          onKeyDown={handleKeyDown}
          onFocus={focusInput}
          onBlur={blurInput}
        />
      </div>
      Brightness:
      <div className="flex items-center">
        <Range
          size="lg"
          onChange={handleBriChange}
          onTouchEnd={handleChangeComplete}
          onMouseUp={handleChangeComplete}
          min={0}
          max={100}
          value={bri * 100}
        />
        <Input
          name="bri-input"
          className="ml-3 w-24"
          value={Math.round(bri * 100)}
          onChange={handleBriChange}
          onKeyDown={handleKeyDown}
          onFocus={focusInput}
          onBlur={blurInput}
        />
      </div>
    </>
  );
};

const ImageTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  deviceKeys,
}: TabProps & { deviceKeys: string[] }) => {
  const pastedImageColors = useRef<string[]>([]);
  const [computedColors, setComputedColors] = useState<Color[]>([]);
  const [pastedImage, setPastedImage] = usePastedImage();
  const pastedImageContainer = useRef<HTMLDivElement | null>(null);

  const [hsva, setHsva] = useState(colorToHsva(color));
  const [bri, setBri] = useState(brightness);
  const [sat, setSat] = useState(0.5);

  const recomputeColors = useCallback(
    (currentBri: number | null, currentSat: number | null) => {
      const computedColors = pastedImageColors.current.map((color) => {
        const hsv = Color(color).hsv();
        let saturated;

        const saturationValue = currentSat ?? sat;
        if (saturationValue > 0.5) {
          saturated = hsv.saturate(saturationValue * 2 - 1);
        } else {
          saturated = hsv.desaturate(1 - saturationValue * 2);
        }

        return Color({
          h: saturated.hue(),
          s: saturated.saturationv(),
          v: (currentBri ?? bri) * 100,
        });
      });

      setComputedColors(computedColors);
    },
    [bri, pastedImageColors, sat],
  );

  const handlePastedImage = useCallback(() => {
    if (pastedImage === null) return;

    pastedImage.style.objectFit = 'cover';
    pastedImage.style.height = '100%';
    pastedImage.style.marginLeft = 'auto';
    pastedImage.style.marginRight = 'auto';

    pastedImageContainer.current?.replaceChildren(pastedImage);
    const instance = new ColorThief();
    const dominant: number[] = instance.getColor(pastedImage);
    const palette: number[][] = instance.getPalette(pastedImage);
    const colors = [dominant, ...palette]
      .map((components) => Color(components, 'rgb'))
      .map(setMaxColorValue)
      .map((color) => color.hex());

    pastedImageColors.current = colors;
    recomputeColors(null, null);
  }, [pastedImage, recomputeColors]);

  useEffect(() => {
    handlePastedImage();
  }, [handlePastedImage]);

  const handlePasteClick = useCallback(async () => {
    const img = await clipboardToImg();

    if (!img) {
      return;
    }

    setPastedImage(img);
    handlePastedImage();
  }, [handlePastedImage, setPastedImage]);

  useEffect(() => {
    setHsva(colorToHsva(color));
    setBri(brightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const latestColor = useRef<Color>(color);
  useEffect(() => {
    latestColor.current = color;
  }, [color]);

  const handleChange = useCallback(
    (result: ColorResult) => {
      const hsv = Color(result.rgb).hsv();
      const color = Color({
        h: hsv.hue(),
        s: hsv.saturationv(),
        v: bri * 100,
      });
      latestColor.current = color;
      setHsva(colorToHsva(color));
      onChange && onChange(color, bri);
    },
    [bri, onChange],
  );

  const handleBrightnessChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setBri(value);
      recomputeColors(value, null);
    },
    [recomputeColors],
  );

  const handleSaturationChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value) / 100;
      setSat(value);
      recomputeColors(null, value);
    },
    [recomputeColors],
  );

  const state = useWebsocketState();
  const setDeviceColor = useSetDeviceColor();
  const handleApplyToDevices = useCallback(() => {
    const randomizedDeviceKeyOrder = deviceKeys
      ?.concat()
      .sort(() => Math.random() - 0.5);

    const randomizedColorOrder = computedColors
      ?.concat()
      .sort(() => Math.random() - 0.5);

    randomizedDeviceKeyOrder?.forEach((deviceKey, index) => {
      const match = state !== null ? findDevice(state, deviceKey) : null;
      const color = randomizedColorOrder[index % computedColors.length];

      if (match) {
        setDeviceColor(match, Color(color, 'rgb'), color.value() / 100);
      }
    });
  }, [deviceKeys, computedColors, state, setDeviceColor]);

  return (
    <>
      <div ref={pastedImageContainer} className="min-h-0 w-full flex-1 pb-4" />
      <div className="flex w-full justify-center gap-4">
        <Button startIcon={<Clipboard />} onClick={handlePasteClick}>
          Paste image
        </Button>
        <Button startIcon={<Dices />} onClick={handleApplyToDevices}>
          Apply colors
        </Button>
      </div>
      <Circle
        colors={computedColors.map((color) => color.hex())}
        color={hsva}
        onChange={handleChange}
        className="min-h-[40px] !flex-nowrap overflow-x-auto pl-4 pt-4 [&>*]:flex-shrink-0"
      />
      <div className="flex flex-nowrap gap-4">
        <div>
          Saturation:
          <Range
            className="mt-2"
            size="lg"
            onChange={handleSaturationChange}
            min={0}
            max={100}
            value={sat * 100}
          />
        </div>
        <div>
          Brightness:
          <Range
            className="mt-2"
            size="lg"
            onChange={handleBrightnessChange}
            min={0}
            max={100}
            value={bri * 100}
          />
        </div>
      </div>
    </>
  );
};

const ScenesTab = (props: { deviceKeys: string[] }) => {
  return <SceneList deviceKeys={props.deviceKeys} />;
};

const eqSet = <T,>(xs: Set<T>, ys: Set<T>) =>
  xs.size === ys.size && [...xs].every((x) => ys.has(x));

export const ColorPickerModal = () => {
  const {
    state: deviceModalState,
    open: deviceModalOpen,
    setOpen: setDeviceModalOpen,
  } = useDeviceModalState();

  const state = useWebsocketState();

  const firstDevice =
    state !== null ? findDevice(state, deviceModalState[0]) : null;
  const groups = state?.groups ?? {};

  const selectedDevicesSet = new Set(deviceModalState);

  // A group is active if the list of active devices == the devices contained in
  // the group
  const activeGroup = Object.values(groups).find((group) => {
    const groupDevicesSet = new Set(group.device_ids);

    return eqSet(selectedDevicesSet, groupDevicesSet);
  });

  let deviceModalTitle;

  if (activeGroup !== undefined) {
    deviceModalTitle = activeGroup.name;
  } else {
    deviceModalTitle =
      deviceModalState.length === 1
        ? firstDevice?.name
        : `${deviceModalState.length} devices`;
  }
  const deviceModalColor =
    firstDevice?.data === undefined ? null : getColor(firstDevice.data);
  const deviceModalBrightness =
    firstDevice?.data === undefined ? null : getBrightness(firstDevice.data);
  const deviceModalPower =
    firstDevice?.data === undefined ? null : getPower(firstDevice.data);

  const setDeviceColor = useSetDeviceColor();
  const setDevicePower = useSetDevicePower();

  const partialSetDeviceColor = useCallback(
    (color: Color, brightness: number) => {
      if (deviceModalState !== null) {
        deviceModalState.forEach((deviceKey) => {
          const match = state !== null ? findDevice(state, deviceKey) : null;

          if (match) {
            setDeviceColor(match, color, brightness, 250);
          }
        });
      }
    },
    [deviceModalState, setDeviceColor, state],
  );

  const partialSetDevicePower = useCallback(
    (power: boolean) => {
      if (deviceModalState !== null) {
        deviceModalState.forEach((deviceKey) => {
          const match = state !== null ? findDevice(state, deviceKey) : null;

          if (match) {
            setDevicePower(match, power);
          }
        });
      }
    },
    [deviceModalState, setDevicePower, state],
  );

  const throttledSetDeviceColor = useThrottleCallback(
    partialSetDeviceColor,
    4,
    true,
  );

  const closeDeviceModal = useCallback(() => {
    setDeviceModalOpen(false);
  }, [setDeviceModalOpen]);

  const [tab, setTab] = useState(0);
  return (
    <Modal.Legacy
      responsive
      open={deviceModalOpen}
      onClickBackdrop={closeDeviceModal}
    >
      <Modal.Header className="flex items-center justify-between font-bold">
        <Toggle
          checked={deviceModalPower ?? false}
          onChange={() => partialSetDevicePower(!deviceModalPower)}
          size="lg"
        />
        <div className="mx-4 text-center">{deviceModalTitle}</div>
        <Button onClick={closeDeviceModal} variant="outline">
          <X />
        </Button>
      </Modal.Header>

      <Modal.Body>
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-3 flex-nowrap overflow-x-auto pb-3"
        >
          <Tabs.Tab value={0}>Wheel</Tabs.Tab>
          <Tabs.Tab value={1}>Swatches</Tabs.Tab>
          <Tabs.Tab value={2}>Image</Tabs.Tab>
          <Tabs.Tab value={3}>Sliders</Tabs.Tab>
          <Tabs.Tab value={4}>Scenes</Tabs.Tab>
        </Tabs>
        <div className="flex h-96 flex-col justify-center">
          {tab === 0 && (
            <ColorWheelTab
              color={deviceModalColor ?? black}
              brightness={deviceModalBrightness ?? 1}
              onChange={throttledSetDeviceColor}
              onChangeComplete={throttledSetDeviceColor}
              open={deviceModalOpen}
            />
          )}
          {tab === 1 && (
            <SwatchesTab
              color={deviceModalColor ?? black}
              brightness={deviceModalBrightness ?? 1}
              onChange={throttledSetDeviceColor}
              onChangeComplete={throttledSetDeviceColor}
              open={deviceModalOpen}
            />
          )}
          {tab === 2 && (
            <ImageTab
              color={deviceModalColor ?? black}
              brightness={deviceModalBrightness ?? 1}
              onChange={throttledSetDeviceColor}
              onChangeComplete={throttledSetDeviceColor}
              open={deviceModalOpen}
              deviceKeys={deviceModalState}
            />
          )}
          {tab === 3 && (
            <SlidersTab
              color={deviceModalColor ?? black}
              brightness={deviceModalBrightness ?? 1}
              onChange={throttledSetDeviceColor}
              onChangeComplete={throttledSetDeviceColor}
              open={deviceModalOpen}
            />
          )}
          {tab === 4 && <ScenesTab deviceKeys={deviceModalState} />}
        </div>
      </Modal.Body>
    </Modal.Legacy>
  );
};
