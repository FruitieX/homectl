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
import produce from 'immer';

type Props = {
  visible: boolean;
  close: () => void;
  color: Color;
  onChange?: (color: Color) => void;
  onChangeComplete?: (color: Color) => void;
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
  onChange,
  onChangeComplete,
  visible,
  title,
}: Props) => {
  const toggleVisible = () => {
    close();
  };

  const [hsva, setHsva] = useState(colorToHsva(color));

  const hsvaWithMaxValue = useMemo(() => {
    const result = { ...hsva };
    // Limit range to [50, 100]
    result.v = (100 + hsva.v) / 2;
    return result;
  }, [hsva]);

  useEffect(() => {
    setHsva(colorToHsva(color));
  }, [color]);

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
      onChange && onChange(color);
    },
    [onChange],
  );

  const handleChangeComplete = useCallback(() => {
    onChangeComplete && onChangeComplete(latestColor.current);
  }, [onChangeComplete]);

  const handleValueChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const hsv = latestColor.current.hsv();
      console.log(hsv);
      const value = Number(event.currentTarget.value);
      const result = Color({
        h: hsv.hue(),
        s: hsv.saturationv(),
        v: value,
      });
      latestColor.current = result;
      setHsva(colorToHsva(result));
      onChange && onChange(result);
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
          onChange={handleValueChange}
          onTouchEnd={handleChangeComplete}
          onMouseUp={handleChangeComplete}
          min={0}
          max={100}
          value={hsva.v}
        />
      </Modal.Body>
    </Modal>
  );
};
