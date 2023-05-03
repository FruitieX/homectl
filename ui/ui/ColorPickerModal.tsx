'use client';

import { Button, Input, Modal, Range, Tabs } from 'react-daisyui';
import { ColorResult } from 'react-color';
import Wheel from '@uiw/react-color-wheel';
import Circle from '@uiw/react-color-circle';
import Color from 'color';
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { black, getBrightness, getColor } from '@/lib/colors';
import { useThrottleCallback } from '@react-hook/throttle';
import { useSetDeviceColor } from '@/hooks/useSetDeviceColor';
import { useWebsocketState } from '@/hooks/websocket';
import { findDevice } from '@/lib/device';
import { Clipboard } from 'lucide-react';

type Props = {
  visible: boolean;
  close: () => void;
  color: Color;
  brightness: number;
  onChange?: (color: Color, brightness: number) => void;
  onChangeComplete?: (color: Color, brightness: number) => void;
  title: string;
};

const colorToHsva = (color: Color) => {
  const hsva = color.hsv();
  return {
    h: hsva.hue(),
    s: hsva.saturationv(),
    v: hsva.value(),
    a: hsva.alpha(),
  };
};

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
  open
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

const SwatchesTab = ({
  brightness,
  color,
  onChange,
  onChangeComplete,
  open
}: TabProps) => {
  const [hsva, setHsva] = useState(colorToHsva(color));
  const [bri, setBri] = useState(brightness);

  useEffect(() => {
    setHsva(colorToHsva(color));
    setBri(brightness);
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
      <div className="flex-1 overflow-y-auto p-3">
        <Circle
          colors={[
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
          ]}
          color={hsva}
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
        item.getType(type).then((imageBlob) => {
          const img = new Image();
          img.src = window.URL.createObjectURL(imageBlob);
          return img;
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
      }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        let modifier = event.key === 'ArrowUp' ? 1 : -1;
        if (event.shiftKey) modifier *= 10;
        let newHue = hue;
        let newSat = sat;
        let newBri = bri;

        if (event.target.name === 'hue-input') {
          newHue = Math.max(Math.min(hue + modifier, 360), 0);
          setHue(newHue);
        }
        else if (event.target.name === 'sat-input') {
          newSat = Math.max(Math.min(sat + modifier, 100), 0);
          setSat(newSat);
        }
        else if (event.target.name === 'bri-input') {
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
    [handleChangeComplete],
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
          name='hue-input'
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
          name='sat-input'
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
          name='bri-input'
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
}: TabProps) => {
  const pastedImageContainer = useRef<HTMLDivElement | null>(null);

  const handlePasteClick = useCallback(async () => {
    const img = await clipboardToImg();

    if (!img) {
      return;
    }

    pastedImageContainer.current?.replaceChildren(img);
    console.log(img);
  }, []);

  return (
    <>
      <Button startIcon={<Clipboard />} onClick={handlePasteClick}>
        Paste from clipboard
      </Button>

      <div ref={pastedImageContainer} />
    </>
  );
};

export const ColorPickerModal = () => {
  const {
    state: deviceModalState,
    open: deviceModalOpen,
    setOpen: setDeviceModalOpen,
  } = useDeviceModalState();

  const state = useWebsocketState();

  const device = state !== null ? findDevice(state, deviceModalState[0]) : null;

  const deviceModalTitle =
    deviceModalState.length === 1
      ? `Set ${device?.name} color`
      : `Set color of ${deviceModalState.length} devices`;
  const deviceModalColor =
    device?.state === undefined ? null : getColor(device.state);
  const deviceModalBrightness =
    device?.state === undefined ? null : getBrightness(device.state);

  const setDeviceColor = useSetDeviceColor();
  const partialSetDeviceColor = useCallback(
    (color: Color, brightness: number) => {
      if (deviceModalState !== null) {
        deviceModalState.forEach((deviceKey) => {
          const match = state !== null ? findDevice(state, deviceKey) : null;

          if (match) {
            setDeviceColor(match, color, brightness);
          }
        });
      }
    },
    [deviceModalState, setDeviceColor, state],
  );

  const throttledSetDeviceColor = useThrottleCallback(
    partialSetDeviceColor,
    3,
    true,
  );

  const closeDeviceModal = useCallback(() => {
    setDeviceModalOpen(false);
  }, [setDeviceModalOpen]);

  const [tab, setTab] = useState(0);
  return (
    <Modal responsive open={deviceModalOpen} onClickBackdrop={closeDeviceModal}>
      <Button
        size="sm"
        shape="circle"
        className="absolute right-2 top-2"
        onClick={closeDeviceModal}
      >
        ✕
      </Button>
      <Modal.Header className="font-bold">{deviceModalTitle}</Modal.Header>

      <Modal.Body>
        {/* <CirclePicker color={hsva} /> */}
        <Tabs value={tab} onChange={setTab} className="pb-6">
          <Tabs.Tab value={0}>Wheel</Tabs.Tab>
          <Tabs.Tab value={1}>Swatches</Tabs.Tab>
          <Tabs.Tab value={2}>Sliders</Tabs.Tab>
          <Tabs.Tab value={3}>Image</Tabs.Tab>
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
            <SlidersTab
              color={deviceModalColor ?? black}
              brightness={deviceModalBrightness ?? 1}
              onChange={throttledSetDeviceColor}
              onChangeComplete={throttledSetDeviceColor}
              open={deviceModalOpen} 
            />
          )}

          {tab === 3 && (
            <ImageTab
              color={deviceModalColor ?? black}
              brightness={deviceModalBrightness ?? 1}
              onChange={throttledSetDeviceColor}
              onChangeComplete={throttledSetDeviceColor}
              open={deviceModalOpen} 
            />
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
};
