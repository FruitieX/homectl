import { SensorHistoryPanel } from '@/ui/SensorHistoryPanel';
import { Device } from '@/bindings/Device';
import { Link } from 'react-router-dom';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { configItemHref } from '@/lib/configItemHref';
import { getSensorDetails } from '@/lib/sensorInteraction';
import { useSensorInteraction } from '@/hooks/useSensorInteraction';
import { HealthEvidence } from '@/ui/settings/HealthStatus';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { getDeviceKey } from '@/lib/device';
import { type DeviceSensorConfig } from '@/lib/sensorInteraction';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { SensorActionPanel, hasSensorControls } from '@/ui/SensorActionPanel';

type Props = {
  device: Device | null;
  sensorConfig?: DeviceSensorConfig | null;
  label?: string;
  open: boolean;
  onClose: () => void;
  presentation?: 'default' | 'floorplan';
};

export const SensorActionModal = ({
  device,
  sensorConfig,
  label,
  open,
  onClose,
  presentation = 'default',
}: Props) => {
  if (!open || !device) {
    return null;
  }
  return (
    <SensorActionModalContent
      device={device}
      sensorConfig={sensorConfig}
      label={label}
      onClose={onClose}
      presentation={presentation}
    />
  );
};

const SensorActionModalContent = ({
  device,
  sensorConfig,
  label,
  onClose,
  presentation,
}: Omit<Props, 'device' | 'open'> & { device: Device }) => {
  const { advanced } = useSettingsPreferences();
  const { interaction, eventButtons } = useSensorInteraction(
    device,
    sensorConfig,
  );
  const showControls =
    advanced || hasSensorControls(interaction.kind, eventButtons.length);

  const title = label ?? (device.name.trim() || device.id);
  const deviceKey = getDeviceKey(device);
  const sensor = getSensorDetails(device);
  const state = devicePreviewState(device);
  const value =
    sensor.kind === 'unknown'
      ? 'Unknown'
      : sensor.kind === 'state'
        ? state
          ? state.power
            ? 'On'
            : 'Off'
          : 'Unknown'
        : sensor.kind === 'boolean'
          ? sensor.value
            ? 'On'
            : 'Off'
          : String(sensor.value);

  return (
    <ResponsiveOverlay
      desktopPresentation={
        presentation === 'floorplan' ? 'floorplan' : 'dialog'
      }
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title={title}
      description={
        <>
          <span className="block">
            Current sensor value and reporting status.
          </span>
          {advanced && (
            <span className="block break-all font-mono text-xs">
              {deviceKey}
            </span>
          )}
        </>
      }
      className="max-w-2xl"
    >
      <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          {state && <LiveStatePreview states={[state]} size={48} />}
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground">Current value</span>
            <p className="break-words text-2xl font-medium">{value}</p>
          </div>
        </div>
        {showControls && (
          <section aria-labelledby="sensor-send-event" className="space-y-2">
            <div>
              <h3 id="sensor-send-event" className="text-sm font-medium">
                Send event
              </h3>
              <p className="text-xs text-muted-foreground">
                Acts like using the physical sensor: matching routines run.
              </p>
            </div>
            <SensorActionPanel device={device} sensorConfig={sensorConfig} />
          </section>
        )}
        <HealthEvidence deviceKey={deviceKey} />
        <SensorHistoryPanel deviceKey={deviceKey} />
        <Link
          className="inline-block text-sm text-primary underline"
          to={configItemHref('device', deviceKey)}
          onClick={onClose}
        >
          Sensor settings
        </Link>
      </div>
    </ResponsiveOverlay>
  );
};
