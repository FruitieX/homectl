import { CalibrationAssignment } from '@/ui/settings/CalibrationAssignment';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppConfig } from '@/hooks/appConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useGroupsState } from '@/hooks/useDevicesApi';
import {
  useConfigDevices,
  useScenes,
  useGroups,
  useCalibrationProfiles,
  useCalibrationAssignments,
  useDeviceColorCalibrations,
} from '@/hooks/useConfig';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { getDeviceKey } from '@/lib/device';
import { configItemHref } from '@/lib/configItemHref';
import { entityDraftStore } from '@/lib/entityDraft';
import { canCalibrateDevice } from '@/lib/colorCalibration';
import { isDimmableDevice } from '@/lib/brightnessCalibration';
import {
  getDefaultSensorInteractionConfig,
  SENSOR_INTERACTION_OPTIONS,
  type SensorInteractionKind,
} from '@/lib/sensorInteraction';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { StatePreview } from '@/ui/settings/StatePreview';
import { HealthEvidence } from '@/ui/settings/HealthStatus';
import {
  ReportingPolicyField,
  reportingPolicyError,
} from '@/ui/settings/ReportingPolicyField';
import { DeviceQuickControls } from '@/ui/DeviceControls';
import { DeviceReportStatus } from '@/ui/DeviceReportStatus';
import { SensorActionPanel } from '@/ui/SensorActionPanel';
import { ColorCalibrationWizard } from '@/ui/ColorCalibrationWizard';
import { BrightnessCalibrationWizard } from '@/ui/BrightnessCalibrationWizard';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import {
  DeviceStatePreview,
  deviceSummary,
  useSettingsDevices,
} from './shared';
export default function DeviceEditor({ deviceKey }: { deviceKey: string }) {
  const catalog = useSettingsDevices(),
    metadata = useDeviceSettings(deviceKey);
  const groups = useGroupsState(),
    groupRows = useGroups(),
    scenes = useScenes();
  const { advanced } = useSettingsPreferences(),
    { apiEndpoint } = useAppConfig();
  const profiles = useCalibrationProfiles(),
    assignments = useCalibrationAssignments(),
    calibrations = useDeviceColorCalibrations();
  const mutations = useConfigDevices();
  const device = catalog.byKey[deviceKey];
  const name = device ? catalog.label(device) : deviceKey;
  const navigate = useNavigate();
  const [replacement, setReplacement] = useState(''),
    [busy, setBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWizard = searchParams.get('calibration');
  const wizard =
    requestedWizard === 'color' || requestedWizard === 'brightness'
      ? requestedWizard
      : null;
  const setWizard = (value: 'color' | 'brightness' | null) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set('calibration', value);
      else next.delete('calibration');
      return next;
    });
  const href = configItemHref('device', deviceKey),
    key = `${apiEndpoint}/device-settings/${deviceKey}`;
  const draft = useEntityDraft({
    key,
    item: metadata.data,
    label: name,
    href,
    save: metadata.save,
    validate(value) {
      const message = reportingPolicyError(
        value.reporting_policy ?? { mode: 'inherit' },
      );
      return message ? [{ field: 'reporting_policy', message }] : [];
    },
  });
  const value = draft.value;
  const data =
    device && 'Controllable' in device.data
      ? device.data.Controllable
      : undefined;
  const assignedId = assignments.data.find(
    (row) => row.device_key === deviceKey,
  )?.profile_id;
  const assignedProfile = profiles.data.find((row) => row.id === assignedId);
  const resolvedCalibration = calibrations.data.find(
    (row) => row.device_key === deviceKey,
  );
  const memberships = Object.entries(groups).filter(([, row]) =>
    row.device_keys.includes(deviceKey),
  );
  const source = data?.state_source;
  const relatedScenes = scenes.data.filter(
    (row) =>
      Object.hasOwn(row.device_states ?? {}, deviceKey) ||
      memberships.some(([id]) => Object.hasOwn(row.group_states ?? {}, id)),
  );
  useAssistantPageContext({ kind: 'device', id: deviceKey, label: name });
  const sensor = value?.sensor;
  const kind = sensor?.interaction_kind ?? 'auto';
  const knownSensor =
    SENSOR_INTERACTION_OPTIONS.some((option) => option.value === kind) &&
    (sensor?.config == null ||
      (typeof sensor.config === 'object' && !Array.isArray(sensor.config)));
  const sensorFields =
    kind === 'hue_dimmer'
      ? [
          ['on_value', 'On'],
          ['up_value', 'Brighter'],
          ['down_value', 'Dimmer'],
          ['off_value', 'Off'],
        ]
      : kind === 'button_events'
        ? [
            ['single_value', 'Press'],
            ['double_value', 'Double press'],
            ['hold_value', 'Hold'],
            ['off_value', 'Off'],
          ]
        : kind === 'on_off_buttons'
          ? [
              ['on_value', 'On'],
              ['off_value', 'Off'],
            ]
          : [];
  async function remove(replace: boolean) {
    if (
      !(await confirmDialog({
        title: replace ? `Replace ${name}?` : `Delete ${name}?`,
        description: replace
          ? 'Saved references are rewritten to the replacement, then this device is removed. Unsaved settings will be discarded.'
          : 'Removes this device and its saved references. It can reappear if the integration reports it again. Unsaved settings will be discarded.',
        confirmLabel: replace ? 'Replace device' : 'Delete device',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      if (replace) await mutations.replace(deviceKey, replacement);
      else await mutations.remove(deviceKey);
      draft.forget();
      await catalog.refetch();
      navigate(
        replace ? configItemHref('device', replacement) : '/config/devices',
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function closeWizard() {
    setWizard(null);
  }
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/devices"
      backLabel="Devices"
      title={name}
      status={
        device
          ? `${deviceSummary(device)} · ${device.integration_id}`
          : undefined
      }
      loading={catalog.loading || metadata.isLoading}
      error={catalog.error?.message ?? metadata.error?.message}
      onRetry={() => {
        void catalog.refetch();
        void metadata.refetch();
      }}
      notFound={!device && !catalog.loading && !catalog.error}
      menu={[
        {
          label: 'Delete device',
          destructive: true,
          onSelect: () => void remove(false),
        },
      ]}
    >
      {device && value && (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <SettingsSection
              id="details"
              title="Details"
              description="Saved settings control how this device appears throughout your home."
            >
              <label className="grid gap-2 text-xs">
                Display name
                <Input
                  data-field="display_name"
                  value={value.display_name ?? ''}
                  placeholder={device.name}
                  onChange={(event) =>
                    draft.patch({
                      display_name: event.target.value.trim()
                        ? event.target.value
                        : null,
                    })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Leave blank to use the integration label: {device.name}.
              </p>
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Integration</dt>
                  <dd>
                    <Link
                      className="settings-link"
                      to={configItemHref('integration', device.integration_id)}
                    >
                      {device.integration_id}
                    </Link>
                  </dd>
                </div>
                {advanced && (
                  <div>
                    <dt className="text-muted-foreground">Device key</dt>
                    <dd className="break-all font-mono">{deviceKey}</dd>
                  </div>
                )}
              </dl>
              {'Sensor' in device.data && (
                <>
                  <label className="grid gap-2 text-xs">
                    Sensor controls
                    <SettingsSelect
                      aria-label="Sensor controls"
                      value={kind}
                      disabled={!knownSensor}
                      onValueChange={(selected) => {
                        const nextKind = selected as SensorInteractionKind;
                        draft.patch({
                          sensor: entityDraftStore.switchVariant(
                            key,
                            'sensor',
                            kind,
                            value.sensor,
                            nextKind,
                            nextKind === 'auto'
                              ? null
                              : {
                                  device_ref: deviceKey,
                                  interaction_kind: nextKind,
                                  config: { ...sensor?.config },
                                },
                          ),
                        });
                      }}
                      options={[
                        ...SENSOR_INTERACTION_OPTIONS,
                        ...(!knownSensor
                          ? [{ value: kind, label: `${kind} (unsupported)` }]
                          : []),
                      ]}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Changes the controls used to simulate sensor input. Auto
                    follows the reported value type and observed button events.
                  </p>
                  {!knownSensor ? (
                    <p className="text-xs text-amber-700">
                      This sensor configuration is preserved as stored; this
                      editor cannot change its format.
                    </p>
                  ) : (
                    sensorFields.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {sensorFields.map(([field, label]) => (
                          <label
                            key={field}
                            className="grid min-w-0 gap-2 text-xs"
                          >
                            {label} value
                            <Input
                              value={
                                typeof sensor?.config[field] === 'string'
                                  ? (sensor.config[field] as string)
                                  : (getDefaultSensorInteractionConfig(
                                      kind as SensorInteractionKind,
                                    )[field] ?? '')
                              }
                              placeholder={
                                getDefaultSensorInteractionConfig(
                                  kind as SensorInteractionKind,
                                )[field]
                              }
                              onChange={(event) =>
                                draft.patch({
                                  sensor: {
                                    ...sensor!,
                                    config: {
                                      ...sensor?.config,
                                      [field]: event.target.value,
                                    },
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )
                  )}
                  {kind === 'button_events' && (
                    <p className="text-xs text-muted-foreground">
                      Leave a value empty to hide that button.
                    </p>
                  )}
                </>
              )}
            </SettingsSection>
            <SettingsSection
              id="reporting"
              title="Reporting policy"
              description="Changes take effect when you save this device’s settings."
            >
              <ReportingPolicyField
                value={value.reporting_policy ?? { mode: 'inherit' }}
                onChange={(reporting_policy) =>
                  draft.patch({ reporting_policy })
                }
                draftKey={key}
              />
            </SettingsSection>
            <SettingsSection
              id="live"
              title={
                'Sensor' in device.data ? 'Current reading' : 'Live controls'
              }
              description={
                data
                  ? 'Commands here change the device immediately. They are separate from Save changes.'
                  : 'The latest value received from the integration.'
              }
            >
              <HealthEvidence deviceKey={deviceKey} />
              <div className="flex items-center gap-3">
                <DeviceStatePreview device={device} />
                <span className="text-sm font-medium">
                  {deviceSummary(device)}
                </span>
              </div>
              {data ? (
                <>
                  <DeviceQuickControls devices={[device]} compact />
                  <DeviceReportStatus devices={[device]} detail inline />
                  {data.last_report && (
                    <div className="flex items-center gap-2 text-xs">
                      <StatePreview
                        {...data.last_report.state}
                        source="Integration report"
                      />
                      <span>
                        Reported{' '}
                        {new Date(
                          data.last_report.received_at_ms,
                        ).toLocaleString()}
                        {data.last_report.retained ? ' · retained message' : ''}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(
                    'Sensor' in device.data ? device.data.Sensor : device.data,
                    null,
                    2,
                  )}
                </pre>
              )}
            </SettingsSection>
          </div>
          <SettingsSection id="connections" title="Connections">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-xs font-medium">Rooms & groups</h3>
                {memberships.length ? (
                  memberships.map(([id, row]) => (
                    <Link
                      className="settings-link block text-sm"
                      key={id}
                      to={configItemHref('group', id)}
                    >
                      {row.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {groupRows.data
                          .find((group) => group.id === id)
                          ?.devices.some(
                            (ref) =>
                              `${ref.integration_id}/${ref.device_id}` ===
                              deviceKey,
                          )
                          ? 'Direct member'
                          : 'Through a linked group'}
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No memberships.{' '}
                    <Link className="settings-link" to="/config/groups">
                      Open Rooms & groups
                    </Link>{' '}
                    to add this device.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-medium">
                  Scenes using this device
                </h3>
                {relatedScenes.length ? (
                  relatedScenes.map((scene) => (
                    <Link
                      className="settings-link block text-sm"
                      key={scene.id}
                      to={`${configItemHref('scene', scene.id)}?device=${encodeURIComponent(deviceKey)}`}
                    >
                      {scene.name}
                      {scene.id === data?.scene_id ? ' · Active' : ''}
                    </Link>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No direct or group scene targets.
                  </p>
                )}
              </div>
            </div>
            {source && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">
                  Requested state from {source.scope.replaceAll('_', ' ')} ·{' '}
                  {source.kind.replaceAll('_', ' ')}
                </span>
                {data?.scene_id && (
                  <Link
                    className="settings-link"
                    to={configItemHref('scene', data.scene_id)}
                  >
                    Active scene
                  </Link>
                )}
                {source.group_id && (
                  <Link
                    className="settings-link"
                    to={configItemHref('group', source.group_id)}
                  >
                    Source group
                  </Link>
                )}
                {source.linked_device_key && (
                  <Link
                    className="settings-link"
                    to={configItemHref('device', source.linked_device_key)}
                  >
                    Followed device
                  </Link>
                )}
                {source.linked_scene_id && (
                  <Link
                    className="settings-link"
                    to={configItemHref('scene', source.linked_scene_id)}
                  >
                    Followed scene
                  </Link>
                )}
              </div>
            )}
          </SettingsSection>
          {(canCalibrateDevice(device) || isDimmableDevice(device)) && (
            <SettingsSection
              id="calibration"
              title="Calibration"
              description="Adjust color and brightness response using saved calibration profiles."
              actions={
                wizard ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void closeWizard()}
                  >
                    Close calibration
                  </Button>
                ) : undefined
              }
            >
              {(profiles.error || assignments.error || calibrations.error) && (
                <div role="alert" className="space-y-2 text-sm">
                  <p>Could not refresh the calibration summary.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void Promise.allSettled([
                        profiles.refetch(),
                        assignments.refetch(),
                        calibrations.refetch(),
                      ])
                    }
                  >
                    Retry calibration summary
                  </Button>
                </div>
              )}
              {wizard === 'color' ? (
                <ColorCalibrationWizard
                  device={device}
                  devices={catalog.devices}
                />
              ) : wizard === 'brightness' ? (
                <BrightnessCalibrationWizard
                  device={device}
                  devices={catalog.devices}
                  existingPoints={
                    assignedProfile?.points ?? resolvedCalibration?.points ?? []
                  }
                  profile={assignedProfile ?? null}
                  existingBrightnessPoints={
                    assignedProfile?.brightness_points ??
                    resolvedCalibration?.brightness_points ??
                    []
                  }
                  profileUsage={
                    assignments.data.filter(
                      (row) => row.profile_id === assignedId,
                    ).length
                  }
                  onSaved={() => void catalog.refetch()}
                />
              ) : (
                <>
                  <p className="text-sm">
                    {assignedProfile?.name ??
                      (resolvedCalibration
                        ? 'Existing device calibration'
                        : 'No calibration profile assigned')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {canCalibrateDevice(device) && (
                      <Button
                        variant="outline"
                        onClick={() => setWizard('color')}
                      >
                        Calibrate color
                      </Button>
                    )}
                    {isDimmableDevice(device) && (
                      <Button
                        variant="outline"
                        onClick={() => setWizard('brightness')}
                      >
                        Calibrate brightness
                      </Button>
                    )}
                  </div>
                  <CalibrationAssignment deviceKey={deviceKey} />
                </>
              )}
            </SettingsSection>
          )}
          {advanced && (
            <SettingsSection id="technical" title="Technical details">
              {data && (
                <>
                  <p className="text-xs">
                    Management:{' '}
                    {typeof data.managed === 'string'
                      ? data.managed
                      : 'Partial'}
                  </p>
                  <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(data.capabilities, null, 2)}
                  </pre>
                </>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer">Latest raw payload</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3">
                  {JSON.stringify(device.raw, null, 2)}
                </pre>
              </details>
              {'Sensor' in device.data && (
                <div className="space-y-3 border-t border-border pt-3">
                  <h3 className="text-xs font-medium">Simulate sensor input</h3>
                  <p className="text-xs text-muted-foreground">
                    Sends a test event immediately using the saved sensor
                    controls. Matching routines can run.
                  </p>
                  <SensorActionPanel
                    device={device}
                    sensorConfig={metadata.data?.sensor ?? null}
                  />
                </div>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer">Replace references</summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="min-w-0 max-w-md flex-1">
                    <SearchablePicker
                      ariaLabel="Replacement device"
                      options={catalog.devices
                        .filter((row) => getDeviceKey(row) !== deviceKey)
                        .map((row) => ({
                          value: getDeviceKey(row),
                          label: catalog.label(row),
                          detail: getDeviceKey(row),
                        }))}
                      value={replacement}
                      onChange={setReplacement}
                      placeholder="Choose replacement"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={!replacement || busy}
                    onClick={() => void remove(true)}
                  >
                    Replace device
                  </Button>
                </div>
              </details>
            </SettingsSection>
          )}
          <EntitySaveBar draft={draft} />
        </>
      )}
    </DetailPageShell>
  );
}
