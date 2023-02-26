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
export const ColorPickerModal = ({
  close,
  color,
  brightness,
  onChange,
  onChangeComplete,
  visible,
  title,
}: Props) => {
  const toggleVisible = () => {
    close();
  };

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
    <Modal responsive open={visible} onClickBackdrop={toggleVisible}>
      <Button
        size="sm"
        shape="circle"
        className="absolute right-2 top-2"
        onClick={toggleVisible}
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
