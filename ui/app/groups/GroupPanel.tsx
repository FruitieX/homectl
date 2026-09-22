import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import {
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
} from '@/hooks/useConfig';
import {
  useConnectionStatus,
  useDevicesState,
  useGroupsState,
} from '@/hooks/websocket';
import { getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { resolveGroupDeviceKeys } from '@/lib/group-floorplan-preview';
import { getSensorConfigRef } from '@/lib/sensorInteraction';
import { DeviceColorTabs, colorToDeviceHs } from '@/ui/DeviceColorTabs';
import {
  DevicePowerToggle,
  DeviceQuickControls,
  useLiveDeviceControls,
} from '@/ui/DeviceControls';
import { FloorplanInspector } from '@/ui/FloorplanInspector';
import { SensorActionPanel } from '@/ui/SensorActionPanel';
import { Button } from '@/ui/primitives/button';
import { Tabs, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { SceneList } from './[id]/SceneList';

function summarizeDevice(device: Device, readOnly: boolean): string {
  const prefix = readOnly ? 'Read-only · ' : '';
  if ('Controllable' in device.data) {
    const state = device.data.Controllable.state;
    const active = getPower(device.data);
    if (!active) return `${prefix}Off`;
    return state.brightness === null
      ? `${prefix}On`
      : `${prefix}On · ${Math.round(state.brightness * 100)}%`;
  }
  if ('Sensor' in device.data) {
    const sensor = device.data.Sensor;
    const value = 'value' in sensor ? String(sensor.value) : null;
    return value ?? (getPower(device.data) ? 'On' : 'Off');
  }
  return readOnly ? 'Read-only' : '';
}

/**
 * Room/group detail sheet: the floorplan side panel on desktop and a bottom
 * sheet on mobile. Groups its devices into Controls, Scenes, Color and
 * Devices tabs; picking a device from the Devices tab navigates within the
 * sheet and returns via the back chevron in the header.
 */
export function GroupPanel({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const groups = useGroupsState();
  const devicesState = useDevicesState();
  const { data: overrides } = useDeviceDisplayNames();
  const { data: sensorConfigs } = useDeviceSensorConfigs();
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [tab, setTab] = useState('controls');
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const names = useMemo(
    () =>
      Object.fromEntries(
        overrides.map((row) => [row.device_key, row.display_name]),
      ),
    [overrides],
  );
  const group = groups?.[groupId] ?? null;
  const deviceKeys = useMemo(
    () =>
      group
        ? resolveGroupDeviceKeys(groupId, { ...groups, [groupId]: group })
        : [],
    [groupId, group, groups],
  );
  const devices = useMemo(
    () =>
      deviceKeys.flatMap((key) =>
        devicesState?.[key] ? [devicesState[key]!] : [],
      ),
    [deviceKeys, devicesState],
  );
  const controllable = devices.filter(
    (device) => 'Controllable' in device.data && !isDeviceReadOnly(device),
  );
  const onCount = controllable.filter((device) => getPower(device.data)).length;
  const colorDevices = devices.filter((device) => {
    if (!('Controllable' in device.data) || isDeviceReadOnly(device))
      return false;
    const capabilities = device.data.Controllable.capabilities;
    return Boolean(
      capabilities.hs || capabilities.xy || capabilities.rgb || capabilities.ct,
    );
  });
  const unavailableCount = deviceKeys.length - devices.length;

  const active = activeKey ? (devicesState?.[activeKey] ?? null) : null;
  const activeLabel = active
    ? getDeviceDisplayLabel(active, names)
    : (names[activeKey ?? ''] ?? activeKey ?? '');
  const sensorConfigMap = useMemo(
    () => Object.fromEntries(sensorConfigs.map((row) => [row.device_ref, row])),
    [sensorConfigs],
  );

  if (!group) return null;
  return (
    <FloorplanInspector
      title={
        active ? (
          <button
            type="button"
            className="flex min-w-0 max-w-full items-center gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setActiveKey(null)}
          >
            <ChevronLeft className="size-4 shrink-0" />
            <span className="truncate">{activeLabel}</span>
          </button>
        ) : (
          <span className="block truncate">{group.name}</span>
        )
      }
      onClose={onClose}
    >
      {active ? (
        <div className="space-y-4">
          {'Controllable' in active.data ? (
            <DeviceQuickControls key={activeKey} devices={[active]} />
          ) : (
            <SensorActionPanel
              device={active}
              sensorConfig={sensorConfigMap[getSensorConfigRef(active)] ?? null}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="controls">Controls</TabsTrigger>
              <TabsTrigger value="scenes">Scenes</TabsTrigger>
              <TabsTrigger value="color" disabled={colorDevices.length === 0}>
                Color
              </TabsTrigger>
              <TabsTrigger value="devices">
                Devices{unavailableCount > 0 ? ` (${devices.length})` : ''}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'controls' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {onCount} of {controllable.length} on
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deviceKeys.length}{' '}
                    {deviceKeys.length === 1 ? 'device' : 'devices'}
                    {unavailableCount > 0
                      ? ` · ${unavailableCount} unavailable`
                      : ''}
                  </p>
                </div>
                <DevicePowerToggle devices={devices} label={group.name} />
              </div>
              <DeviceQuickControls
                key={groupId}
                devices={devices}
                showColorTabs={false}
              />
            </div>
          ) : null}
          {tab === 'scenes' ? (
            <SceneList deviceKeys={deviceKeys} compact />
          ) : null}
          {tab === 'color' ? (
            <DeviceColorTabs
              devices={devices}
              connected={connected}
              onChange={(device, color, brightness) => {
                if ('Controllable' in device.data)
                  setState(
                    device,
                    getPower(device.data),
                    brightness,
                    colorToDeviceHs(color),
                  );
              }}
              onNativeChange={setState}
            />
          ) : null}
          {tab === 'devices' ? (
            <div className="space-y-2">
              {deviceKeys.map((key) => {
                const device = devicesState?.[key];
                if (!device) {
                  return (
                    <p
                      key={key}
                      className="break-words rounded-xl border border-border p-4 text-sm text-muted-foreground"
                    >
                      {names[key] ?? key} · Unavailable
                    </p>
                  );
                }
                const readOnly = isDeviceReadOnly(device);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveKey(key)}
                    className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {getDeviceDisplayLabel(device, names)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {summarizeDevice(device, readOnly)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
              {deviceKeys.length === 0 ? (
                <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                  No devices in this room yet.
                </p>
              ) : null}
              <Button asChild variant="outline" className="w-full">
                <Link to="/config/groups">Manage room devices</Link>
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </FloorplanInspector>
  );
}

export default GroupPanel;
