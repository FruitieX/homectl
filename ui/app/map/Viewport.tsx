import { SensorQuickPopover } from '@/ui/SensorQuickPopover';
import { LightQuickPopover } from '@/ui/LightQuickPopover';
import type { LightHold } from '@/lib/lightQuickAdjust';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, MousePointer2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  useDevicesByKeysState,
  useDevicesState,
  useGroupsState,
} from '@/hooks/websocket';
import {
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
  useFloorplans,
} from '@/hooks/useConfig';
import { useImageState } from '@/hooks/useImageState';
import {
  useSelectedDevices,
  useToggleSelectedDevice,
} from '@/hooks/selectedDevices';
import {
  useAllFloorplans,
  useStoredFloorplan,
} from '@/hooks/useStoredFloorplan';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import {
  resolveGroupDeviceKeys,
  selectGroupFloorplan,
} from '@/lib/group-floorplan-preview';
import { getSensorConfigRef } from '@/lib/sensorInteraction';
import { excludeUndefined } from 'utils/excludeUndefined';
import { buildFloorplanScene } from '@/lib/floorplan-scene';
import { PixiFloorplanRenderer } from '@/ui/floorplan';
import { SensorActionModal } from '@/ui/SensorActionModal';
import { DeviceRow } from '@/ui/DeviceControls';
import { LiveSensorRow } from '@/ui/LiveSensorRow';
import { Button } from '@/ui/primitives/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/primitives/popover';
import { Tabs, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Slider } from '@/ui/primitives/slider';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { floorplanLabels, type FloorplanLayers } from '@/lib/floorplan-labels';
import { FloorplanLayerToggles } from '@/ui/floorplan/FloorplanLayerToggles';
import { GroupPanel } from '../groups/GroupPanel';

export const Viewport = ({ groupId }: { groupId?: string }) => {
  const [quickSensor, setQuickSensor] = useState<{
    key: string;
    hold: LightHold;
  } | null>(null);
  const [quickLight, setQuickLight] = useState<{
    key: string;
    hold: LightHold;
    keys?: string[];
  } | null>(null);
  const healthQuery = useDeviceHealth();
  const healthByDevice = healthQuery.isError
    ? undefined
    : healthQuery.data?.devices;
  const devicesState = useDevicesState();
  const liveGroups = useGroupsState();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const { data: deviceSensorConfigs } = useDeviceSensorConfigs();
  const { data: floorplans } = useFloorplans();
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(
    null,
  );
  const [pixiFallbackReason, setPixiFallbackReason] = useState<string | null>(
    null,
  );
  const [visibleLayers, setVisibleLayers] = useState<FloorplanLayers>({
    lights: true,
    sensors: true,
    groups: true,
  });
  const [viewOpen, setViewOpen] = useState(false);
  const [labelOverrides, setLabelOverrides] = useState<
    Partial<FloorplanLayers>
  >({});
  const [activeSensorKey, setActiveSensorKey] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [tabs, setTabs] = useState<HTMLElement | null>(null);
  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();
  const {
    state: sheetDeviceKeys,
    open: deviceOpen,
    presentation,
    setState: setDeviceModalState,
    setOpen: setDeviceModalOpen,
    setPresentation,
    selecting,
    setSelecting,
  } = useDeviceModalState();

  useEffect(() => {
    setQuickLight(null);
    setQuickSensor(null);
  }, [groupId, selectedFloorplanId]);

  const effectiveSelectedFloorplanId =
    floorplans.find((floorplan) => floorplan.id === selectedFloorplanId)?.id ??
    floorplans[0]?.id ??
    null;
  const storedFloorplan = useStoredFloorplan(
    effectiveSelectedFloorplanId ?? undefined,
  );
  const { grid: floorplanGrid, imageUrl } = storedFloorplan;
  const labels = { ...floorplanLabels(floorplanGrid), ...labelOverrides };
  const floorplanImage = useImageState(imageUrl);
  const placedDeviceKeys = useMemo(
    () => floorplanGrid?.devices.map((device) => device.deviceKey) ?? [],
    [floorplanGrid],
  );
  const liveDevices = useDevicesByKeysState(placedDeviceKeys);
  const allDevices = Object.values(excludeUndefined(liveDevices ?? undefined));
  const groups = excludeUndefined(liveGroups ?? undefined);
  const [groupFilterId, setGroupFilterId] = useState<string | null>(
    groupId ?? null,
  );
  const [groupPanelOpen, setGroupPanelOpen] = useState(true);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(
    groupId ?? null,
  );
  useEffect(() => {
    setGroupFilterId(groupId ?? null);
    setActiveGroupId(groupId ?? null);
    setGroupPanelOpen(true);
    setSelectedFloorplanId(null);
    setActiveSensorKey(null);
    setSelecting(false);
    setSelectedDevices([]);
  }, [groupId, setSelectedDevices, setSelecting]);
  const groupDeviceKeys = useMemo(
    () =>
      groupFilterId
        ? resolveGroupDeviceKeys(groupFilterId, liveGroups ?? {})
        : [],
    [groupFilterId, liveGroups],
  );
  const groupFilterKeys = groupFilterId ? new Set(groupDeviceKeys) : null;
  const { floorplans: allFloorplans } = useAllFloorplans();
  const defaultFloorplanId = useMemo(() => {
    if (!groupFilterId) return null;
    return (
      selectGroupFloorplan(groupFilterId, groupDeviceKeys, allFloorplans)
        ?.floorplan.id ?? null
    );
  }, [groupFilterId, groupDeviceKeys, allFloorplans]);
  useEffect(() => {
    if (selectedFloorplanId === null && defaultFloorplanId)
      setSelectedFloorplanId(defaultFloorplanId);
  }, [defaultFloorplanId, selectedFloorplanId]);
  const visibleDevices = allDevices.filter(
    (device) =>
      (!groupFilterKeys || groupFilterKeys.has(getDeviceKey(device))) &&
      ('Controllable' in device.data
        ? visibleLayers.lights
        : 'Sensor' in device.data
          ? visibleLayers.sensors
          : true),
  );
  const deviceDisplayNameMap = useMemo(
    () =>
      Object.fromEntries(
        deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
      ),
    [deviceDisplayNames],
  );
  const deviceSensorConfigMap = useMemo(
    () =>
      Object.fromEntries(
        deviceSensorConfigs.map((row) => [row.device_ref, row]),
      ),
    [deviceSensorConfigs],
  );
  const floorplanScene = buildFloorplanScene({
    healthByDevice,
    grid: floorplanGrid,
    image: floorplanImage,
    devices: visibleDevices,
    groups,
    displayNames: deviceDisplayNameMap,
    includeGroups: visibleLayers.groups,
  });
  floorplanScene.labelVisibility = labels;
  const activeSensor = activeSensorKey
    ? (devicesState?.[activeSensorKey] ?? null)
    : null;
  const inspectorOpen =
    (deviceOpen && presentation === 'floorplan') || activeSensor !== null;
  const groupPanelVisible = Boolean(
    activeGroupId &&
    groups[activeGroupId] &&
    groupPanelOpen &&
    !inspectorOpen &&
    !selecting,
  );

  useEffect(() => {
    setToolbar(document.getElementById('floorplan-toolbar'));
    setTabs(document.getElementById('floorplan-tabs'));
    return () => {
      setDeviceModalOpen(false);
      setSelectedDevices([]);
      setSelecting(false);
    };
  }, [setDeviceModalOpen, setSelectedDevices, setSelecting]);

  // Selection changes update the existing inspector instead of opening another panel.
  useEffect(() => {
    if (!selecting) return;
    setGroupPanelOpen(false);
    setDeviceModalState(selectedDevices);
    setPresentation('floorplan');
    setDeviceModalOpen(selectedDevices.length > 0);
  }, [
    selecting,
    selectedDevices,
    setDeviceModalState,
    setPresentation,
    setDeviceModalOpen,
  ]);

  const openGroup = (groupId: string) => {
    if (!groupId) return;
    setQuickLight(null);
    setQuickSensor(null);
    setActiveSensorKey(null);
    setSelecting(false);
    setSelectedDevices([]);
    setDeviceModalOpen(false);
    setActiveGroupId(groupId);
    setGroupPanelOpen(true);
  };
  const openDevice = (keys: string[]) => {
    if (keys.length === 0) return;
    setActiveSensorKey(null);
    setDeviceModalState(keys);
    setPresentation('floorplan');
    setDeviceModalOpen(true);
  };
  useEffect(() => {
    if (selecting && selectedDevices.length === 0) {
      setSelecting(false);
      setDeviceModalOpen(false);
    }
  }, [selecting, selectedDevices, setDeviceModalOpen, setSelecting]);
  const selectLight = (key: string) => {
    setActiveSensorKey(null);
    const current = selecting
      ? selectedDevices
      : deviceOpen
        ? sheetDeviceKeys
        : [];
    const next =
      selecting && current.includes(key)
        ? current.filter((k) => k !== key)
        : [...new Set([...current, key])];
    setSelectedDevices(next);
    setSelecting(next.length > 0);
    setDeviceModalOpen(next.length > 0);
    if (next.length) {
      setDeviceModalState(next);
      setPresentation('floorplan');
    }
  };
  const clearSelection = () => {
    setSelecting(false);
    setSelectedDevices([]);
    setDeviceModalOpen(false);
  };
  const toggleGroup = (groupId: string) => {
    const keys = resolveGroupDeviceKeys(groupId, liveGroups ?? {});
    const remove = keys.some((key) => selectedDevices.includes(key));
    setSelectedDevices(
      remove
        ? selectedDevices.filter((key) => !keys.includes(key))
        : [...new Set([...selectedDevices, ...keys])],
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {tabs &&
        floorplans.length > 1 &&
        createPortal(
          <Tabs
            value={effectiveSelectedFloorplanId ?? ''}
            onValueChange={(id) => {
              clearSelection();
              setActiveSensorKey(null);
              setGroupPanelOpen(false);
              setSelectedFloorplanId(id);
              setPixiFallbackReason(null);
            }}
            className="min-w-0"
          >
            <div className="min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList
                aria-label="Floorplans"
                className="h-11 w-max justify-start bg-transparent p-0"
              >
                {floorplans.map((floorplan) => (
                  <TabsTrigger
                    key={floorplan.id}
                    value={floorplan.id}
                    className="h-11 shrink-0 px-2 text-xs"
                  >
                    {floorplan.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>,
          tabs,
        )}
      {toolbar &&
        floorplans.length > 0 &&
        createPortal(
          <>
            <Popover open={viewOpen} onOpenChange={setViewOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Floorplan view options"
                  title="View options"
                  className="relative"
                >
                  <SlidersHorizontal />
                  {Object.values(visibleLayers).some((visible) => !visible) ? (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="space-y-4">
                <FloorplanLayerToggles
                  label="Show on floorplan"
                  value={visibleLayers}
                  onChange={setVisibleLayers}
                />
                <FloorplanLayerToggles
                  label="Labels"
                  value={labels}
                  onChange={(next) => setLabelOverrides(next)}
                />
                {Object.keys(labelOverrides).length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setLabelOverrides({})}
                  >
                    Use floorplan label defaults
                  </Button>
                )}
                {Object.keys(groups).length > 0 ? (
                  <label className="block space-y-2 text-sm">
                    <span>Group filter</span>
                    <SettingsSelect
                      aria-label="Group filter"
                      className="w-full"
                      value={groupFilterId ? `group:${groupFilterId}` : 'all'}
                      onValueChange={(value) => {
                        setGroupFilterId(
                          value === 'all' ? null : value.slice(6),
                        );
                        setSelectedFloorplanId(null);
                        clearSelection();
                        setActiveSensorKey(null);
                      }}
                      options={[
                        { value: 'all', label: 'All devices' },
                        ...Object.entries(groups)
                          .sort(([, a], [, b]) =>
                            (a.name ?? '').localeCompare(b.name ?? ''),
                          )
                          .map(([id, group]) => ({
                            value: `group:${id}`,
                            label: group.name ?? id,
                          })),
                      ]}
                    />
                  </label>
                ) : null}
                <label className="block space-y-2 text-sm">
                  <span>Open device or group</span>
                  <SettingsSelect
                    aria-label="Open device or group"
                    className="w-full"
                    value=""
                    onValueChange={(value) => {
                      setViewOpen(false);
                      clearSelection();
                      if (value.startsWith('group:')) openGroup(value.slice(6));
                      else {
                        const key = value.slice(7);
                        if (
                          devicesState?.[key] &&
                          'Sensor' in devicesState[key]!.data
                        )
                          setActiveSensorKey(key);
                        else openDevice([key]);
                      }
                    }}
                    options={[
                      ...Object.entries(groups)
                        .filter(([id]) =>
                          resolveGroupDeviceKeys(id, liveGroups ?? {}).some(
                            (key) => placedDeviceKeys.includes(key),
                          ),
                        )
                        .map(([id, group]) => ({
                          value: `group:${id}`,
                          label: `Room · ${group.name ?? id}`,
                        })),
                      ...visibleDevices.map((device) => ({
                        value: `device:${getDeviceKey(device)}`,
                        label: getDeviceDisplayLabel(
                          device,
                          deviceDisplayNameMap,
                        ),
                      })),
                    ]}
                  />
                </label>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    if (selecting) clearSelection();
                    else {
                      setSelecting(true);
                      setActiveSensorKey(null);
                    }
                    setViewOpen(false);
                  }}
                >
                  {selecting ? 'Finish selecting' : 'Select devices'}
                </Button>
                {activeGroupId && groups[activeGroupId] && !groupPanelOpen ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      openGroup(activeGroupId);
                      setViewOpen(false);
                    }}
                  >
                    Show room controls
                  </Button>
                ) : null}
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/config/floorplan">Edit floorplan</Link>
                </Button>
                <details className="text-sm">
                  <summary className="cursor-pointer py-1 font-medium">
                    Map help
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Tap a device or group to open controls. Drag to pan and
                    pinch to zoom. Hold a light for quick controls; with a
                    selection active, hold a selected light to adjust the
                    selection. Use Select in quick controls or the device panel
                    to start selecting. Ctrl-click also selects. Hold a group to
                    select its devices.
                  </p>
                </details>
              </PopoverContent>
            </Popover>
          </>,
          toolbar,
        )}

      {quickLight && devicesState?.[quickLight.key] && (
        <LightQuickPopover
          key={
            quickLight.hold.pointerId +
            ':' +
            quickLight.hold.x +
            ':' +
            quickLight.hold.y
          }
          device={devicesState[quickLight.key]!}
          devices={quickLight.keys?.flatMap((key) =>
            devicesState[key] ? [devicesState[key]!] : [],
          )}
          anchor={quickLight.hold}
          hold={quickLight.hold}
          displayNames={deviceDisplayNameMap}
          onClose={() => setQuickLight(null)}
          onDetails={() => openDevice(quickLight.keys ?? [quickLight.key])}
          onSelect={selecting ? undefined : () => selectLight(quickLight.key)}
        />
      )}
      {quickSensor && devicesState?.[quickSensor.key] && (
        <SensorQuickPopover
          device={devicesState[quickSensor.key]!}
          anchor={quickSensor.hold}
          hold={quickSensor.hold}
          sensorConfig={deviceSensorConfigMap[quickSensor.key]}
          onClose={() => setQuickSensor(null)}
          onDetails={() => {
            setDeviceModalOpen(false);
            setActiveSensorKey(quickSensor.key);
          }}
        />
      )}
      <div className="relative min-h-0 min-w-0 flex-1">
        {pixiFallbackReason === null &&
        floorplanScene.width > 0 &&
        floorplanScene.height > 0 ? (
          <PixiFloorplanRenderer
            key={effectiveSelectedFloorplanId ?? 'default'}
            scene={floorplanScene}
            fitOnResize
            renderLabels
            selectedDeviceKeys={selectedDevices}
            onDevicePress={(key, modifiers) =>
              selecting || modifiers?.ctrlKey
                ? selectLight(key)
                : openDevice([key])
            }
            onDeviceHold={(key, hold) => {
              setQuickSensor(null);
              setQuickLight({
                key,
                hold,
                keys:
                  selecting && selectedDevices.includes(key)
                    ? selectedDevices
                    : undefined,
              });
              setActiveSensorKey(null);
            }}
            onSensorHold={(key, hold) => {
              setQuickLight(null);
              setQuickSensor({ key, hold });
            }}
            onSensorPress={(key) => {
              if (selecting) {
                toggleSelectedDevice(key);
                return;
              }
              setDeviceModalOpen(false);
              setActiveSensorKey(key);
            }}
            onGroupPress={(id) => (selecting ? toggleGroup(id) : openGroup(id))}
            onGroupLongPress={(id) => {
              setGroupPanelOpen(false);
              setSelecting(true);
              setActiveSensorKey(null);
              toggleGroup(id);
            }}
            onContextLost={() =>
              setPixiFallbackReason(
                'The graphics connection was lost. Device controls are still available.',
              )
            }
            onUnavailable={() =>
              setPixiFallbackReason(
                'The floorplan could not be displayed. Try a browser with WebGL support.',
              )
            }
          />
        ) : (
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-sm text-muted-foreground">
                  {pixiFallbackReason ??
                    (storedFloorplan.isLoading
                      ? 'Loading floorplan…'
                      : storedFloorplan.isError
                        ? 'The floorplan could not be loaded. Device controls are still available.'
                        : 'No floorplan is available. Devices can still be controlled here.')}
                </p>
                {(pixiFallbackReason || storedFloorplan.isError) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPixiFallbackReason(null);
                      if (storedFloorplan.isError)
                        void storedFloorplan.refetch();
                    }}
                  >
                    Retry map
                  </Button>
                )}
                <Link
                  className="text-sm text-primary underline"
                  to={
                    groupId
                      ? `/groups/${encodeURIComponent(groupId)}`
                      : '/groups'
                  }
                >
                  Room controls
                </Link>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {Object.entries(devicesState ?? {})
                  .filter(
                    ([key, device]) =>
                      device &&
                      (!groupFilterKeys || groupFilterKeys.has(key)) &&
                      ('Controllable' in device.data
                        ? visibleLayers.lights
                        : 'Sensor' in device.data
                          ? visibleLayers.sensors
                          : true),
                  )
                  .map(
                    ([key, device]) =>
                      device &&
                      ('Controllable' in device.data ? (
                        <DeviceRow
                          presentation="floorplan"
                          key={key}
                          device={device}
                          displayNames={deviceDisplayNameMap}
                        />
                      ) : (
                        <LiveSensorRow
                          key={key}
                          device={device}
                          displayNames={deviceDisplayNameMap}
                        />
                      )),
                  )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={
          inspectorOpen || selecting || groupPanelVisible
            ? 'flex shrink-0 flex-col md:w-80 lg:w-96'
            : 'contents'
        }
      >
        {deviceOpen &&
          presentation === 'floorplan' &&
          !selecting &&
          sheetDeviceKeys.some(
            (key) =>
              devicesState?.[key] && 'Controllable' in devicesState[key]!.data,
          ) && (
            <div className="flex justify-end border-t border-border bg-background px-3 py-1 md:border-l md:border-t-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedDevices(sheetDeviceKeys);
                  setSelecting(true);
                  setActiveSensorKey(null);
                }}
              >
                <MousePointer2 className="size-4" /> Select devices
              </Button>
            </div>
          )}
        <div
          id="floorplan-inspector"
          className={
            inspectorOpen || groupPanelVisible
              ? 'min-h-0 md:flex-1 [&>section]:md:h-full'
              : 'hidden'
          }
        />
      </div>
      {groupPanelVisible && activeGroupId ? (
        <GroupPanel
          key={activeGroupId}
          groupId={activeGroupId}
          onSelect={(keys) => {
            setSelectedDevices(keys);
            setSelecting(true);
            setActiveSensorKey(null);
          }}
          onClose={() => setGroupPanelOpen(false)}
        />
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
        presentation="floorplan"
      />
    </div>
  );
};

export default Viewport;
