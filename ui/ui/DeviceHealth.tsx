import { useEffect, useState } from 'react';
import { AlertTriangle, CirclePause } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import {
  deviceReachability,
  reachabilityLabels,
} from '@/lib/deviceReachability';

export function DeviceHealth({ device }: { device: Device }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const status = deviceReachability(device, now);
  return (
    <span
      className="inline-flex shrink-0 items-center"
      aria-label={reachabilityLabels[status]}
      title={reachabilityLabels[status]}
    >
      {status === 'disabled' ? (
        <CirclePause className="size-4 text-muted-foreground" />
      ) : status === 'offline' || status === 'stale' ? (
        <AlertTriangle className="size-4 text-amber-500" />
      ) : (
        <span
          className={`size-2 rounded-full ${status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
        />
      )}
    </span>
  );
}
