import { Link } from 'react-router-dom';
import { configItemHref } from '@/lib/configItemHref';
import {
  useCalibrationEditor,
  deviceCalibration,
  type CalibrationEditorView,
} from '@/hooks/useCalibrationEditor';
import { useCalibrationDraft } from '@/hooks/useCalibrationDraft';
import { EntitySaveBar } from './EntitySaveBar';
import { CalibrationConflict } from './CalibrationConflict';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { Button } from '@/ui/primitives/button';
import { CalibrationCatalogStatus } from './CalibrationCatalogStatus';
import { SettingsSelect } from './SettingsSelect';

/** Assignment uses the same atomic write and retained draft as calibration. */
export function CalibrationAssignment({ deviceKey }: { deviceKey: string }) {
  const api = useCalibrationEditor();
  return (
    <div className="space-y-3">
      <CalibrationCatalogStatus query={api} />
      {api.data && (
        <AssignmentForm
          key={deviceKey}
          deviceKey={deviceKey}
          initial={api.data}
        />
      )}
    </div>
  );
}
function AssignmentForm({
  deviceKey,
  initial,
}: {
  deviceKey: string;
  initial: CalibrationEditorView;
}) {
  const draft = useCalibrationDraft({
    kind: 'assignment',
    deviceKey,
    label: 'Device',
    initial,
    form: () => ({
      profileId: deviceCalibration(initial, deviceKey).profile?.id ?? '',
    }),
    beforeSave: async () => {},
    prepare: (form) => ({
      profile_id: form.profileId || null,
      device_keys: [deviceKey],
    }),
  });
  const [profileId, setProfileId] = draft.field('profileId');
  return (
    <div className="space-y-3">
      <SearchablePicker
        ariaLabel="Calibration profile"
        value={profileId}
        options={draft.value.basis.profiles.map((row) => ({
          value: row.id,
          label: row.name,
        }))}
        onChange={setProfileId}
        placeholder="No profile assigned"
      />
      {profileId && (
        <Button variant="ghost" onClick={() => setProfileId('')}>
          Remove assignment
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Save applies the selected profile’s color and brightness response.
        Removing calibration clears the assignment and any legacy per-device
        calibration.
      </p>
      <CalibrationConflict
        before={draft.value.basis}
        current={draft.conflictCatalog}
        onReview={draft.reviewLatest}
      />
      <EntitySaveBar inline draft={draft} />
    </div>
  );
}

/** Selected keys are captured in the retained draft before an assignment write. */
export function BulkCalibrationAssignment({
  selected,
}: {
  selected: string[];
}) {
  const api = useCalibrationEditor();
  return (
    <div className="space-y-3">
      <CalibrationCatalogStatus query={api} />
      {api.data && (
        <BulkAssignmentForm initial={api.data} selected={selected} />
      )}
    </div>
  );
}
function BulkAssignmentForm({
  initial,
  selected,
}: {
  initial: CalibrationEditorView;
  selected: string[];
}) {
  const draft = useCalibrationDraft({
    kind: 'assignment',
    deviceKey: 'bulk',
    label: 'Selected devices',
    href: '/config/devices?calibration=bulk',
    initial,
    form: () => ({
      deviceKeys: [] as string[],
      profileId: '',
      operation: 'assign' as 'assign' | 'remove',
    }),
    beforeSave: async () => {},
    prepare: (form) => ({
      profile_id: form.operation === 'remove' ? null : form.profileId,
      device_keys: form.deviceKeys,
    }),
    validate: (form) =>
      !form.deviceKeys.length
        ? [{ field: 'devices', message: 'Choose devices for this change.' }]
        : form.operation === 'assign' && !form.profileId
          ? [{ field: 'profile', message: 'Choose a calibration profile.' }]
          : [],
  });
  const [keys, setKeys] = draft.field('deviceKeys');
  const [profile, setProfile] = draft.field('profileId');
  const [operation, setOperation] = draft.field('operation');
  return (
    <div className="w-full space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!selected.length}
          onClick={() => setKeys([...selected])}
        >
          Use {selected.length} selected lights
        </Button>
        <span className="text-xs text-muted-foreground">
          {keys.length} lights in this change
        </span>
      </div>
      {keys.length > 0 && (
        <div className="max-h-28 overflow-auto text-xs">
          {keys.map((key) => (
            <Link
              key={key}
              className="mr-3 inline-flex min-h-8 items-center text-primary underline"
              to={configItemHref('device', key)}
            >
              {key}
            </Link>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="grid gap-2 text-sm">
          Change
          <SettingsSelect
            aria-label="Calibration change"
            value={operation}
            onValueChange={(value) =>
              setOperation(value as 'assign' | 'remove')
            }
            options={[
              { value: 'assign', label: 'Assign a profile' },
              { value: 'remove', label: 'Remove calibration' },
            ]}
          />
        </label>
        {operation === 'assign' && (
          <div className="min-w-52 flex-1 self-end">
            <SearchablePicker
              ariaLabel="Bulk calibration profile"
              value={profile}
              options={draft.value.basis.profiles.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              onChange={setProfile}
              placeholder="Choose a profile"
            />
          </div>
        )}
      </div>
      {operation === 'remove' && (
        <p className="text-xs text-muted-foreground">
          Save removes calibration assignments and any legacy calibration from
          the lights listed above.
        </p>
      )}
      <CalibrationConflict
        before={draft.value.basis}
        current={draft.conflictCatalog}
        onReview={draft.reviewLatest}
      />
      <EntitySaveBar inline draft={draft} />
    </div>
  );
}
