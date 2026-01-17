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
  scale?: number;
  onOpenActions: (device: Device) => void;
};

export const ViewportSensor = ({
  device,
  label,
  position,
  scale = 1,
  onOpenActions,
}: Props) => {
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
  const iconRadius = 18 * scale;
  const iconStrokeWidth = 3 * scale;
  const labelFontSize = 11 * scale;
  const labelWidth = 100 * scale;
  const labelYOffset = 22 * scale;
  const statusFontSize = 9 * scale;
  const statusWidth = 30 * scale;

  return (
    <>
      <RegularPolygon
        x={position.x}
        y={position.y}
        sides={4}
        radius={iconRadius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={iconStrokeWidth}
        rotation={45}
        onClick={() => onOpenActions(device)}
        onTap={() => onOpenActions(device)}
      />
      <Text
        text={deviceLabel}
        fontSize={labelFontSize}
        x={position.x - labelWidth / 2}
        y={position.y + labelYOffset}
        width={labelWidth}
        align="center"
        fill="#e5e7eb"
        fontStyle="bold"
        listening={false}
      />
      {statusLabel && (
        <Text
          text={statusLabel}
          fontSize={statusFontSize}
          x={position.x - statusWidth / 2}
          y={position.y - statusFontSize / 2}
          width={statusWidth}
          align="center"
          fill="white"
          fontStyle="bold"
          listening={false}
        />
      )}
    </>
  );
};
