import type { ColorCalibrationProfile } from '../bindings/ColorCalibrationProfile';
import type { ColorCalibrationPoint } from '../bindings/ColorCalibrationPoint';
import type { BrightnessCalibrationPoint } from '../bindings/BrightnessCalibrationPoint';
import type {
  CalibrationEdit,
  CalibrationEditorView,
} from '../hooks/useCalibrationEditor';

/**
 * A light has at most one calibration profile, and a profile carries both
 * channels: color matching points and a brightness curve. Either channel may be
 * empty. Several lights of the same model can share one profile.
 */
export type LightCalibration = {
  /** `profile`: assigned profile; `legacy`: older per-light data; `none`. */
  kind: 'profile' | 'legacy' | 'none';
  profile?: ColorCalibrationProfile;
  points: ColorCalibrationPoint[];
  brightnessPoints: BrightnessCalibrationPoint[];
  /** Other lights assigned to the same profile. */
  sharedWith: string[];
};

/** Select value for "no profile"; select components reject an empty value. */
export const NO_PROFILE = '__none__';

/** Default name for a light's own profile. */
export function defaultProfileName(device: { name: string }) {
  return `${device.name || 'Light'} calibration`.slice(0, 200);
}

export function profileUsers(view: CalibrationEditorView, profileId: string) {
  return view.assignments
    .filter((row) => row.profile_id === profileId)
    .map((row) => row.device_key);
}

export function lightCalibration(
  view: CalibrationEditorView,
  deviceKey: string,
): LightCalibration {
  const assignment = view.assignments.find(
    (row) => row.device_key === deviceKey,
  );
  const profile = assignment
    ? view.profiles.find((row) => row.id === assignment.profile_id)
    : undefined;
  if (profile)
    return {
      kind: 'profile',
      profile,
      points: profile.points,
      brightnessPoints: profile.brightness_points,
      sharedWith: profileUsers(view, profile.id).filter(
        (key) => key !== deviceKey,
      ),
    };
  const legacy = view.legacy.find((row) => row.device_key === deviceKey);
  if (legacy)
    return {
      kind: 'legacy',
      points: legacy.points,
      brightnessPoints: legacy.brightness_points,
      sharedWith: [],
    };
  return { kind: 'none', points: [], brightnessPoints: [], sharedWith: [] };
}

/** "Color · 9 points", "Brightness · 4-point curve", for summaries. */
export function profileChannelSummary(profile: {
  points: unknown[];
  brightness_points: unknown[];
}): string {
  return (
    [
      profile.points.length
        ? `Color · ${profile.points.length} point${profile.points.length === 1 ? '' : 's'}`
        : null,
      profile.brightness_points.length
        ? `Brightness · ${profile.brightness_points.length}-point curve`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Empty'
  );
}

export type CalibrationChange = Partial<
  Pick<
    ColorCalibrationProfile,
    'points' | 'brightness_points' | 'reference_device_key' | 'brightness'
  >
> & { name?: string };

/**
 * Turn a wizard result for one light into a single editor write.
 *
 * - `shared` updates the light's profile in place, so every light using it
 *   changes too. This is also what happens when no other light uses it.
 * - `copy` saves the result as a new profile for this light only; the
 *   previous profile keeps serving the other lights.
 * A light without a profile always gets a new one, seeded from any legacy
 * per-light calibration. Emptying both channels removes calibration from the
 * light, and deletes its profile when nothing else uses it.
 */
export function planCalibrationSave({
  view,
  deviceKey,
  change,
  scope,
  newId,
  defaultName,
}: {
  view: CalibrationEditorView;
  deviceKey: string;
  change: CalibrationChange;
  scope: 'shared' | 'copy';
  newId: string;
  defaultName: string;
}): CalibrationEdit {
  const current = lightCalibration(view, deviceKey);
  const inPlace =
    current.kind === 'profile' &&
    (scope === 'shared' || current.sharedWith.length === 0);
  const base: ColorCalibrationProfile = current.profile ?? {
    id: newId,
    name: defaultName,
    points: current.points,
    brightness_points: current.brightnessPoints,
    reference_device_key: null,
    brightness: 1,
  };
  const name = change.name?.trim();
  const next: ColorCalibrationProfile = {
    ...base,
    ...change,
    id: inPlace ? base.id : newId,
    // A copy must not reuse the shared profile's name.
    name: (name || (inPlace || !current.profile ? base.name : defaultName))
      .trim()
      .slice(0, 200),
  };
  if (!next.points.length && !next.brightness_points.length)
    return {
      device_keys: [deviceKey],
      profile_id: null,
      delete_profile_id:
        current.profile && (inPlace || !current.sharedWith.length)
          ? current.profile.id
          : null,
    };
  return { profile: next, profile_id: next.id, device_keys: [deviceKey] };
}
