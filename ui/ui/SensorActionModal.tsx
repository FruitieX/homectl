import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { type DeviceSensorConfig } from '@/lib/sensorInteraction';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { SensorActionPanel } from '@/ui/SensorActionPanel';

type Props = {
  device: Device | null;
  sensorConfig?: DeviceSensorConfig | null;
  label?: string;
  open: boolean;
  onClose: () => void;
};

export const SensorActionModal = ({
  device,
  sensorConfig,
  label,
  open,
  onClose,
}: Props) => {
  if (!open || !device) {
    return null;
  }

  const title = label ?? (device.name.trim() || device.id);
  const deviceKey = getDeviceKey(device);

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title={title}
      description={
        <>
          <span className="block font-mono text-xs">{deviceKey}</span>
          <span className="block">
            Trigger fake sensor updates from the map without touching the
            physical device.
          </span>
        </>
      }
      className="max-w-2xl"
    >
      <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
        <SensorActionPanel device={device} sensorConfig={sensorConfig} />
      </div>
    </ResponsiveOverlay>
  );
};
