'use client';

import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { type DeviceSensorConfig } from '@/lib/sensorInteraction';
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

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold">{label ?? (device.name.trim() || device.id)}</h3>
            <div className="text-sm opacity-70">{getDeviceKey(device)}</div>
          </div>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="text-sm opacity-70">
          Trigger fake sensor updates from the map without touching the physical device.
        </p>

        <SensorActionPanel device={device} sensorConfig={sensorConfig} />

        <div className="flex justify-end">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <button className="modal-backdrop" onClick={onClose}>
        close
      </button>
    </div>
  );
};