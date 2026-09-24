import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { loadCreationDraft } from '@/lib/creationDraft';
import {
  captureSceneDeviceState,
  isControllable,
  manualRoomState,
} from '@/lib/sceneCapture';
import {
  useDeviceDisplayNames,
  useGroups,
  useScenes,
  type Group,
  type SceneDeviceState,
} from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';
import { ConfigPageHeader } from '../page-header';
import { DeviceStateEditor } from '@/ui/SceneDeviceStateEditor';
import { Advanced } from '@/ui/primitives/advanced';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Skeleton } from '@/ui/primitives/skeleton';
import { StatusRegion } from '@/ui/config/StatusRegion';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';

type DeviceTarget = {
  mode: 'captured' | 'manual';
  state: SceneDeviceState;
  notes: string[];
};

export function slugifySceneId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'new_scene';
}

export function suggestSceneName(
  deviceNames: string[],
  roomNames: string[],
): string {
  const rooms = roomNames.filter(Boolean);
  const devices = deviceNames.filter(Boolean);
  if (rooms.length > 0) {
    return rooms.length === 1
      ? `${rooms[0]} scene`
      : `${rooms.slice(0, 2).join(' & ')} scene`;
  }
  if (devices.length === 1) {
    return `${devices[0]} scene`;
  }
  if (devices.length > 1) {
    return `${devices.slice(0, 2).join(' & ')} scene`;
  }
  return 'New scene';
}

export default function NewScenePage() {
  const navigate = useNavigate();
  const { data: scenes, create } = useScenes();
  const { data: groups, loading: groupsLoading } = useGroups();
  const devicesState = useDevicesState();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();

  const [query, setQuery] = useState('');
  const [deviceTargets, setDeviceTargets] = useState<
    Record<string, DeviceTarget>
  >({});
  const [roomTargets, setRoomTargets] = useState<
    Record<string, SceneDeviceState>
  >({});
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const routineDraft = useMemo(
    () => loadCreationDraft<{ name?: string }>('routine'),
    [],
  );
  const deviceDisplayNameMap = useMemo(
    () =>
      deviceDisplayNames.reduce<Record<string, string>>((names, row) => {
        names[row.device_key] = row.display_name;
        return names;
      }, {}),
    [deviceDisplayNames],
  );

  const deviceEntries = useMemo(
    () =>
      Object.entries(devicesState ?? {})
        .filter(([, device]) => isControllable(device))
        .map(([key, device]) => ({
          key,
          device,
          label: getDeviceDisplayLabelFromKey(
            key,
            device.name,
            deviceDisplayNameMap,
          ),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [deviceDisplayNameMap, devicesState],
  );
  const rooms: Group[] = groups ?? [];

  const search = query.trim().toLowerCase();
  const matchingDevices = deviceEntries
    .filter(
      ({ key, label }) =>
        !(key in deviceTargets) &&
        (!search || `${label} ${key}`.toLowerCase().includes(search)),
    )
    .slice(0, 8);
  const matchingRooms = rooms
    .filter(
      (room) =>
        !(room.id in roomTargets) &&
        (!search || `${room.name} ${room.id}`.toLowerCase().includes(search)),
    )
    .slice(0, 6);

  const selectedDeviceNames = Object.keys(deviceTargets).map(
    (key) => deviceEntries.find((entry) => entry.key === key)?.label ?? key,
  );
  const selectedRoomNames = Object.keys(roomTargets).map(
    (roomId) => rooms.find((room) => room.id === roomId)?.name ?? roomId,
  );
  const suggestedName = suggestSceneName(
    selectedDeviceNames,
    selectedRoomNames,
  );
  const effectiveName = nameEdited ? name : name;
  const effectiveId = idEdited
    ? id
    : slugifySceneId(nameEdited ? name : suggestedName);

  const addDevice = (key: string) => {
    const captured = captureSceneDeviceState(devicesState?.[key]);
    setDeviceTargets((current) => ({
      ...current,
      [key]: { mode: 'captured', state: captured.state, notes: captured.notes },
    }));
    setOpenRow(`device:${key}`);
  };
  const addRoom = (roomId: string) => {
    setRoomTargets((current) => ({ ...current, [roomId]: manualRoomState() }));
    setOpenRow(`room:${roomId}`);
  };
  const removeDevice = (key: string) => {
    setDeviceTargets((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const removeRoom = (roomId: string) => {
    setRoomTargets((current) => {
      const next = { ...current };
      delete next[roomId];
      return next;
    });
  };

  const targetCount =
    Object.keys(deviceTargets).length + Object.keys(roomTargets).length;
  const finalName = (nameEdited && name.trim() ? name : suggestedName).trim();
  const finalId = (idEdited && id.trim() ? id : effectiveId).trim();

  const submit = async (empty: boolean) => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const scene = await create({
        id: finalId,
        name: finalName,
        hidden: false,
        device_states: empty
          ? {}
          : Object.fromEntries(
              Object.entries(deviceTargets).map(([key, target]) => [
                key,
                target.state,
              ]),
            ),
        group_states: empty ? {} : roomTargets,
        group_state_order: empty ? [] : Object.keys(roomTargets),
      } as never);
      const created = (scene as { id?: string })?.id ?? finalId;
      if (routineDraft) {
        navigate(`/config/routines/new?scene=${encodeURIComponent(created)}`);
        return;
      }
      navigate(`/config/scenes/${encodeURIComponent(created)}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Could not create',
      );
    } finally {
      setSaving(false);
    }
  };

  if (groupsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <ConfigPageHeader
        title="New scene"
        description="Pick what the scene should affect. Scenes only change devices when you activate them."
      />

      {routineDraft ? (
        <Alert>
          <AlertDescription>
            You are building a scene from the routine you started. Creating it
            returns to that routine with the new scene chosen as its outcome.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-border bg-background/70 p-4">
        <h2 className="text-sm font-semibold">
          Which devices or rooms should this scene affect?
        </h2>
        <Input
          aria-label="Search devices and rooms"
          placeholder="Search by name, id, or integration"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {matchingDevices.length === 0 && matchingRooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing left to add{search ? ' for that search' : ''}.
          </p>
        ) : (
          <ul className="space-y-1">
            {matchingRooms.map((room) => (
              <li
                key={`room:${room.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {room.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    room
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addRoom(room.id)}
                >
                  Add room
                </Button>
              </li>
            ))}
            {matchingDevices.map(({ key, label }) => (
              <li
                key={`device:${key}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {label}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {key}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addDevice(key)}
                >
                  Add device
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-background/70 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Selected targets</h2>
          <span className="text-xs text-muted-foreground">
            {targetCount} target{targetCount === 1 ? '' : 's'}
          </span>
        </div>
        {targetCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No targets yet. Add a device or room above; the scene will set what
            you see here.
          </p>
        ) : null}

        {Object.entries(deviceTargets).map(([key, target]) => {
          const label =
            deviceEntries.find((entry) => entry.key === key)?.label ?? key;
          const open = openRow === `device:${key}`;
          return (
            <div
              key={key}
              className="space-y-2 rounded-xl border border-border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <Badge variant="outline">
                      {target.mode === 'captured'
                        ? 'Captured from requested state'
                        : 'Set manually'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {describeState(target.state)}
                  </p>
                  {target.notes.map((note) => (
                    <p
                      key={note}
                      className="text-xs text-amber-700 dark:text-amber-300"
                    >
                      {note}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const captured = captureSceneDeviceState(
                        devicesState?.[key],
                      );
                      setDeviceTargets((current) => ({
                        ...current,
                        [key]:
                          current[key]?.mode === 'captured'
                            ? {
                                mode: 'manual',
                                state: current[key].state,
                                notes: [],
                              }
                            : {
                                mode: 'captured',
                                state: captured.state,
                                notes: captured.notes,
                              },
                      }));
                      setOpenRow(`device:${key}`);
                    }}
                  >
                    {target.mode === 'captured'
                      ? 'Set manually'
                      : 'Use captured state'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open}
                    onClick={() => setOpenRow(open ? null : `device:${key}`)}
                  >
                    {open ? 'Close' : 'Adjust'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeDevice(key)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {open ? (
                <div className="space-y-3 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDeviceTargets((current) => {
                        const captured = captureSceneDeviceState(
                          devicesState?.[key],
                        );
                        return {
                          ...current,
                          [key]: {
                            mode: 'captured',
                            state: captured.state,
                            notes: captured.notes,
                          },
                        };
                      })
                    }
                  >
                    Use captured requested state
                  </Button>
                  <DeviceStateEditor
                    config={target.state}
                    onChange={(state) =>
                      setDeviceTargets((current) => ({
                        ...current,
                        [key]: { mode: 'manual', state, notes: [] },
                      }))
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })}

        {Object.entries(roomTargets).map(([roomId, state]) => {
          const label =
            rooms.find((room) => room.id === roomId)?.name ?? roomId;
          const open = openRow === `room:${roomId}`;
          return (
            <div
              key={roomId}
              className="space-y-2 rounded-xl border border-border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <Badge variant="outline">Set manually</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {describeState(state)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    A room has no single physical state: this is the shared
                    state every member gets.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open}
                    onClick={() => setOpenRow(open ? null : `room:${roomId}`)}
                  >
                    {open ? 'Close' : 'Adjust'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeRoom(roomId)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {open ? (
                <div className="border-t border-border pt-3">
                  <DeviceStateEditor
                    config={state}
                    onChange={(next) =>
                      setRoomTargets((current) => ({
                        ...current,
                        [roomId]: next,
                      }))
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-background/70 p-4">
        <h2 className="text-sm font-semibold">What this will set</h2>
        {targetCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet: a scene with no targets does not change anything.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {Object.entries(deviceTargets).map(([key, target]) => (
              <li key={key} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">
                  {deviceEntries.find((entry) => entry.key === key)?.label ??
                    key}
                </span>
                <span className="text-muted-foreground">
                  {describeState(target.state)}
                </span>
                <span className="text-xs text-muted-foreground">
                  (
                  {target.mode === 'captured'
                    ? 'captured from requested state'
                    : 'set manually'}
                  )
                </span>
              </li>
            ))}
            {Object.entries(roomTargets).map(([roomId, state]) => (
              <li key={roomId} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">
                  {rooms.find((room) => room.id === roomId)?.name ?? roomId}
                </span>
                <span className="text-muted-foreground">
                  {describeState(state)}
                </span>
                <span className="text-xs text-muted-foreground">
                  (shared room state, set manually)
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          A captured target means the app's requested state, not a claim about
          the physical device. Nothing is commanded until you activate the
          scene.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-background/70 p-4">
        <h2 className="text-sm font-semibold">Details</h2>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input
            value={nameEdited ? name : suggestedName}
            onChange={(event) => {
              setName(event.target.value);
              setNameEdited(true);
            }}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Scene ID</span>
          <Input
            className="font-mono"
            value={idEdited ? id : effectiveId}
            onChange={(event) => {
              setId(event.target.value);
              setIdEdited(true);
            }}
          />
          <span className="block text-xs text-muted-foreground">
            Scenes and routines refer to this id. Existing scenes:{' '}
            {scenes.map((scene) => scene.id).join(', ') || 'none yet'}.
          </span>
        </label>
      </section>

      <Advanced
        label="Advanced"
        description="Escape hatches for cases the basic flow does not cover."
      >
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            An empty scene shell is not useful on its own: you still have to
            give it targets before it can do anything.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() =>
              void confirmDestructive(
                'Save an empty scene draft?',
                'It will have no targets and will not change anything until you edit it.',
                'Save empty draft',
              ).then((ok) => {
                if (ok) void submit(true);
              })
            }
          >
            Save empty draft
          </Button>
        </div>
      </Advanced>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <StatusRegion message={status} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={
            saving || targetCount === 0 || finalName.trim().length === 0
          }
          onClick={() => void submit(false)}
        >
          {saving ? 'Creating…' : 'Create scene'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate('/config/scenes')}
          disabled={saving}
        >
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">
          {targetCount === 0
            ? 'Add at least one target, or use the empty draft escape hatch under Advanced.'
            : 'Creating saves the scene; activate it when you want it to run.'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Need a room to group devices first?{' '}
        <Link className="underline" to="/config/groups/new">
          Create a room
        </Link>
        .
      </p>
    </div>
  );
}

function describeState(state: SceneDeviceState): string {
  const parts: string[] = [];
  if (state.power !== null && state.power !== undefined) {
    parts.push(state.power ? 'On' : 'Off');
  }
  if (state.brightness !== null && state.brightness !== undefined) {
    parts.push(`${Math.round(state.brightness * 100)}% brightness`);
  }
  if (state.color) {
    parts.push('Color set');
  }
  if (state.transition !== null && state.transition !== undefined) {
    parts.push(`Transition ${state.transition}s`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing set yet';
}
