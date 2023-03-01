import { Button, Modal, Range } from 'react-daisyui';
import { ColorResult } from 'react-color';
import Wheel from '@uiw/react-color-wheel';
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
const Component = ({
  close,
  color,
  brightness,
  onChange,
  onChangeComplete,
  visible,
  title,
}: Props) => {
  const [hsva, setHsva] = useState(colorToHsva(color));
  const [bri, setBri] = useState(brightness);

  const hsvaWithMaxValue = useMemo(() => {
    const result = { ...hsva };
    // Limit range to [50, 100]
    result.v = (100 + hsva.v) / 2;
    return result;
  }, [hsva]);

  useEffect(() => {
    setHsva(colorToHsva(color));
    setBri(brightness);
  }, [color, brightness]);

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
    <Modal responsive open={visible} onClickBackdrop={close}>
      <Button
        size="sm"
        shape="circle"
        className="absolute right-2 top-2"
        onClick={close}
      >
        ✕
      </Button>
      <Modal.Header className="font-bold">{title}</Modal.Header>

      <Modal.Body>
        {/* <CirclePicker color={hsva} /> */}
        <Wheel
          color={hsvaWithMaxValue}
          onChange={handleChange}
          onTouchEnd={handleChangeComplete}
          onMouseUp={handleChangeComplete}
          width={300}
          height={300}
          className="mx-auto"
        />
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
      </Modal.Body>
    </Modal>
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

  return (
    <Component
      visible={deviceModalOpen}
      close={closeDeviceModal}
      title={deviceModalTitle}
      color={deviceModalColor ?? black}
      brightness={deviceModalBrightness ?? 1}
      onChange={throttledSetDeviceColor}
      onChangeComplete={throttledSetDeviceColor}
    />
  );
};
