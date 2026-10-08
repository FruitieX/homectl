import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MoreHorizontal,
  Palette,
  Pencil,
  Search,
  SunMedium,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { ColorCalibrationProfile } from '@/bindings/ColorCalibrationProfile';
import type { Device } from '@/bindings/Device';
import {
  restoreAssignments,
  useCalibrationActions,
} from '@/hooks/useCalibrationActions';
import type { CalibrationEditorView } from '@/hooks/useCalibrationEditor';
import {
  lightCalibration,
  profileChannelSummary,
  profileUsers,
} from '@/lib/calibrationProfiles';
import { canCalibrateDevice } from '@/lib/colorCalibration';
import { isDimmableDevice } from '@/lib/brightnessCalibration';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { configItemHref } from '@/lib/configItemHref';
import { getDeviceKey } from '@/lib/device';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { EntityPicker } from '@/ui/settings/EntityPicker';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { CalibrationCatalogStatus } from '@/ui/settings/CalibrationCatalogStatus';
import {
  BrightnessCurvePreview,
  ColorPointsPreview,
} from '@/ui/settings/CalibrationSummary';
import { NO_PROFILE } from '@/lib/calibrationProfiles';
import { ConfigPageHeader } from '../page-header';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';
import { useSettingsDevices } from '../devices/shared';

type Light = { key: string; name: string; color: boolean; dimmable: boolean };

function eligibleLights(
  devices: Device[],
  label: (device: Device) => string,
): Light[] {
  return devices
    .filter((device) => !isDeviceReadOnly(device))
    .map((device) => ({
      key: getDeviceKey(device),
      name: label(device),
      color: canCalibrateDevice(device),
      dimmable: isDimmableDevice(device),
    }))
    .filter((light) => light.color || light.dimmable)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

const fits = (light: Light, profile: ColorCalibrationProfile) =>
  (!profile.points.length || light.color) &&
  (!profile.brightness_points.length || light.dimmable);

export default function CalibrationPage() {
  const catalog = useSettingsDevices();
  const actions = useCalibrationActions();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const view = actions.editor.data;
  const lights = useMemo(
    () => eligibleLights(catalog.devices, catalog.label),
    [catalog.devices, catalog.label],
  );
  const labelFor = (key: string) =>
    lights.find((light) => light.key === key)?.name ??
    (catalog.byKey[key] ? catalog.label(catalog.byKey[key]) : key);
  const calibrate = (key: string, channel?: 'color' | 'brightness') =>
    navigate(
      `${configItemHref('device', key)}${channel ? `?calibration=${channel}` : ''}#calibration`,
    );
  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <ConfigPageHeader
        title="Light calibration"
        description="Make different lights look alike. A profile corrects the colors and brightness levels a light receives; lights of the same model can share one profile."
        actions={
          <Button onClick={() => setPicking(true)}>
            <Wand2 className="size-4" />
            Calibrate a light
          </Button>
        }
      />
      <ConfigSectionTabs />
      <CalibrationCatalogStatus query={actions.editor} />
      {view && (
        <>
          <ProfilesSection
            view={view}
            lights={lights}
            labelFor={labelFor}
            actions={actions}
            onCalibrate={calibrate}
          />
          <LightsSection
            view={view}
            lights={lights}
            actions={actions}
            onCalibrate={calibrate}
          />
        </>
      )}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="settings-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>Calibrate a light</DialogTitle>
            <DialogDescription>
              Choose the light to adjust. You’ll compare it with a reference
              light you like, then save the result as its profile.
            </DialogDescription>
          </DialogHeader>
          <SearchablePicker
            ariaLabel="Light to calibrate"
            value=""
            placeholder="Choose a light"
            options={lights.map((light) => ({
              value: light.key,
              label: light.name,
              detail: [
                light.color ? 'Color' : null,
                light.dimmable ? 'Dimmable' : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }))}
            onChange={(key) => {
              setPicking(false);
              if (key) calibrate(key);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfilesSection({
  view,
  lights,
  labelFor,
  actions,
  onCalibrate,
}: {
  view: CalibrationEditorView;
  lights: Light[];
  labelFor: (key: string) => string;
  actions: ReturnType<typeof useCalibrationActions>;
  onCalibrate: (key: string, channel?: 'color' | 'brightness') => void;
}) {
  const profiles = [...view.profiles].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return (
    <SettingsSection
      id="profiles"
      title={`Profiles · ${profiles.length}`}
      description="Each profile holds color matching points, a brightness curve, or both."
    >
      {!profiles.length ? (
        <p className="text-sm text-muted-foreground">
          No profiles yet. Choose <strong>Calibrate a light</strong> to create
          one by matching a light against a reference.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              view={view}
              lights={lights}
              labelFor={labelFor}
              actions={actions}
              onCalibrate={onCalibrate}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function ProfileCard({
  profile,
  view,
  lights,
  labelFor,
  actions,
  onCalibrate,
}: {
  profile: ColorCalibrationProfile;
  view: CalibrationEditorView;
  lights: Light[];
  labelFor: (key: string) => string;
  actions: ReturnType<typeof useCalibrationActions>;
  onCalibrate: (key: string, channel?: 'color' | 'brightness') => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const users = profileUsers(view, profile.id);
  const editOn = users.find((key) => lights.some((light) => light.key === key));
  const rename = async () => {
    const name = renaming?.trim();
    setRenaming(null);
    if (!name || name === profile.name) return;
    await actions.run(
      () => [
        { profile: { ...profile, name }, profile_id: null, device_keys: [] },
      ],
      `Renamed to ${name}`,
    );
  };
  const remove = async () => {
    if (
      !(await confirmDialog({
        title: `Delete ${profile.name}?`,
        description: users.length
          ? `${users.length} light${users.length === 1 ? '' : 's'} using it will go back to uncalibrated: ${users.map(labelFor).join(', ')}.`
          : 'No lights use this profile.',
        confirmLabel: 'Delete profile',
        destructive: true,
      }))
    )
      return;
    await actions.run(
      () => [
        { delete_profile_id: profile.id, profile_id: null, device_keys: [] },
      ],
      `Deleted ${profile.name}`,
    );
  };
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming !== null ? (
            <Input
              autoFocus
              aria-label="Profile name"
              value={renaming}
              maxLength={200}
              onChange={(event) => setRenaming(event.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void rename();
                if (event.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <h3 className="truncate font-medium">{profile.name}</h3>
          )}
          <p className="text-xs text-muted-foreground">
            {profileChannelSummary(profile)}
            {profile.reference_device_key && (
              <>
                {' · matched to '}
                <Link
                  className="underline underline-offset-2"
                  to={configItemHref('device', profile.reference_device_key)}
                >
                  {labelFor(profile.reference_device_key)}
                </Link>
              </>
            )}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${profile.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(profile.name)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
            {editOn && (
              <>
                <DropdownMenuItem
                  onSelect={() => onCalibrate(editOn, 'color')}
                  disabled={
                    !lights.find((light) => light.key === editOn)?.color
                  }
                >
                  <Palette className="size-4" />
                  Adjust color on {labelFor(editOn)}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onCalibrate(editOn, 'brightness')}
                  disabled={
                    !lights.find((light) => light.key === editOn)?.dimmable
                  }
                >
                  <SunMedium className="size-4" />
                  Adjust brightness on {labelFor(editOn)}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              onSelect={() => void remove()}
              className="text-destructive"
            >
              <Trash2 className="size-4" />
              Delete profile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {(profile.points.length > 0 || profile.brightness_points.length > 0) && (
        <div className="flex flex-wrap items-center gap-4">
          {profile.points.length > 0 && (
            <ColorPointsPreview points={profile.points} limit={8} />
          )}
          {profile.brightness_points.length > 0 && (
            <BrightnessCurvePreview points={profile.brightness_points} />
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {users.map((key) => (
          <Link
            key={key}
            to={configItemHref('device', key)}
            className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
          >
            {labelFor(key)}
          </Link>
        ))}
        {!users.length && (
          <span className="text-xs text-muted-foreground">
            Not used by any light.
          </span>
        )}
      </div>
      <div className="mt-auto">
        <EntityPicker
          title={`Lights using ${profile.name}`}
          actionLabel={users.length ? 'Change lights' : 'Apply to lights'}
          options={lights.map((light) => {
            const current = lightCalibration(view, light.key).profile;
            return {
              id: light.key,
              name: light.name,
              detail:
                current && current.id !== profile.id
                  ? `Currently uses ${current.name}; selecting moves it here`
                  : undefined,
              disabledReason: fits(light, profile)
                ? undefined
                : profile.points.length && !light.color
                  ? 'No color support'
                  : 'Cannot dim',
            };
          })}
          selected={users}
          onChange={(ids) => {
            const added = ids.filter((key) => !users.includes(key));
            const removed = users.filter((key) => !ids.includes(key));
            if (!added.length && !removed.length) return;
            void actions.run(
              () => [
                ...(added.length
                  ? [{ profile_id: profile.id, device_keys: added }]
                  : []),
                ...(removed.length
                  ? [{ profile_id: null, device_keys: removed }]
                  : []),
              ],
              `${profile.name} now applies to ${ids.length} light${ids.length === 1 ? '' : 's'}`,
              (before) => restoreAssignments(before, [...added, ...removed]),
            );
          }}
        />
      </div>
    </article>
  );
}

function LightsSection({
  view,
  lights,
  actions,
  onCalibrate,
}: {
  view: CalibrationEditorView;
  lights: Light[];
  actions: ReturnType<typeof useCalibrationActions>;
  onCalibrate: (key: string, channel?: 'color' | 'brightness') => void;
}) {
  const [query, setQuery] = useState('');
  const [onlyUncalibrated, setOnlyUncalibrated] = useState(false);
  const [limit, setLimit] = useState(60);
  const rows = lights
    .map((light) => ({ light, calibration: lightCalibration(view, light.key) }))
    .filter(
      ({ light, calibration }) =>
        (!onlyUncalibrated || calibration.kind === 'none') &&
        `${light.name} ${light.key} ${calibration.profile?.name ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    );
  return (
    <SettingsSection
      id="lights"
      title={`Lights · ${lights.length}`}
      description="Which profile each light uses. Changes apply right away."
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 max-w-md flex-1">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Filter lights or profiles"
            aria-label="Filter lights"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyUncalibrated}
            onChange={(event) => setOnlyUncalibrated(event.target.checked)}
          />
          Only uncalibrated
        </label>
      </div>
      <div className="divide-y divide-border" role="list">
        {rows.slice(0, limit).map(({ light, calibration }) => {
          const options = view.profiles
            .filter((profile) => fits(light, profile))
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <div
              key={light.key}
              role="listitem"
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
            >
              <div className="min-w-48 flex-1">
                <Link
                  className="text-sm font-medium hover:underline"
                  to={`${configItemHref('device', light.key)}#calibration`}
                >
                  {light.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {calibration.kind === 'legacy'
                    ? 'Older per-light calibration'
                    : calibration.profile
                      ? profileChannelSummary(calibration.profile)
                      : 'Not calibrated'}
                  {calibration.sharedWith.length > 0 &&
                    ` · shared with ${calibration.sharedWith.length} other${calibration.sharedWith.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <SettingsSelect
                aria-label={`Calibration profile for ${light.name}`}
                className="w-64 max-w-full"
                value={calibration.profile?.id ?? NO_PROFILE}
                disabled={actions.busy}
                onValueChange={(profileId) => {
                  const profile = view.profiles.find(
                    (row) => row.id === profileId,
                  );
                  void actions.run(
                    () => [
                      {
                        profile_id: profileId === NO_PROFILE ? null : profileId,
                        device_keys: [light.key],
                      },
                    ],
                    profile
                      ? `${light.name} now uses ${profile.name}`
                      : `Calibration removed from ${light.name}`,
                    (before) => restoreAssignments(before, [light.key]),
                  );
                }}
                options={[
                  {
                    value: NO_PROFILE,
                    label:
                      calibration.kind === 'legacy'
                        ? 'Older per-light calibration'
                        : 'No calibration',
                  },
                  ...options.map((profile) => ({
                    value: profile.id,
                    label: profile.name,
                  })),
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCalibrate(light.key)}
              >
                {calibration.kind === 'none' ? 'Calibrate' : 'Open'}
              </Button>
            </div>
          );
        })}
        {!rows.length && (
          <p className="py-3 text-sm text-muted-foreground">
            No matching lights.
          </p>
        )}
      </div>
      {rows.length > limit && (
        <Button variant="outline" onClick={() => setLimit((n) => n + 60)}>
          Show more ({rows.length - limit} remaining)
        </Button>
      )}
    </SettingsSection>
  );
}
