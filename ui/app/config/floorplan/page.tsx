import { useState, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Download, Trash2 } from 'lucide-react';
import {
  useFloorplans,
  useGroups,
  useDeviceDisplayNames,
  ConfigApiError,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import {
  useEntityDraft,
  entityFieldProps,
  type EntityDraftApi,
} from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { getDeviceKey } from '@/lib/device';
import { getResolvedDeviceColorState } from '@/lib/colors';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { readFloorplanDraft } from '@/lib/floorplanDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import { deepEqual } from '@/lib/configSection';
import { ConfigPageHeader } from '../page-header';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import {
  FloorplanGridEditor,
  createEmptyGrid,
  serializeGrid,
} from '@/ui/FloorplanGridEditor';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { useFloorplanEditor, type FloorplanDraft } from './shared';

const EMPTY: FloorplanDraft = {
  id: '',
  name: '',
  grid_data: serializeGrid(createEmptyGrid()),
  image: { kind: 'none' },
  revision_token: '',
};
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const download = (text: string, name: string) => {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function FloorplanPage() {
  const [params, setParams] = useSearchParams();
  const floorplans = useFloorplans();
  const creating = params.get('new') === '1';
  const id = params.get('id') ?? floorplans.data[0]?.id ?? '';
  return (
    <div className="settings-page space-y-5">
      <ConfigPageHeader
        title="Floorplans"
        description="Arrange the rooms and devices on each floor. Name, image and layout are saved together."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/map">Open map</Link>
            </Button>
            {!creating && (
              <Button asChild>
                <Link to="/config/floorplan?new=1">
                  <Plus className="size-4" />
                  Add floorplan
                </Link>
              </Button>
            )}
          </>
        }
      />
      {floorplans.error && (
        <p role="alert" className="text-sm text-destructive">
          {floorplans.error}{' '}
          <Button variant="outline" onClick={() => void floorplans.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {!creating && floorplans.data.length > 0 && (
        <label className="flex flex-wrap items-center gap-3 text-sm">
          Floorplan
          <div className="w-full sm:w-64">
            <SearchablePicker
              ariaLabel="Select floorplan"
              clearable={false}
              value={id}
              onChange={(value) => setParams({ id: value })}
              options={floorplans.data.map((row) => ({
                value: row.id,
                label: row.name,
                detail: row.id,
              }))}
            />
          </div>
        </label>
      )}
      {creating || id ? (
        <FloorplanEditor
          key={creating ? 'new' : id}
          id={id}
          creating={creating}
          onCreated={(id) => setParams({ id }, { replace: true })}
          onDeleted={() => setParams({}, { replace: true })}
        />
      ) : floorplans.loading ? (
        <p>Loading floorplans…</p>
      ) : (
        !floorplans.error && (
          <p className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
            No floorplans yet. Add one to place your rooms and devices.
          </p>
        )
      )}
    </div>
  );
}
function FloorplanEditor({
  id,
  creating,
  onCreated,
  onDeleted,
}: {
  id: string;
  creating: boolean;
  onCreated: (id: string) => void;
  onDeleted: () => void;
}) {
  const api = useFloorplanEditor(id, creating),
    { advanced } = useSettingsPreferences();
  const devices = useDevicesApi(),
    groups = useGroups(),
    names = useDeviceDisplayNames();
  const [fileError, setFileError] = useState(''),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0),
    [showAll, setShowAll] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null),
    gridInput = useRef<HTMLInputElement>(null);
  const draft: EntityDraftApi<FloorplanDraft> = useEntityDraft<FloorplanDraft>({
    key: `${api.apiEndpoint}/floorplan/${creating ? 'new' : id}`,
    item: creating ? EMPTY : api.saved.data,
    label: creating ? 'New floorplan' : (api.saved.data?.name ?? 'Floorplan'),
    href: creating
      ? '/config/floorplan?new=1'
      : `/config/floorplan?id=${encodeURIComponent(id)}`,
    validate: (value) => [
      ...(!value.name.trim()
        ? [{ field: 'name', message: 'Give the floorplan a name.' }]
        : []),
      ...(!value.id.trim() || value.id.length > 128
        ? [{ field: 'id', message: 'Use an ID of 1 to 128 characters.' }]
        : []),
      ...(value.grid_data !== draft.entry?.baseline.grid_data &&
      value.grid_data !== null &&
      readFloorplanDraft(value.grid_data).error
        ? [
            {
              field: 'grid_data',
              message: readFloorplanDraft(value.grid_data).error!,
            },
          ]
        : []),
    ],
    save: async (value, expected) => {
      const saved = await api.save(value, expected);
      if (creating) {
        entityDraftStore.forget(`${api.apiEndpoint}/floorplan/new`);
        onCreated(saved.id);
      }
      setEpoch((epoch) => epoch + 1);
      return saved;
    },
  });
  const value = draft.value;
  const gridData = value?.grid_data;
  const parsed = useMemo(
    () =>
      gridData === null
        ? { grid: createEmptyGrid() }
        : gridData !== undefined
          ? readFloorplanDraft(gridData)
          : { grid: null },
    [gridData],
  );
  useAssistantPageContext(
    value?.id
      ? { kind: 'floorplan', id: value.id, label: value.name || value.id }
      : { kind: 'floorplan' },
  );
  const displayNames = Object.fromEntries(
    names.data.map((row) => [row.device_key, row.display_name]),
  );
  const memberGroups = groups.data.reduce<Record<string, string[]>>(
    (result, group) => {
      for (const key of group.device_keys ??
        group.devices.map(
          (device) => `${device.integration_id}/${device.device_id}`,
        ))
        (result[key] ??= []).push(group.id);
      return result;
    },
    {},
  );
  const available = devices.devices
    .map((device) => {
      const state = getResolvedDeviceColorState(device.data);
      return {
        key: getDeviceKey(device),
        name: getDeviceDisplayLabel(device, displayNames),
        type:
          'Sensor' in device.data
            ? ('sensor' as const)
            : 'Controllable' in device.data
              ? ('controllable' as const)
              : ('other' as const),
        groupIds: memberGroups[getDeviceKey(device)] ?? [],
        preview: state
          ? {
              color: state.color.hex(),
              brightness: state.brightness,
              power: state.power,
              disabled:
                'Controllable' in device.data &&
                !!device.data.Controllable.disabled,
            }
          : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const savedImage = `${api.apiEndpoint}/api/v1/config/floorplan/image?id=${encodeURIComponent(id)}&revision=${value?.image.kind === 'stored' ? value.image.revision : ''}`;
  const background =
    value?.image.kind === 'upload'
      ? `data:${value.image.mime_type};base64,${value.image.data_base64}`
      : value?.image.kind === 'stored'
        ? savedImage
        : undefined;
  const discard = () => {
    draft.discard();
    setEpoch((epoch) => epoch + 1);
    setFileError('');
    if (imageInput.current) imageInput.current.value = '';
  };
  const stageImage = async (file: File) => {
    setFileError('');
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error('Choose an image smaller than 10 MB.');
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(
          file.type,
        )
      )
        throw Error('Choose a PNG, JPEG, WebP or SVG image.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error('Could not read the image.'));
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = data;
      await image.decode();
      if (!image.width || !image.height)
        throw Error('The image must have a visible width and height.');
      draft.patch({
        image: {
          kind: 'upload',
          mime_type: file.type,
          data_base64: data.slice(data.indexOf(',') + 1),
        },
      });
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : 'Could not read the image.',
      );
    } finally {
      setBusy(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  };
  const stageGrid = async (file: File) => {
    setFileError('');
    setBusy(true);
    try {
      if (file.size > 16 * 1024 * 1024)
        throw Error('Choose a layout JSON file smaller than 16 MB.');
      const raw = await file.text(),
        parsed = readFloorplanDraft(raw);
      if (!parsed.grid) throw Error(parsed.error);
      draft.patch({ grid_data: raw });
      setEpoch((epoch) => epoch + 1);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : 'Could not read the layout.',
      );
    } finally {
      setBusy(false);
      if (gridInput.current) gridInput.current.value = '';
    }
  };
  const remove = async () => {
    if (
      !draft.entry ||
      !(await confirmDestructive(
        'Delete this floorplan?',
        `This removes “${value?.name}”, its background image and placements. Devices and rooms remain available. ${draft.dirty ? 'Unsaved edits to this floorplan will be discarded.' : ''}`,
      ))
    )
      return;
    setBusy(true);
    setFileError('');
    try {
      await api.remove(draft.entry.baseline);
      draft.forget();
      onDeleted();
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : 'Could not delete the floorplan.',
      );
      if (
        error instanceof ConfigApiError &&
        error.status === 409 &&
        error.current
      )
        entityDraftStore.sync(draft.key, error.current as FloorplanDraft, {
          href: `/config/floorplan?id=${encodeURIComponent(id)}`,
          label: value?.name ?? 'Floorplan',
        });
    } finally {
      setBusy(false);
    }
  };
  if (!value)
    return (
      <div
        role={api.saved.isError ? 'alert' : undefined}
        className="rounded-lg border border-border p-5 text-sm"
      >
        {api.saved.isError ? (
          <>
            {api.saved.error.message}{' '}
            <Button variant="outline" onClick={() => void api.saved.refetch()}>
              Retry
            </Button>
          </>
        ) : (
          'Loading floorplan…'
        )}
      </div>
    );
  const grid = parsed.grid;
  const linked = [
    ...(grid?.devices ?? []).map((device) => ({
      key: `device/${device.deviceKey}`,
      name:
        available.find((item) => item.key === device.deviceKey)?.name ??
        device.deviceName,
      href: `/config/devices/detail/${encodeURIComponent(device.deviceKey)}`,
    })),
    ...Object.keys(grid?.groups ?? {}).map((key) => ({
      key: `group/${key}`,
      name: groups.data.find((group) => group.id === key)?.name ?? key,
      href: `/config/groups/${encodeURIComponent(key)}`,
    })),
  ];
  return (
    <>
      {api.saved.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh this floorplan. Your draft is kept.{' '}
          <Button variant="outline" onClick={() => void api.saved.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {fileError && (
        <p role="alert" className="text-sm text-destructive">
          {fileError}
        </p>
      )}
      <SettingsSection
        title={creating ? 'New floorplan' : 'Floorplan details'}
        description="Changes stay in this draft until you save."
        actions={
          !creating ? (
            <Button
              variant="outline"
              disabled={busy || draft.saving}
              onClick={() => void remove()}
            >
              <Trash2 className="size-4" />
              Delete floorplan
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            Name
            <Input
              {...entityFieldProps(draft, 'name')}
              value={value.name}
              disabled={draft.saving}
              onChange={(event) =>
                draft.patch({
                  name: event.target.value,
                  ...(creating &&
                  (value.id === '' || value.id === slug(value.name))
                    ? { id: slug(event.target.value) }
                    : {}),
                })
              }
            />
          </label>
          {creating ? (
            <label className="space-y-2 text-sm">
              ID
              <Input
                {...entityFieldProps(draft, 'id')}
                value={value.id}
                disabled={draft.saving}
                onChange={(event) => draft.patch({ id: event.target.value })}
              />
              <span className="block text-xs text-muted-foreground">
                A stable identifier for links to this floorplan.
              </span>
            </label>
          ) : (
            advanced && (
              <div className="text-sm">
                ID
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                  {value.id}
                </p>
              </div>
            )
          )}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Background image"
        description="Optional. The image sits beneath the grid; uploading or removing it stays in this draft."
      >
        <div className="flex flex-wrap items-start gap-4">
          {background && (
            <img
              src={background}
              alt="Floorplan background preview"
              className="max-h-28 max-w-full rounded border border-border object-contain"
            />
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <label className="block space-y-2 text-sm">
              {background ? 'Replace image' : 'Choose image'}
              <Input
                ref={imageInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={busy || draft.saving}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void stageImage(file);
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG, WebP or SVG · up to 10 MB
              {value.image.kind === 'upload'
                ? ' · Replacement not saved yet'
                : ''}
            </p>
            {background && (
              <Button
                variant="outline"
                disabled={busy || draft.saving}
                onClick={() => draft.patch({ image: { kind: 'none' } })}
              >
                Remove image
              </Button>
            )}
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Layout"
        description="Draw the floor, place devices and mark rooms. Undo affects the draft; Discard restores the saved layout."
        actions={
          <>
            <Button
              variant="outline"
              disabled={busy || draft.saving}
              onClick={() => gridInput.current?.click()}
            >
              Import layout
            </Button>
            <Button
              variant="outline"
              disabled={!value.grid_data}
              onClick={() =>
                download(value.grid_data!, `${value.id || 'floorplan'}.json`)
              }
            >
              <Download className="size-4" />
              Download layout
            </Button>
            <Button
              variant="outline"
              disabled={busy || draft.saving}
              onClick={async () => {
                if (
                  await confirmDestructive(
                    'Reset this layout?',
                    'All placements and room masks are cleared in the draft. Discard restores them until you save.',
                  )
                ) {
                  draft.patch({ grid_data: serializeGrid(createEmptyGrid()) });
                  setEpoch((epoch) => epoch + 1);
                }
              }}
            >
              Reset layout
            </Button>
          </>
        }
      >
        <input
          ref={gridInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Import floorplan layout"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void stageGrid(file);
          }}
        />
        {(devices.error || groups.error) && (
          <p role="alert" className="mb-3 text-sm">
            Some rooms or devices could not be loaded. Saved placements remain
            in the draft.{' '}
            <Button
              variant="outline"
              onClick={() => {
                void devices.refetch();
                void groups.refetch();
              }}
            >
              Retry catalogs
            </Button>
          </p>
        )}
        {!grid ? (
          <div className="space-y-3 text-sm" role="alert">
            <p>This layout cannot be edited in this version: {parsed.error}</p>
            <p className="text-muted-foreground">
              Its saved content is retained. Download it for inspection, or
              import a supported layout. Name and image edits preserve the
              existing layout.
            </p>
          </div>
        ) : (
          <div
            inert={draft.saving}
            className={`min-w-0 ${draft.saving ? 'opacity-60' : ''}`}
          >
            <FloorplanGridEditor
              key={`${id}/${epoch}`}
              grid={grid}
              onChange={(next) => {
                const baseline = draft.entry?.baseline.grid_data ?? null;
                const original =
                  baseline === null
                    ? createEmptyGrid()
                    : readFloorplanDraft(baseline).grid;
                draft.patch({
                  grid_data: deepEqual(original, next)
                    ? baseline
                    : serializeGrid(next),
                });
              }}
              availableDevices={available}
              availableGroups={groups.data}
              backgroundImageUrl={background}
            />
          </div>
        )}
      </SettingsSection>
      {linked.length > 0 && (
        <SettingsSection
          title="Placed devices & rooms"
          description="Open related settings while keeping your floorplan draft."
        >
          <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
            {linked.slice(0, showAll ? undefined : 8).map((item) => (
              <Link
                className="settings-link break-words"
                key={item.key}
                to={item.href}
              >
                {item.name}
              </Link>
            ))}
            {linked.length > 8 && (
              <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${linked.length}`}
              </Button>
            )}
          </div>
        </SettingsSection>
      )}
      <EntitySaveBar
        draft={{ ...draft, discard }}
        disabled={busy}
        createLabel={creating ? 'Create floorplan' : undefined}
      />
    </>
  );
}
