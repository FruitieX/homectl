import { useState } from 'react';
import { toast } from 'sonner';
import type { Device } from '@/bindings/Device';
import { useAppConfig } from '@/hooks/appConfig';

export function DeviceEnabledToggle({ device }: { device: Device }) {
  const { apiEndpoint } = useAppConfig();
  const [busy, setBusy] = useState(false);
  if (!('Controllable' in device.data)) return null;
  const disabled = device.data.Controllable.disabled;
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/integrations/${encodeURIComponent(device.integration_id)}/devices/${encodeURIComponent(device.id)}/enabled`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: Boolean(disabled) }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || 'Could not update device');
      if (result.write?.persistence !== 'persisted')
        toast.warning(
          'Device updated, but could not be saved to the database.',
        );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not update device',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
      onClick={() => void toggle()}
    >
      {busy ? 'Saving…' : disabled ? 'Enable device' : 'Disable device'}
    </button>
  );
}
