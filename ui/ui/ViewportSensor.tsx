import { RegularPolygon, Text } from 'react-konva';
import { Device } from '@/bindings/Device';
import { Vector2d } from 'konva/lib/types';

const getSensorValue = (device: Device): { type: string; value: unknown } => {
  if ('Sensor' in device.data) {
    const sensor = device.data.Sensor;
    if ('value' in sensor) {
      if (typeof sensor.value === 'boolean') {
        return { type: 'boolean', value: sensor.value };
      }
      if (typeof sensor.value === 'number') {
        return { type: 'number', value: sensor.value };
      }
      if (typeof sensor.value === 'string') {
        return { type: 'text', value: sensor.value };
      }
    }
    // ControllableState (color sensor)
    return { type: 'color', value: sensor };
  }
  return { type: 'unknown', value: null };
};

type Props = {
  device: Device;
  label?: string;
  position: Vector2d;
  onOpenActions: (device: Device) => void;
};

export const ViewportSensor = ({ device, label, position, onOpenActions }: Props) => {
  const { type, value } = getSensorValue(device);

  const isActive = type === 'boolean' && value === true;
  const fillColor = isActive ? '#22c55e' : '#6b7280';
  const strokeColor = isActive ? '#16a34a' : '#374151';

  const statusLabel =
    type === 'boolean'
      ? isActive
        ? 'ON'
        : 'OFF'
      : type === 'number'
        ? String(value)
        : '';
  const deviceLabel = label ?? (device.name.trim() || device.id);

  return (
    <>
      <RegularPolygon
        x={position.x}
        y={position.y}
        sides={4}
        radius={18}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={3}
        rotation={45}
        onClick={() => onOpenActions(device)}
        onTap={() => onOpenActions(device)}
      />
      <Text
        text={deviceLabel}
        fontSize={11}
        x={position.x - 50}
        y={position.y + 22}
        width={100}
        align="center"
        fill="#e5e7eb"
        fontStyle="bold"
        listening={false}
      />
      {statusLabel && (
        <Text
          text={statusLabel}
          fontSize={9}
          x={position.x - 15}
          y={position.y - 5}
          width={30}
          align="center"
          fill="white"
          fontStyle="bold"
          listening={false}
        />
      )}
    </>
  );
};
