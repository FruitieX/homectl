import { type Device } from '@/bindings/Device';
import { type FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import {
  Eye,
  Lightbulb,
  MousePointer2,
  Power,
  PowerOff,
  X,
} from 'lucide-react';

type GroupsById = Record<string, FlattenedGroupConfig>;
type DevicesByKey = Record<string, Device>;

interface FloorplanControlPanelProps {
  floorplanName?: string;
  placedDevices: Device[];
  devicesByKey: DevicesByKey;
  groups: GroupsById;
  selectedDeviceKeys: string[];
  activeGroupId: string | null;
  displayNames: Record<string, string>;
  onClearSelection: () => void;
  onCloseGroup: () => void;
  onOpenDetailedControls: (deviceKeys: string[]) => void;
  onSetPower: (deviceKeys: string[], power: boolean) => void;
}

function isControllable(device: Device) {
  return 'Controllable' in device.data;
}

function summarizeDevices(devices: Device[]) {
  const controllable = devices.filter(isControllable);
  const poweredOn = controllable.filter((device) =>
    getPower(device.data),
  ).length;
  const sensors = devices.length - controllable.length;

  return {
    controllable: controllable.length,
    poweredOn,
    poweredOff: controllable.length - poweredOn,
    sensors,
  };
}

function getDevicesByKeys(devicesByKey: DevicesByKey, deviceKeys: string[]) {
  return deviceKeys
    .map((deviceKey) => devicesByKey[deviceKey])
    .filter((device): device is Device => device !== undefined);
}

function DeviceStateBadge({ device }: { device: Device }) {
  if (!isControllable(device)) {
    return <Badge variant="outline">sensor</Badge>;
  }

  return getPower(device.data) ? (
    <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
      on
    </Badge>
  ) : (
    <Badge variant="muted">off</Badge>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-background/70 px-3 py-2">
      <div className="text-lg font-semibold leading-none text-foreground">
        {value}
      </div>
      <div className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function FloorplanControlPanel({
  floorplanName,
  placedDevices,
  devicesByKey,
  groups,
  selectedDeviceKeys,
  activeGroupId,
  displayNames,
  onClearSelection,
  onCloseGroup,
  onOpenDetailedControls,
  onSetPower,
}: FloorplanControlPanelProps) {
  const placedSummary = summarizeDevices(placedDevices);
  const activeGroup = activeGroupId ? groups[activeGroupId] : undefined;
  const activeGroupDevices = activeGroup
    ? getDevicesByKeys(devicesByKey, activeGroup.device_keys)
    : [];
  const activeGroupSummary = summarizeDevices(activeGroupDevices);
  const selectedDevices = getDevicesByKeys(devicesByKey, selectedDeviceKeys);
  const selectedControllableKeys = selectedDevices
    .filter(isControllable)
    .map(getDeviceKey);

  return (
    <>
      <Card className="pointer-events-auto absolute left-3 top-3 z-10 w-[min(calc(100%-1.5rem),22rem)] border-border/70 bg-card/90 shadow-xl backdrop-blur-xl sm:left-4 sm:top-4">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Floorplan controls</CardTitle>
              <CardDescription className="mt-1 wrap-break-word">
                {floorplanName ?? 'No floorplan selected'}
              </CardDescription>
            </div>
            <Badge variant="secondary">
              {selectedDeviceKeys.length} selected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            <SummaryPill label="on" value={placedSummary.poweredOn} />
            <SummaryPill label="off" value={placedSummary.poweredOff} />
            <SummaryPill label="sensors" value={placedSummary.sensors} />
            <SummaryPill label="groups" value={Object.keys(groups).length} />
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            <MousePointer2 className="size-4 shrink-0" />
            Tap a device for details. Long-press devices or groups to build a
            quick-control selection.
          </div>
        </CardContent>
      </Card>

      {selectedDeviceKeys.length > 0 ? (
        <div className="pointer-events-auto absolute bottom-28 left-3 right-3 z-20 mx-auto max-w-2xl rounded-3xl border border-border/70 bg-card/95 p-3 text-card-foreground shadow-2xl backdrop-blur-xl sm:bottom-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">
                {selectedDeviceKeys.length} selected device
                {selectedDeviceKeys.length === 1 ? '' : 's'}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedControllableKeys.length} can receive power commands.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={selectedControllableKeys.length === 0}
                onClick={() => onSetPower(selectedControllableKeys, true)}
              >
                <Power />
                On
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedControllableKeys.length === 0}
                onClick={() => onSetPower(selectedControllableKeys, false)}
              >
                <PowerOff />
                Off
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenDetailedControls(selectedDeviceKeys)}
              >
                <Eye />
                Details
              </Button>
              <Button size="sm" variant="ghost" onClick={onClearSelection}>
                <X />
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {activeGroup ? (
        <ResponsiveOverlay
          open
          onOpenChange={(open) => {
            if (!open) {
              onCloseGroup();
            }
          }}
          title={activeGroup.name}
          description={`${activeGroup.device_keys.length} devices in this group`}
          className="max-w-2xl"
        >
          <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
            <div className="grid grid-cols-4 gap-2 text-center">
              <SummaryPill label="on" value={activeGroupSummary.poweredOn} />
              <SummaryPill label="off" value={activeGroupSummary.poweredOff} />
              <SummaryPill
                label="lights"
                value={activeGroupSummary.controllable}
              />
              <SummaryPill label="sensors" value={activeGroupSummary.sensors} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onSetPower(activeGroup.device_keys, true)}>
                <Lightbulb />
                Turn group on
              </Button>
              <Button
                variant="outline"
                onClick={() => onSetPower(activeGroup.device_keys, false)}
              >
                <PowerOff />
                Turn group off
              </Button>
              <Button
                variant="secondary"
                onClick={() => onOpenDetailedControls(activeGroup.device_keys)}
              >
                <Eye />
                Detailed controls
              </Button>
            </div>

            <div className="space-y-2">
              {activeGroup.device_keys.map((deviceKey) => {
                const device = devicesByKey[deviceKey];
                return (
                  <div
                    key={deviceKey}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 p-3"
                  >
                    <div className="min-w-0">
                      <div className="wrap-break-word text-sm font-medium text-foreground">
                        {device
                          ? getDeviceDisplayLabel(device, displayNames)
                          : deviceKey}
                      </div>
                      <div className="wrap-break-word text-xs text-muted-foreground">
                        {deviceKey}
                      </div>
                    </div>
                    {device ? (
                      <DeviceStateBadge device={device} />
                    ) : (
                      <Badge variant="outline">missing</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </ResponsiveOverlay>
      ) : null}
    </>
  );
}
