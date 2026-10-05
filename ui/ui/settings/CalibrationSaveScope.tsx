import type { CalibrationEditorView } from '@/hooks/useCalibrationEditor';
import { lightCalibration } from '@/lib/calibrationProfiles';
import { Input } from '@/ui/primitives/input';

/**
 * Where a wizard result is saved. A light has one profile holding both color
 * and brightness; when other lights share it, the person chooses whether the
 * change is for all of them or becomes a separate profile for this light.
 */
export function CalibrationSaveScope({
  view,
  deviceKey,
  deviceName,
  scope,
  onScope,
  name,
  onName,
  defaultName,
  channel,
}: {
  view: CalibrationEditorView;
  deviceKey: string;
  deviceName: string;
  scope: 'shared' | 'copy';
  onScope: (scope: 'shared' | 'copy') => void;
  name: string;
  onName: (name: string) => void;
  defaultName: string;
  channel: 'color' | 'brightness';
}) {
  const light = lightCalibration(view, deviceKey);
  const other = channel === 'color' ? 'brightness curve' : 'color matching';
  const keeps =
    (channel === 'color' ? light.brightnessPoints : light.points).length > 0
      ? ` Its ${other} is kept.`
      : '';
  const nameField = (placeholder: string) => (
    <label className="grid gap-1.5 text-sm">
      Profile name
      <Input
        data-field="calibration_name"
        aria-label="Profile name"
        value={name}
        maxLength={200}
        placeholder={placeholder}
        onChange={(event) => onName(event.target.value)}
      />
    </label>
  );
  if (!light.profile)
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm">
          Saves a new profile for {deviceName}.
          {light.kind === 'legacy' && ` Its older calibration is carried over.`}
        </p>
        {nameField(defaultName)}
      </div>
    );
  if (!light.sharedWith.length)
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm">
          Updates <strong>{light.profile.name}</strong>, used only by{' '}
          {deviceName}.{keeps}
        </p>
        {nameField(light.profile.name)}
      </div>
    );
  const count = light.sharedWith.length;
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Save to</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          className="mt-1 accent-primary"
          checked={scope === 'shared'}
          onChange={() => onScope('shared')}
        />
        <span>
          Update <strong>{light.profile.name}</strong>
          <span className="block text-xs text-muted-foreground">
            Also changes the {count} other light{count === 1 ? '' : 's'} using
            it. Best for lights of the same model.{keeps}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          className="mt-1 accent-primary"
          checked={scope === 'copy'}
          onChange={() => onScope('copy')}
        />
        <span>
          Save a separate profile for {deviceName} only
          <span className="block text-xs text-muted-foreground">
            Starts from a copy of {light.profile.name}; the other lights keep
            using it unchanged.
          </span>
        </span>
      </label>
      {nameField(scope === 'copy' ? defaultName : light.profile.name)}
    </fieldset>
  );
}
