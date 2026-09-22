import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
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
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
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
import { Button } from '@/ui/primitives/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/primitives/popover';
import { Tabs, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Slider } from '@/ui/primitives/slider';
import { GroupPanel } from '../groups/GroupPanel';

type FloorplanMode = 'all' | 'lights' | 'sensors';

export const Viewport = ({ groupId }: { groupId?: string }) => {
  const navigate = useNavigate();
  const [, refreshHealth] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refreshHealth((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
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
  const [floorplanMode, setFloorplanMode] = useState<FloorplanMode>('all');
  const [selecting, setSelecting] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [labelMode, setLabelMode] = useState<
    'default' | 'none' | 'sensors' | 'lights' | 'all'
  >('default');
  const [activeSensorKey, setActiveSensorKey] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [tabs, setTabs] = useState<HTMLElement | null>(null);
  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const toggleSelectedDevice = useToggleSelectedDevice();
  const { setOpen: setSaveSceneOpen } = useSaveSceneModalState();
  const {
    open: deviceOpen,
    presentation,
    setState: setDeviceModalState,
    setOpen: setDeviceModalOpen,
    setPresentation,
  } = useDeviceModalState();

  const effectiveSelectedFloorplanId =
    floorplans.find((floorplan) => floorplan.id === selectedFloorplanId)?.id ??
    floorplans[0]?.id ??
    null;
  const { grid: floorplanGrid, imageUrl } = useStoredFloorplan(
    effectiveSelectedFloorplanId ?? undefined,
  );
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
  useEffect(() => {
    setGroupFilterId(groupId ?? null);
    setGroupPanelOpen(true);
    setSelectedFloorplanId(null);
    setActiveSensorKey(null);
    setSelecting(false);
    setSelectedDevices([]);
  }, [groupId, setSelectedDevices]);
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
      (floorplanMode === 'lights'
        ? 'Controllable' in device.data
        : floorplanMode === 'sensors'
          ? 'Sensor' in device.data
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
    grid: floorplanGrid,
    image: floorplanImage,
    devices: visibleDevices,
    groups,
    displayNames: deviceDisplayNameMap,
  });
  if (labelMode !== 'default') floorplanScene.labelMode = labelMode;
  const activeSensor = activeSensorKey
    ? (devicesState?.[activeSensorKey] ?? null)
    : null;
  const inspectorOpen =
    (deviceOpen && presentation === 'floorplan') || activeSensor !== null;
  const groupPanelVisible = Boolean(
    groupId && groupPanelOpen && !inspectorOpen,
  );

  useEffect(() => {
    setToolbar(document.getElementById('floorplan-toolbar'));
    setTabs(document.getElementById('floorplan-tabs'));
    return () => {
      setDeviceModalOpen(false);
      setSelectedDevices([]);
    };
  }, [setDeviceModalOpen, setSelectedDevices]);

  // Selection changes update the existing inspector instead of opening another panel.
  useEffect(() => {
    if (!selecting) return;
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
    // Groups open the same room view as the rooms list does.
    navigate(`/groups/${encodeURIComponent(groupId)}`);
  };
  const openDevice = (keys: string[]) => {
    if (keys.length === 0) return;
    setActiveSensorKey(null);
    setDeviceModalState(keys);
    setPresentation('floorplan');
    setDeviceModalOpen(true);
  };
  const clearSelection = () => {
    setSelecting(false);
    setSelectedDevices([]);
    setDeviceModalOpen(false);
  };
  const toggleGroup = (groupId: string) => {
    const keys = groups[groupId]?.device_keys ?? [];
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
              setSelectedFloorplanId(id);
              setPixiFallbackReason(null);
            }}
            className="min-w-0"
          >
            <div className="min-w-0 overflow-x-auto">
              <TabsList className="h-9 w-max justify-start bg-transparent p-0">
                {floorplans.map((floorplan) => (
                  <TabsTrigger
                    key={floorplan.id}
                    value={floorplan.id}
                    className="h-8 shrink-0 px-3 text-xs"
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
                  {floorplanMode !== 'all' ? (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="space-y-4">
                <label className="flex items-center justify-between gap-3 text-sm">
                  Device labels
                  <select
                    className="h-10 rounded-md border border-input bg-background px-2"
                    value={labelMode}
                    onChange={(event) =>
                      setLabelMode(event.target.value as typeof labelMode)
                    }
                  >
                    <option value="default">Floorplan default</option>
                    <option value="none">Hidden</option>
                    <option value="sensors">Sensors</option>
                    <option value="lights">Lights</option>
                    <option value="all">All devices</option>
                  </select>
                </label>
                {Object.keys(groups).length > 0 ? (
                  <label className="block space-y-2 text-sm">
                    <span>Group filter</span>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-2"
                      value={groupFilterId ?? ''}
                      onChange={(event) => {
                        setGroupFilterId(event.target.value || null);
                        setSelectedFloorplanId(null);
                        clearSelection();
                        setActiveSensorKey(null);
                      }}
                    >
                      <option value="">All devices</option>
                      {Object.entries(groups)
                        .sort(([, a], [, b]) =>
                          (a.name ?? '').localeCompare(b.name ?? ''),
                        )
                        .map(([id, group]) => (
                          <option key={id} value={id}>
                            {group.name ?? id}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
                <label className="block space-y-2 text-sm">
                  <span>Open device or group</span>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-2"
                    value=""
                    onChange={(event) => {
                      const value = event.target.value;
                      setViewOpen(false);
                      clearSelection();
                      if (value.startsWith('group:')) openGroup(value.slice(6));
                      else {
                        const key = value.slice(7);
                        if (
                          devicesState?.[key] &&
                          'Sensor' in devicesState[key]!.data
                        ) {
                          setActiveSensorKey(key);
                        } else openDevice([key]);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    <optgroup label="Groups">
                      {Object.entries(groups)
                        .filter(([, group]) =>
                          group.device_keys.some((key) =>
                            placedDeviceKeys.includes(key),
                          ),
                        )
                        .map(([id, group]) => (
                          <option key={id} value={`group:${id}`}>
                            {group.name ?? id}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Devices">
                      {Object.entries(liveDevices ?? {})
                        .filter(([, device]) => device !== undefined)
                        .map(([key, device]) => (
                          <option key={key} value={`device:${key}`}>
                            {getDeviceDisplayLabel(
                              device!,
                              deviceDisplayNameMap,
                            )}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </label>
                <div
                  role="group"
                  aria-label="Visible devices"
                  className="flex gap-1"
                >
                  {(['all', 'lights', 'sensors'] as const).map((mode) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={mode === floorplanMode ? 'secondary' : 'ghost'}
                      aria-pressed={mode === floorplanMode}
                      onClick={() => {
                        setFloorplanMode(mode);
                        setViewOpen(false);
                      }}
                    >
                      {mode === 'all'
                        ? 'All'
                        : mode === 'lights'
                          ? 'Lights'
                          : 'Sensors'}
                    </Button>
                  ))}
                </div>
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
                {groupId && !groupPanelOpen ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setGroupPanelOpen(true);
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
                    pinch to zoom. Long-press a device or group to start
                    selecting several devices.
                  </p>
                </details>
              </PopoverContent>
            </Popover>
          </>,
          toolbar,
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
            onDevicePress={(key) =>
              selecting ? toggleSelectedDevice(key) : openDevice([key])
            }
            onDeviceLongPress={(key) => {
              setSelecting(true);
              setActiveSensorKey(null);
              toggleSelectedDevice(key);
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
              setSelecting(true);
              setActiveSensorKey(null);
              toggleGroup(id);
            }}
            onUnavailable={() =>
              setPixiFallbackReason(
                'The floorplan could not be displayed. Try a browser with WebGL support.',
              )
            }
          />
        ) : pixiFallbackReason ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {pixiFallbackReason}
          </div>
        ) : null}
      </div>

      <div
        className={
          inspectorOpen || selecting || groupPanelVisible
            ? 'flex shrink-0 flex-col md:w-80 lg:w-96'
            : 'contents'
        }
      >
        {selecting && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-3 py-2 md:border-l md:border-t-0">
            <span className="min-w-0 flex-1 text-sm">
              {selectedDevices.length > 0
                ? `${selectedDevices.length} selected`
                : 'Tap devices to select'}
            </span>
            {selectedDevices.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDeviceModalOpen(false);
                  setSaveSceneOpen(true);
                }}
              >
                Save scene
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Done
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
      {groupPanelVisible && groupId ? (
        <GroupPanel
          key={groupId}
          groupId={groupId}
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
