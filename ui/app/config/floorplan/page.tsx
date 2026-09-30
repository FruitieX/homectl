import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Download,
  Trash2,
  MoreHorizontal,
  Layers3,
  Upload,
  Image as ImageIcon,
  RotateCcw,
  Pencil,
  Map,
} from 'lucide-react';
import {
  useFloorplans,
  useGroups,
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
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
import { getSensorMarkerKind } from '@/lib/sensorMarker';
import { getResolvedDeviceColorState } from '@/lib/colors';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { readFloorplanDraft } from '@/lib/floorplanDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import { deepEqual } from '@/lib/configSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { useRetainedDrafts } from '@/ui/settings/SettingsDrafts';
import {
  createEmptyGrid,
  serializeGrid,
  type FloorplanGrid,
} from '@/lib/floorplan-editor';
import { FloorplanEditorWorkspace } from '@/ui/floorplan/FloorplanEditorWorkspace';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/ui/primitives/dropdown-menu';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { useFloorplanEditor, type FloorplanDraft } from './shared';
import '@/ui/floorplan/floorplan-editor.css';
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
  const [params, setParams] = useSearchParams(),
    floorplans = useFloorplans();
  const creating = params.get('new') === '1',
    id = params.get('id') ?? floorplans.data[0]?.id ?? '';
  const tabs = (
    <div className="fp-documents" role="tablist" aria-label="Floorplans">
      {floorplans.data.map((row) => (
        <Button
          key={row.id}
          variant="ghost"
          role="tab"
          aria-selected={!creating && id === row.id}
          className={`fp-document ${!creating && id === row.id ? 'active' : ''}`}
          onClick={() => setParams({ id: row.id })}
        >
          <Layers3 />
          {row.name}
        </Button>
      ))}
      {creating && (
        <Button role="tab" aria-selected="true" className="fp-document active">
          New floorplan
        </Button>
      )}
      <Button
        className="fp-add-document"
        variant="ghost"
        size="icon"
        title="Add floorplan"
        aria-label="Add floorplan"
        onClick={() => setParams({ new: '1' })}
      >
        <Plus />
      </Button>
    </div>
  );
  return (
    <div className="floorplan-page">
      {floorplans.error && (
        <div className="fp-banner" role="alert">
          {floorplans.error}
          <Button variant="outline" onClick={() => void floorplans.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {creating || id ? (
        <FloorplanEditor
          key={creating ? 'new' : id}
          id={id}
          creating={creating}
          tabs={tabs}
          onCreated={(id) => setParams({ id }, { replace: true })}
          onDeleted={() => setParams({}, { replace: true })}
        />
      ) : (
        <>
          <div className="fp-document-bar">{tabs}</div>
          <div className="p-6 text-sm">
            {floorplans.loading ? (
              'Loading floorplans…'
            ) : (
              <>
                <p className="mb-4">
                  No floorplans yet. Add one to place your rooms and devices.
                </p>
                <Button onClick={() => setParams({ new: '1' })}>
                  <Plus />
                  Add floorplan
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function FloorplanEditor({
  id,
  creating,
  onCreated,
  onDeleted,
  tabs,
}: {
  id: string;
  creating: boolean;
  onCreated: (id: string) => void;
  onDeleted: () => void;
  tabs: ReactNode;
}) {
  const api = useFloorplanEditor(id, creating),
    { advanced } = useSettingsPreferences();
  const devices = useDevicesApi(),
    groups = useGroups(),
    names = useDeviceDisplayNames(),
    sensorConfigs = useDeviceSensorConfigs();
  const [fileError, setFileError] = useState(''),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0),
    [revealLayout, setRevealLayout] = useState(0);
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
  const retainedDrafts = useRetainedDrafts(draft.key);
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
        sensorMarker:
          'Sensor' in device.data
            ? getSensorMarkerKind(
                device,
                sensorConfigs.data.find(
                  (row) => row.device_ref === getDeviceKey(device),
                ),
              )
            : undefined,
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
  useEffect(() => {
    if (draft.errors.some((e) => e.field === 'name' || e.field === 'id'))
      setRevealLayout((n) => n + 1);
  }, [draft.errors]);
  const changeGrid = useCallback(
    (next: FloorplanGrid) => {
      const baseline = draft.entry?.baseline.grid_data ?? null;
      const original =
        baseline === null
          ? createEmptyGrid()
          : readFloorplanDraft(baseline).grid;
      draft.patch({
        grid_data: deepEqual(original, next) ? baseline : serializeGrid(next),
      });
    },
    [draft],
  );
  if (!value)
    return (
      <>
        <div className="fp-document-bar">{tabs}</div>
        <div
          className="p-6 text-sm"
          role={api.saved.isError ? 'alert' : undefined}
        >
          {api.saved.isError ? (
            <>
              {api.saved.error.message}
              <Button
                variant="outline"
                onClick={() => void api.saved.refetch()}
              >
                Retry
              </Button>
            </>
          ) : (
            'Loading floorplan…'
          )}
        </div>
      </>
    );
  const layoutContent = (
    <>
      <label className="fp-field">
        Name
        <Input
          {...entityFieldProps(draft, 'name')}
          id="floorplan-name"
          value={value.name}
          disabled={draft.saving}
          onChange={(e) =>
            draft.patch({
              name: e.target.value,
              ...(creating && (value.id === '' || value.id === slug(value.name))
                ? { id: slug(e.target.value) }
                : {}),
            })
          }
        />
      </label>
      {creating ? (
        <label className="fp-field">
          ID
          <Input
            {...entityFieldProps(draft, 'id')}
            value={value.id}
            onChange={(e) => draft.patch({ id: e.target.value })}
          />
        </label>
      ) : (
        advanced && <p className="fp-key">{value.id}</p>
      )}
      <div className="fp-section-heading">
        <ImageIcon />
        Background image
      </div>
      {background ? (
        <img
          className="fp-image-preview"
          src={background}
          alt="Floorplan background preview"
        />
      ) : (
        <p className="fp-explanation">
          No background. Draw on the tile grid, or add an image.
        </p>
      )}
      <div className="fp-small-actions">
        <Button variant="outline" onClick={() => imageInput.current?.click()}>
          {background ? 'Replace…' : 'Choose image…'}
        </Button>
        {background && (
          <Button
            variant="outline"
            onClick={() => draft.patch({ image: { kind: 'none' } })}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="fp-explanation">
        PNG, JPEG, WebP or SVG · up to 10 MB
        {value.image.kind === 'upload' ? ' · replacement not saved yet' : ''}
      </p>
    </>
  );
  return (
    <>
      <div className="fp-document-bar">
        {tabs}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="fp-doc-menu relative"
              variant="ghost"
              size="icon"
              aria-label="Document menu"
              title={
                retainedDrafts.length
                  ? 'Document menu · Other unsaved drafts'
                  : 'Document menu'
              }
              disabled={busy || draft.saving}
            >
              <MoreHorizontal />
              {retainedDrafts.length > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
            {retainedDrafts.length > 0 && (
              <>
                <DropdownMenuLabel>Unsaved drafts</DropdownMenuLabel>
                {retainedDrafts.map((retained) => (
                  <DropdownMenuItem key={retained.key} asChild>
                    <Link to={retained.href}>
                      <Pencil />
                      {retained.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link to="/config/floorplan?new=1">
                <Plus />
                New floorplan
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRevealLayout((n) => n + 1)}>
              <Pencil />
              Rename & properties
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => gridInput.current?.click()}>
              <Upload />
              Import layout…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!value.grid_data}
              onSelect={() =>
                download(value.grid_data!, `${value.id || 'floorplan'}.json`)
              }
            >
              <Download />
              Export layout JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (
                  await confirmDestructive(
                    'Reset this layout?',
                    'All placements and room areas are cleared in the draft. Discard restores them until you save.',
                    'Reset layout',
                  )
                ) {
                  draft.patch({ grid_data: serializeGrid(createEmptyGrid()) });
                  setEpoch((n) => n + 1);
                }
              }}
            >
              <RotateCcw />
              Reset layout…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!draft.dirty && !draft.conflict}
              onSelect={discard}
            >
              <RotateCcw />
              Discard unsaved changes
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/map">
                <Map />
                Open map
              </Link>
            </DropdownMenuItem>
            {!creating && (
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => void remove()}
              >
                <Trash2 />
                Delete floorplan…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <EntitySaveBar
          inline
          compact
          draft={{ ...draft, discard }}
          disabled={busy}
          createLabel={creating ? 'Create' : undefined}
        />
      </div>
      {api.saved.isError && (
        <div className="fp-banner" role="alert">
          Could not refresh this floorplan. Your draft is kept.
          <Button variant="outline" onClick={() => void api.saved.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {fileError && (
        <div className="fp-banner text-destructive" role="alert">
          {fileError}
        </div>
      )}
      {(devices.error || groups.error) && (
        <div className="fp-banner" role="alert">
          Some rooms or devices could not load. Saved placements remain.
          <Button
            variant="outline"
            onClick={() => {
              void devices.refetch();
              void groups.refetch();
            }}
          >
            Retry catalogs
          </Button>
        </div>
      )}
      <input
        ref={imageInput}
        type="file"
        className="hidden"
        aria-label="Choose floorplan background image"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void stageImage(file);
        }}
      />
      <input
        ref={gridInput}
        type="file"
        className="hidden"
        aria-label="Import floorplan layout"
        accept=".json,application/json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void stageGrid(file);
        }}
      />
      <FloorplanEditorWorkspace
        key={id}
        historyEpoch={epoch}
        grid={parsed.grid}
        onChange={changeGrid}
        devices={available}
        groups={groups.data}
        background={background}
        name={value.name}
        layoutContent={layoutContent}
        disabled={busy || draft.saving}
        error={parsed.error}
        initialTool={creating || !parsed.grid ? 'layout' : undefined}
        revealLayout={revealLayout}
      />
    </>
  );
}
