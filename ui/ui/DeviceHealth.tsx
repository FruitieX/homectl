import { AlertTriangle, CirclePause, Clock3 } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { healthLabel } from '@/ui/settings/HealthStatus';
export function DeviceHealth({ device }: { device: Device }) {
  const query = useDeviceHealth(),
    health = query.isError
      ? undefined
      : query.data?.devices?.[`${device.integration_id}/${device.id}`];
  const label = healthLabel(health);
  return (
    <span
      className="inline-flex shrink-0 items-center"
      aria-label={label}
      title={label}
    >
      {health?.issues.length ? (
        <AlertTriangle className="size-4 text-amber-500" />
      ) : health?.status === 'disabled' ? (
        <CirclePause className="size-4 text-muted-foreground" />
      ) : health?.status === 'healthy' ? (
        <span className="size-2 rounded-full bg-emerald-500" />
      ) : (
        <Clock3 className="size-4 text-muted-foreground" />
      )}
    </span>
  );
}
