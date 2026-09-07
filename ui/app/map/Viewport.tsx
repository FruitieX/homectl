import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
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
import { useStoredFloorplan } from '@/hooks/useStoredFloorplan';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';

type FloorplanMode = 'all' | 'lights' | 'sensors';

export const Viewport = () => {
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
  const [activeSensorKey, setActiveSensorKey] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
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
  const visibleDevices = allDevices.filter((device) =>
    floorplanMode === 'lights'
      ? 'Controllable' in device.data
      : floorplanMode === 'sensors'
        ? 'Sensor' in device.data
        : true,
  );
  const groups = excludeUndefined(liveGroups ?? undefined);
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
  const activeSensor = activeSensorKey
    ? (devicesState?.[activeSensorKey] ?? null)
    : null;
  const inspectorOpen =
    (deviceOpen && presentation === 'floorplan') || activeSensor !== null;

  useEffect(() => {
    setToolbar(document.getElementById('floorplan-toolbar'));
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
      {toolbar &&
        floorplans.length > 0 &&
        createPortal(
          <>
            {floorplans.length > 1 && (
              <Select
                value={effectiveSelectedFloorplanId ?? ''}
                onValueChange={(id) => {
                  clearSelection();
                  setActiveSensorKey(null);
                  setSelectedFloorplanId(id);
                  setPixiFallbackReason(null);
                }}
              >
                <SelectTrigger
                  aria-label="Floorplan"
                  className="h-9 max-w-36 border-0 bg-transparent sm:max-w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {floorplans.map((floorplan) => (
                    <SelectItem key={floorplan.id} value={floorplan.id}>
                      {floorplan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Popover open={viewOpen} onOpenChange={setViewOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Floorplan view options"
                >
                  <SlidersHorizontal />
                  View
                  {floorplanMode !== 'all' ? (
                    <span className="size-1.5 rounded-full bg-primary" />
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="space-y-4">
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
            onGroupPress={(id) =>
              selecting
                ? toggleGroup(id)
                : openDevice(groups[id]?.device_keys ?? [])
            }
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
          inspectorOpen || selecting
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
            inspectorOpen ? 'min-h-0 md:flex-1 [&>section]:md:h-full' : 'hidden'
          }
        />
      </div>
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
