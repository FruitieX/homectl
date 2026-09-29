import { lazy, Suspense, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, Map, SlidersHorizontal } from 'lucide-react';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { useAllFloorplans } from '@/hooks/useStoredFloorplan';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { configItemHref } from '@/lib/configItemHref';
import {
  resolveGroupDeviceKeys,
  selectGroupFloorplan,
} from '@/lib/group-floorplan-preview';
import { DeviceRow, DevicePowerToggle } from '@/ui/DeviceControls';
import { LiveAttention } from '@/ui/LiveAttention';
import { LiveSensorRow } from '@/ui/LiveSensorRow';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { GroupFloorplanPreview } from '@/ui/floorplan/GroupFloorplanPreview';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { SceneList } from './[id]/SceneList';

const Floorplan = lazy(() => import('../map/Viewport'));
const panel =
  'min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5';

/** The room opens with controls. The full map is a related, addressable view. */
export default function GroupViewport() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const groups = useGroupsState();
  const state = useDevicesState();
  const group = groups?.[id];
  const modal = useDeviceModalState();
  const capture = useSaveSceneModalState();
  const [, selectDevices] = useSelectedDevices();
  const { advanced } = useSettingsPreferences();
  const { data: overrides } = useDeviceDisplayNames();
  const names = useMemo(
    () =>
      Object.fromEntries(
        overrides.map((row) => [row.device_key, row.display_name]),
      ),
    [overrides],
  );
  const { floorplans } = useAllFloorplans();
  const keys = useMemo(
    () => resolveGroupDeviceKeys(id, groups ?? {}),
    [id, groups],
  );
  const placement = useMemo(
    () => selectGroupFloorplan(id, keys, floorplans),
    [id, keys, floorplans],
  );
  const devices = keys.flatMap((key) => (state?.[key] ? [state[key]!] : []));
  const controls = devices.filter((device) => 'Controllable' in device.data);
  const sensors = devices.filter((device) => 'Sensor' in device.data);
  const writable = controls.filter((device) => !isDeviceReadOnly(device));
  const on = writable.filter(
    (device) =>
      'Controllable' in device.data && device.data.Controllable.state.power,
  ).length;
  const missing = keys.filter((key) => !state?.[key]);
  useAssistantPageContext(
    group ? { kind: 'group', id, label: group.name } : { kind: 'group' },
  );

  if (!groups || !state)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading room…
      </p>
    );
  if (!group)
    return (
      <EmptyState
        title="Room not found"
        description="It may have been removed or the link may be out of date."
        action={
          <Button asChild>
            <Link to="/groups">Browse rooms</Link>
          </Button>
        }
      />
    );
  if (params.get('view') === 'floorplan')
    return (
      <Suspense
        fallback={
          <p role="status" className="p-6 text-sm">
            Loading floorplan…
          </p>
        }
      >
        <Floorplan groupId={id} />
      </Suspense>
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/15 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {group.name}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {controls.length} controllable{' '}
              {controls.length === 1 ? 'device' : 'devices'} · {sensors.length}{' '}
              {sensors.length === 1 ? 'sensor' : 'sensors'}
              {missing.length ? ` · ${missing.length} unavailable` : ''}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={configItemHref('group', id)}>
              Room settings
              <ExternalLink />
            </Link>
          </Button>
        </div>
        <LiveAttention deviceKeys={keys} />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
          <div className="space-y-5">
            <section className={panel} aria-label="Room controls">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Devices</h2>
                {controls.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      modal.setState(controls.map(getDeviceKey));
                      modal.setPresentation('sidepanel');
                      modal.setOpen(true);
                    }}
                  >
                    <SlidersHorizontal />
                    Adjust together
                  </Button>
                )}
              </div>
              {controls.length > 0 && (
                <div className="flex items-center gap-3">
                  <LiveStatePreview
                    states={[
                      ...controls.map(devicePreviewState),
                      ...missing.map(() => undefined),
                    ]}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-medium">
                      {on} of {writable.length} on
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {controls.length - writable.length > 0
                        ? `${controls.length - writable.length} read-only or disabled`
                        : 'Live state'}
                    </p>
                  </div>
                  <DevicePowerToggle devices={controls} label={group.name} />
                </div>
              )}
              {keys.length > 0 && (
                <div className="border-y border-border py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">Scenes</h3>
                    <Link
                      className="text-xs text-primary underline"
                      to="/config/scenes"
                    >
                      Manage scenes
                    </Link>
                  </div>
                  <SceneList
                    deviceKeys={keys}
                    compact
                    layout="strip"
                    allowPins={false}
                  />
                </div>
              )}
              <div className="divide-y divide-border">
                {controls.map((device) => (
                  <DeviceRow
                    key={getDeviceKey(device)}
                    device={device}
                    displayNames={names}
                    inlineBrightness
                    plain
                  />
                ))}
                {missing.map((key) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3"
                  >
                    <LiveStatePreview states={[]} />
                    <span className="min-w-0 flex-1 break-words text-sm">
                      {names[key] ?? key}
                      <small className="block text-muted-foreground">
                        Unavailable · no live state
                      </small>
                    </span>
                    <Link
                      className="shrink-0 text-xs text-primary underline"
                      to={configItemHref('device', key)}
                    >
                      Details
                    </Link>
                  </div>
                ))}
              </div>
              {!controls.length && !missing.length && (
                <p className="text-sm text-muted-foreground">
                  No controllable devices in this room.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Live controls apply immediately. Scene adjustments follow each
                device's scene-saving preference.
              </p>
              {writable.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    selectDevices(keys);
                    capture.setOpen(true);
                  }}
                >
                  Save as scene
                </Button>
              )}
            </section>
            {!keys.length && (
              <EmptyState
                title="No devices in this room yet"
                action={
                  <Button asChild variant="outline">
                    <Link to={configItemHref('group', id)}>
                      Add room members
                    </Link>
                  </Button>
                }
              />
            )}
          </div>
          <div className="space-y-5">
            <section className={panel} aria-label="Room sensors">
              <h2 className="text-base font-semibold">Sensors</h2>
              {sensors.length ? (
                <div className="space-y-2">
                  {sensors.map((device) => (
                    <LiveSensorRow
                      key={getDeviceKey(device)}
                      device={device}
                      displayNames={names}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No sensors assigned to this room.
                </p>
              )}
            </section>
            {placement && (
              <section className={panel}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">Floorplan</h2>
                  <Link
                    to="?view=floorplan"
                    className="inline-flex items-center gap-1 text-xs text-primary underline"
                  >
                    <Map className="size-3.5" />
                    Open
                  </Link>
                </div>
                <Link
                  to="?view=floorplan"
                  aria-label={`Open ${group.name} floorplan`}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <GroupFloorplanPreview
                    groupId={id}
                    group={group}
                    className="h-48 rounded-lg"
                  />
                </Link>
              </section>
            )}
            {advanced && (
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                Group: {id} · Includes nested group members
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
