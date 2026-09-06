import { type Device } from '@/bindings/Device';
import { useCarHeaterModalOpenState } from '@/hooks/carHeaterModalState';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
  getDashboardWidgetOptionStringArray,
} from '@/hooks/useDashboard';
import { useSetDeviceState } from '@/hooks/useSetDeviceColor';
import {
  useConnectionStatus,
  useDevicesState,
  useGroupsState,
} from '@/hooks/websocket';
import { getBrightness, getColor, getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { LampDesk, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

const carHeaterDeviceKey = 'tuya_devices/bfe553b84e883ace37nvxw';

export const ControlsCard = ({ widget }: { widget?: DashboardWidget }) => {
  const devicesState = useDevicesState();
  const groups = useGroupsState();
  const connectionStatus = useConnectionStatus();
  const setDeviceState = useSetDeviceState();
  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();
  const carHeaterModal = useCarHeaterModalOpenState();
  const groupId = getDashboardWidgetOptionString(widget, 'groupId', '');
  const configuredDeviceKeys = getDashboardWidgetOptionStringArray(
    widget,
    'deviceKeys',
  );

  const devices = useMemo(() => {
    const allDevices = Object.entries(devicesState ?? {})
      .flatMap(([deviceKey, device]) =>
        device && 'Controllable' in device.data ? [{ deviceKey, device }] : [],
      )
      .sort((left, right) => left.device.name.localeCompare(right.device.name));
    const groupKeys = groupId ? groups?.[groupId]?.device_keys : undefined;
    const requestedKeys =
      configuredDeviceKeys.length > 0 ? configuredDeviceKeys : groupKeys;
    if (!requestedKeys) return allDevices.slice(0, 6);
    const keySet = new Set(requestedKeys);
    return allDevices
      .filter(({ deviceKey }) => keySet.has(deviceKey))
      .slice(0, 6);
  }, [configuredDeviceKeys, devicesState, groupId, groups]);

  const openDetails = (device: Device) => {
    const deviceKey = getDeviceKey(device);
    if (deviceKey === carHeaterDeviceKey) {
      carHeaterModal.setOpen(true);
      return;
    }
    setDeviceModalState([deviceKey]);
    setDeviceModalOpen(true);
  };

  return (
    <Card className="relative h-full overflow-hidden bg-card/78">
      <div className="pointer-events-none absolute -right-12 -top-12 size-36 rounded-full bg-primary/10 blur-3xl" />
      <CardHeader className="relative flex-row items-center justify-between pb-3">
        <div>
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-primary">
            Quick control
          </div>
          <CardTitle className="mt-1">{widget?.title || 'Controls'}</CardTitle>
        </div>
        <SlidersHorizontal className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="relative grid grid-cols-2 gap-2 p-3 pt-0 sm:grid-cols-3">
        {devices.length === 0 ? (
          <div className="col-span-full flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-muted/35 text-center text-xs text-muted-foreground">
            <Sparkles className="size-5" />
            Choose a group or devices in Studio.
          </div>
        ) : (
          devices.map(({ deviceKey, device }) => {
            const active = getPower(device.data);
            const color = getColor(device.data);
            const brightness = getBrightness(device.data);
            return (
              <button
                key={deviceKey}
                disabled={connectionStatus !== 'connected'}
                onClick={() =>
                  setDeviceState(
                    device,
                    false,
                    !active,
                    color,
                    brightness || 1,
                    0.25,
                  )
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  openDetails(device);
                }}
                className="group relative min-h-24 overflow-hidden rounded-[1.25rem] border border-border/45 bg-background/38 p-3 text-left transition duration-300 hover:-translate-y-0.5 hover:border-primary/30 disabled:opacity-50"
              >
                {active ? (
                  <div
                    className="pointer-events-none absolute inset-0 opacity-40"
                    style={{
                      background: `radial-gradient(circle at 75% 20%, ${color.hex()}88, transparent 58%)`,
                    }}
                  />
                ) : null}
                <div className="relative flex h-full flex-col justify-between gap-4">
                  <LampDesk
                    className={
                      active ? 'text-foreground' : 'text-muted-foreground'
                    }
                  />
                  <div>
                    <div className="truncate text-xs font-semibold">
                      {device.name || device.id}
                    </div>
                    <div className="mt-0.5 text-[0.62rem] font-medium text-muted-foreground">
                      {active ? `${Math.round(brightness * 100)}% · on` : 'Off'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};
