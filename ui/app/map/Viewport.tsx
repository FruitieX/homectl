import {
  useDevicesByKeysState,
  useDevicesState,
  useGroupsState,
  useScenesState,
} from '@/hooks/websocket';
import {
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
  useFloorplans,
} from '@/hooks/useConfig';
import { useImageState } from '@/hooks/useImageState';
import { Device } from '@/bindings/Device';
import { useMemo, useState } from 'react';
import { getDeviceKey } from '@/lib/device';
import {
  useSelectedDevices,
  useToggleSelectedDevice,
} from '@/hooks/selectedDevices';
import { SensorActionModal } from '@/ui/SensorActionModal';
import { useStoredFloorplan } from '@/hooks/useStoredFloorplan';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { getSensorConfigRef } from '@/lib/sensorInteraction';
import { excludeUndefined } from 'utils/excludeUndefined';
import { buildFloorplanScene } from '@/lib/floorplan-scene';
import { PixiFloorplanRenderer } from '@/ui/floorplan';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { FloorplanControlPanel } from '@/ui/FloorplanControlPanel';
import { useSetDeviceState } from '@/hooks/useSetDeviceColor';
import { getColor } from '@/lib/colors';
import { type DevicesState } from '@/bindings/DevicesState';
import { type FlattenedScenesConfig } from '@/bindings/FlattenedScenesConfig';
import { Label } from '@/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';

function isDevicePersistEnabled(
  devices: DevicesState | null,
  scenes: FlattenedScenesConfig | null,
  deviceKey: string,
) {
  const device = devices?.[deviceKey];
  if (!device || !('Controllable' in device.data)) {
    return false;
  }

  const sceneId = device.data.Controllable.scene_id;
  if (!sceneId) {
    return false;
  }

  const scene = scenes?.[sceneId];
  if (!scene) {
    return false;
  }

  return scene.active_overrides.includes(deviceKey);
}

export const Viewport = () => {
  const devicesState = useDevicesState();
  const liveGroups = useGroupsState();
  const scenes = useScenesState();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const { data: deviceSensorConfigs } = useDeviceSensorConfigs();
  const { data: floorplans } = useFloorplans();
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(
    null,
  );
  const [pixiFallbackReason, setPixiFallbackReason] = useState<string | null>(
    null,
  );
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const effectiveSelectedFloorplanId =
    floorplans.length === 0
      ? null
      : selectedFloorplanId &&
          floorplans.some((floorplan) => floorplan.id === selectedFloorplanId)
        ? selectedFloorplanId
        : (floorplans[0]?.id ?? null);
  const { grid: floorplanGrid, imageUrl } = useStoredFloorplan(
    effectiveSelectedFloorplanId ?? undefined,
  );
  const floorplanImage = useImageState(imageUrl);
  const placedDeviceKeys = useMemo(
    () => floorplanGrid?.devices.map((device) => device.deviceKey) ?? [],
    [floorplanGrid],
  );
  const liveDevices = useDevicesByKeysState(placedDeviceKeys);
  const selectedFloorplanName =
    floorplans.find(
      (floorplan) => floorplan.id === effectiveSelectedFloorplanId,
    )?.name ?? undefined;

  const allDevices: Device[] = Object.values(
    excludeUndefined(liveDevices ?? undefined),
  );
  const allRuntimeDevices = excludeUndefined(devicesState ?? undefined);
  const groups = excludeUndefined(liveGroups ?? undefined);
  const deviceDisplayNameMap = useMemo(
    () =>
      Object.fromEntries(
        deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
      ),
    [deviceDisplayNames],
  );
  const floorplanScene = buildFloorplanScene({
    grid: floorplanGrid,
    image: floorplanImage,
    devices: allDevices,
    groups,
    displayNames: deviceDisplayNameMap,
  });
  const deviceSensorConfigMap = useMemo(
    () =>
      Object.fromEntries(
        deviceSensorConfigs.map((row) => [row.device_ref, row]),
      ),
    [deviceSensorConfigs],
  );
  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();
  const setDeviceState = useSetDeviceState();
  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();
  const [activeSensorKey, setActiveSensorKey] = useState<string | null>(null);

  const activeSensor =
    activeSensorKey === null
      ? null
      : (allDevices.find(
          (device) => getDeviceKey(device) === activeSensorKey,
        ) ?? null);

  const webglRendererActive =
    pixiFallbackReason === null &&
    floorplanScene.width > 0 &&
    floorplanScene.height > 0;

  const openDeviceModal = (deviceKeys: string[]) => {
    if (deviceKeys.length === 0) {
      return;
    }

    setDeviceModalState(deviceKeys);
    setDeviceModalOpen(true);
  };

  const setDevicesPower = (deviceKeys: string[], power: boolean) => {
    for (const deviceKey of deviceKeys) {
      const device = devicesState?.[deviceKey];
      if (!device || !('Controllable' in device.data)) {
        continue;
      }

      const state = device.data.Controllable.state;

      setDeviceState(
        device,
        isDevicePersistEnabled(devicesState, scenes, deviceKey),
        power,
        state.color ? getColor(device.data) : undefined,
        state.brightness ?? (power ? 1 : undefined),
        0.25,
      );
    }
  };

  const toggleGroupDevices = (groupId: string) => {
    const group = groups[groupId];
    if (!group) {
      return;
    }

    const selectedGroupDevices = selectedDevices.filter((deviceKey) =>
      group.device_keys.includes(deviceKey),
    );
    const isSelected = selectedGroupDevices.length > 0;

    for (const deviceKey of group.device_keys) {
      toggleSelectedDevice(deviceKey, isSelected);
    }
  };

  const handlePixiDevicePress = (deviceKey: string) => {
    if (selectedDevices.length === 0) {
      openDeviceModal([deviceKey]);
      return;
    }

    toggleSelectedDevice(deviceKey);
  };

  const handlePixiGroupPress = (groupId: string) => {
    const group = groups[groupId];
    if (!group) {
      return;
    }

    if (selectedDevices.length === 0) {
      setActiveGroupId(groupId);
      return;
    }

    toggleGroupDevices(groupId);
  };

  return (
    <div className="absolute left-0 top-0 h-full w-full">
      {floorplans.length > 0 && (
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded-3xl border border-border/70 bg-card/90 p-3 text-card-foreground shadow-xl backdrop-blur-xl sm:bottom-4 sm:left-auto sm:right-4 sm:w-80">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Floorplan
            </Label>
            <Select
              value={effectiveSelectedFloorplanId ?? ''}
              onValueChange={(value) => {
                setSelectedFloorplanId(value || null);
                setPixiFallbackReason(null);
              }}
            >
              <SelectTrigger className="h-9 rounded-2xl bg-background/80">
                <SelectValue placeholder="Choose floorplan" />
              </SelectTrigger>
              <SelectContent>
                {floorplans.map((floorplan) => (
                  <SelectItem key={floorplan.id} value={floorplan.id}>
                    {floorplan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {pixiFallbackReason && (
            <p className="mt-2 text-xs text-muted-foreground">
              {pixiFallbackReason}
            </p>
          )}
        </div>
      )}

      {floorplans.length > 0 && (
        <FloorplanControlPanel
          floorplanName={selectedFloorplanName}
          placedDevices={allDevices}
          devicesByKey={allRuntimeDevices}
          groups={groups}
          selectedDeviceKeys={selectedDevices}
          activeGroupId={activeGroupId}
          displayNames={deviceDisplayNameMap}
          onClearSelection={() => setSelectedDevices([])}
          onCloseGroup={() => setActiveGroupId(null)}
          onOpenDetailedControls={(deviceKeys) => {
            setActiveGroupId(null);
            openDeviceModal(deviceKeys);
          }}
          onSetPower={setDevicesPower}
        />
      )}

      {webglRendererActive ? (
        <PixiFloorplanRenderer
          key={effectiveSelectedFloorplanId ?? 'default'}
          scene={floorplanScene}
          selectedDeviceKeys={selectedDevices}
          onDevicePress={handlePixiDevicePress}
          onDeviceLongPress={toggleSelectedDevice}
          onSensorPress={setActiveSensorKey}
          onGroupPress={handlePixiGroupPress}
          onGroupLongPress={toggleGroupDevices}
          onUnavailable={() => {
            setPixiFallbackReason(
              'WebGL renderer unavailable; floorplan rendering is disabled on this device.',
            );
          }}
        />
      ) : pixiFallbackReason ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {pixiFallbackReason}
        </div>
      ) : null}

      <SensorActionModal
        device={activeSensor}
        sensorConfig={
          activeSensor === null
            ? null
            : (deviceSensorConfigMap[getSensorConfigRef(activeSensor)] ?? null)
        }
        label={
          activeSensor === null
            ? undefined
            : getDeviceDisplayLabel(activeSensor, deviceDisplayNameMap)
        }
        open={activeSensor !== null}
        onClose={() => setActiveSensorKey(null)}
      />
    </div>
  );
};

export default Viewport;
