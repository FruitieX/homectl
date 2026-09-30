import { Link } from 'react-router-dom';
import { useDevicesState, useGroupsState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { resolveGroupDeviceKeys } from '@/lib/group-floorplan-preview';
import { configItemHref } from '@/lib/configItemHref';
import { DeviceQuickControls, DeviceRow } from '@/ui/DeviceControls';
import { LiveSensorRow } from '@/ui/LiveSensorRow';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { LiveAttention } from '@/ui/LiveAttention';
import { FloorplanInspector } from '@/ui/FloorplanInspector';
import { SceneList } from './[id]/SceneList';

/** The floorplan keeps map context while exposing the same room controls. */
export function GroupPanel({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const groups = useGroupsState(),
    state = useDevicesState();
  const { data: overrides } = useDeviceDisplayNames();
  const names = Object.fromEntries(
    overrides.map((row) => [row.device_key, row.display_name]),
  );
  const group = groups?.[groupId];
  if (!group) return null;
  const keys = resolveGroupDeviceKeys(groupId, groups ?? {});
  const devices = keys.flatMap((key) => (state?.[key] ? [state[key]!] : []));
  const controls = devices.filter((d) => 'Controllable' in d.data);
  return (
    <FloorplanInspector title={group.name} onClose={onClose}>
      <div className="space-y-4 px-3 pb-3 md:px-0 md:pb-0">
        <div className="flex items-center gap-3">
          <LiveStatePreview
            states={[
              ...controls.map(devicePreviewState),
              ...keys.filter((key) => !state?.[key]).map(() => undefined),
            ]}
          />
          <span className="text-xs text-muted-foreground">
            {devices.length} devices
            {keys.length > devices.length
              ? ` · ${keys.length - devices.length} unavailable`
              : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            className="text-primary underline"
            to={`/groups/${encodeURIComponent(groupId)}`}
            onClick={onClose}
          >
            Room details
          </Link>
          <Link
            className="text-primary underline"
            to={configItemHref('group', groupId)}
            onClick={onClose}
          >
            Room settings
          </Link>
        </div>
        <LiveAttention deviceKeys={keys} />
        <DeviceQuickControls key={groupId} devices={controls} />
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Scenes</h3>
          <SceneList deviceKeys={keys} compact />
        </section>
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Devices</h3>
          {keys.map((key) => {
            const device = state?.[key];
            return device ? (
              'Controllable' in device.data ? (
                <DeviceRow
                  key={key}
                  device={device}
                  displayNames={names}
                  presentation="floorplan"
                />
              ) : (
                <LiveSensorRow key={key} device={device} displayNames={names} />
              )
            ) : (
              <Link
                key={key}
                className="block text-sm text-primary underline"
                to={configItemHref('device', key)}
              >
                {names[key] ?? key} · Unavailable
              </Link>
            );
          })}
          {!keys.length && (
            <p className="text-sm text-muted-foreground">
              No devices in this room yet.
            </p>
          )}
        </section>
      </div>
    </FloorplanInspector>
  );
}
export default GroupPanel;
