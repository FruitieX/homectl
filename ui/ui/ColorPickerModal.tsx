import { useUserTimers } from '@/hooks/useUserTimers';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import {
  useDevicesState,
  useGroupsState,
  useScenesState,
  useConnectionStatus,
  useWebsocket,
} from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { resolveGroupDeviceKeys } from '@/lib/group-floorplan-preview';
import { configItemHref } from '@/lib/configItemHref';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { DeviceQuickControls } from '@/ui/DeviceControls';
import { DeviceReportStatus } from '@/ui/DeviceReportStatus';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { SceneList } from 'app/groups/[id]/SceneList';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Button } from '@/ui/primitives/button';

/** One shared control composition for rooms, widgets and floorplan selections. */
export function ColorPickerModal() {
  const modal = useDeviceModalState();
  const devices = useDevicesState();
  const timers = useUserTimers({ enabled: modal.open });
  const groups = useGroupsState();
  const scenes = useScenesState();
  const connected = useConnectionStatus() === 'connected';
  const ws = useWebsocket();
  const { advanced } = useSettingsPreferences();
  const { data: overrides } = useDeviceDisplayNames();
  const names = Object.fromEntries(
    overrides.map((row) => [row.device_key, row.display_name]),
  );
  const capture = useSaveSceneModalState();
  const [, setSelectedDevices] = useSelectedDevices();
  const [showAll, setShowAll] = useState(false);
  const [overridePending, setOverridePending] = useState<boolean | null>(null);
  const [overrideError, setOverrideError] = useState('');
  const initialSelection = useRef<string[]>([]);
  useEffect(() => {
    if (!modal.open) {
      initialSelection.current = [];
      setOverridePending(null);
    } else if (modal.state.length > 1 && !initialSelection.current.length)
      initialSelection.current = modal.state;
  }, [modal.open, modal.state]);
  const selected = modal.state.flatMap((key) =>
    devices?.[key] ? [devices[key]!] : [],
  );
  const writable = selected.filter((device) => !isDeviceReadOnly(device));
  const activeGroup = Object.entries(groups ?? {}).find(([id]) => {
    const keys = resolveGroupDeviceKeys(id, groups ?? {});
    return (
      keys.length === modal.state.length &&
      keys.every((key) => modal.state.includes(key))
    );
  });
  const title =
    activeGroup?.[1]?.name ??
    (modal.state.length === 1
      ? selected[0]
        ? getDeviceDisplayLabel(selected[0], names)
        : 'Unavailable device'
      : `${modal.state.length} devices`);
  const withScenes = writable.filter(
    (d) =>
      'Controllable' in d.data &&
      d.data.Controllable.scene_id &&
      scenes?.[d.data.Controllable.scene_id],
  );
  const persisted = withScenes.filter(
    (d) =>
      'Controllable' in d.data &&
      scenes?.[d.data.Controllable.scene_id!]?.active_overrides.includes(
        `${d.integration_id}/${d.id}`,
      ),
  );
  const allPersist =
    withScenes.length > 0 && persisted.length === withScenes.length;
  useEffect(() => {
    if (overridePending === null) return;
    if (!connected) {
      setOverrideError(
        'Connection lost. Check the scene autosave setting after reconnecting.',
      );
      setOverridePending(null);
      return;
    }
    if (
      (overridePending && allPersist) ||
      (!overridePending && !persisted.length)
    ) {
      setOverridePending(null);
      return;
    }
    const timer = setTimeout(() => {
      setOverridePending(null);
      setOverrideError(
        'No updated autosave setting received. Check before trying again.',
      );
    }, 10000);
    return () => clearTimeout(timer);
  }, [overridePending, allPersist, persisted.length, connected]);
  function toggleAutosave() {
    if (!connected || !ws || !withScenes.length) return;
    setOverrideError('');
    setOverridePending(!allPersist);
    ws.send(
      JSON.stringify({
        EventMessage: {
          Action: {
            action: 'ToggleDeviceOverride',
            device_keys: withScenes.map((d) => `${d.integration_id}/${d.id}`),
            override_state: !allPersist,
          },
        },
      }),
    );
  }
  const close = () => modal.setOpen(false);
  return (
    <ResponsiveOverlay
      open={modal.open}
      onOpenChange={modal.setOpen}
      title={title}
      desktopPresentation={modal.presentation}
      className="max-w-2xl"
      description={`${modal.state.length} selected ${modal.state.length === 1 ? 'device' : 'devices'}. Controls apply immediately.`}
    >
      <div className="space-y-4 px-3 pb-3 md:px-0 md:pb-0">
        <div className="flex items-center gap-3">
          <LiveStatePreview
            states={modal.state.map((key) =>
              devices?.[key] ? devicePreviewState(devices[key]!) : undefined,
            )}
          />
          <span className="flex-1 text-xs text-muted-foreground">
            {persisted.length
              ? `Scene autosave on for ${persisted.length} devices. Changes update their scene overrides.`
              : 'Manual changes leave saved scene targets unchanged.'}
          </span>
          <DeviceReportStatus devices={selected} />
        </div>
        {!connected && (
          <p role="status" className="text-sm text-destructive">
            Disconnected. Controls will be available when the connection
            returns.
          </p>
        )}
        {modal.state.length > selected.length && (
          <p role="status" className="text-sm text-muted-foreground">
            {modal.state.length - selected.length} selected devices are
            unavailable.
          </p>
        )}
        {initialSelection.current.length > 1 && (
          <label className="block text-xs text-muted-foreground">
            Apply controls to
            <select
              aria-label="Apply controls to"
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={modal.state.length === 1 ? modal.state[0] : 'selection'}
              onChange={(e) =>
                modal.setState(
                  e.target.value === 'selection'
                    ? initialSelection.current
                    : [e.target.value],
                )
              }
            >
              <option value="selection">
                All {initialSelection.current.length} selected devices
              </option>
              {initialSelection.current.map((key) => (
                <option key={key} value={key}>
                  {devices?.[key]
                    ? getDeviceDisplayLabel(devices[key]!, names)
                    : key + ' · unavailable'}
                </option>
              ))}
            </select>
          </label>
        )}
        <DeviceQuickControls key={modal.state.join(',')} devices={selected} />
        <section
          className="space-y-2 border-t border-border pt-3"
          aria-label="Scenes for selection"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Scenes</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={!writable.length}
              onClick={() => {
                setSelectedDevices(modal.state);
                close();
                capture.setOpen(true);
              }}
            >
              Capture scene
            </Button>
          </div>
          <SceneList deviceKeys={modal.state} showAll={showAll} compact />
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Include hidden scenes
          </label>
          {withScenes.length > 0 && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allPersist}
                disabled={!connected || overridePending !== null}
                onChange={toggleAutosave}
              />
              Scene autosave
              {overridePending !== null
                ? ' · Updating…'
                : persisted.length && !allPersist
                  ? ' · Mixed'
                  : ''}
            </label>
          )}
          {overrideError && (
            <p role="alert" className="text-xs text-destructive">
              {overrideError}
            </p>
          )}
        </section>
        {(timers.data?.timers ?? [])
          .filter((t) =>
            [t.definition.action, t.definition.finish_action].some(
              (a) => a?.kind === 'device' && modal.state.includes(a.device_key),
            ),
          )
          .map((t) => (
            <Link
              key={t.definition.id}
              to={`/config/timers?timer=${encodeURIComponent(t.definition.id)}`}
              onClick={close}
              className="flex min-h-11 items-center text-sm text-primary underline"
            >
              Timer · {t.definition.name}
            </Link>
          ))}
        <div className="flex flex-wrap gap-3 text-sm">
          {modal.state.length === 1 && (
            <Link
              to={`/config/timers?device=${encodeURIComponent(modal.state[0])}`}
              onClick={close}
              className="text-primary underline"
            >
              Schedule a timer
            </Link>
          )}
          {modal.state.length === 1 && (
            <Link
              className="text-primary underline"
              to={configItemHref('device', modal.state[0])}
              onClick={close}
            >
              Device settings
            </Link>
          )}
          {activeGroup && (
            <Link
              className="text-primary underline"
              to={`/groups/${encodeURIComponent(activeGroup[0])}`}
              onClick={close}
            >
              Room controls
            </Link>
          )}
        </div>
        {advanced && (
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            {modal.state.join(' · ')}
          </p>
        )}
      </div>
    </ResponsiveOverlay>
  );
}
