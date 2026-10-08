import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useGroups, type Group } from '@/hooks/useConfig';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { configItemHref } from '@/lib/configItemHref';
import { groupDeviceKey } from '@/lib/groupGraph';
import { offerUndo } from '@/lib/undo';
import { Button } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

type Mode = 'rename' | 'rooms' | null;

/**
 * Everyday edits for one device, offered where the device is used (a room
 * page) so renaming it or moving it between rooms does not need a trip into
 * Settings. Both write through the same APIs as the settings editors.
 */
export function DeviceQuickEdit({
  deviceKey,
  label,
}: {
  deviceKey: string;
  label: string;
}) {
  const [mode, setMode] = useState<Mode>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`More for ${label}`}
            title={`More for ${label}`}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode('rename')}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode('rooms')}>
            Rooms…
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={configItemHref('device', deviceKey)}>
              Device settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === 'rename' && (
        <RenameDevice
          deviceKey={deviceKey}
          label={label}
          close={() => setMode(null)}
        />
      )}
      {mode === 'rooms' && (
        <DeviceRooms
          deviceKey={deviceKey}
          label={label}
          close={() => setMode(null)}
        />
      )}
    </>
  );
}

function RenameDevice({
  deviceKey,
  label,
  close,
}: {
  deviceKey: string;
  label: string;
  close: () => void;
}) {
  const settings = useDeviceSettings(deviceKey);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = settings.data;
  const value = name ?? current?.display_name ?? label;
  async function save() {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      const previous = current;
      const next = { ...current, display_name: value.trim() || null };
      const saved = (await settings.save(next, current)) ?? next;
      close();
      offerUndo(
        value.trim() ? `Renamed to ${value.trim()}` : 'Using the reported name',
        () =>
          settings.save(
            { ...saved, display_name: previous.display_name },
            saved,
          ),
        `Name restored`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not rename.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => !open && close()}
      title={`Rename ${label}`}
      description="Leave empty to use the name the device reports."
      guard={{ dirty: name !== null && name !== current?.display_name }}
    >
      <form
        className="grid gap-3 p-1"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          aria-label="Device name"
          autoFocus
          value={value}
          disabled={!current}
          onChange={(event) => setName(event.target.value)}
        />
        {settings.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load this device's settings.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!current || saving}>
            {saving ? 'Saving…' : 'Save name'}
          </Button>
        </div>
      </form>
    </ResponsiveOverlay>
  );
}

/** The stored row: `device_keys` is derived by the server and not compared. */
function authoredGroup(group: Group): Group {
  const { device_keys: _derived, ...authored } = group;
  return authored;
}

function withMembership(group: Group, deviceKey: string, member: boolean) {
  const authored = authoredGroup(group);
  const devices = authored.devices.filter(
    (device) => groupDeviceKey(device) !== deviceKey,
  );
  if (member) {
    const slash = deviceKey.indexOf('/');
    devices.push({
      integration_id: deviceKey.slice(0, slash),
      device_id: deviceKey.slice(slash + 1),
    });
  }
  return { ...authored, devices };
}

function DeviceRooms({
  deviceKey,
  label,
  close,
}: {
  deviceKey: string;
  label: string;
  close: () => void;
}) {
  const groups = useGroups();
  const rows = useMemo(
    () =>
      [...groups.data].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [groups.data],
  );
  const initial = useMemo(
    () =>
      new Set(
        rows
          .filter((row) =>
            row.devices.some((d) => groupDeviceKey(d) === deviceKey),
          )
          .map((row) => row.id),
      ),
    [rows, deviceKey],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = selected ?? initial;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = rows.filter(
    (row) => chosen.has(row.id) !== initial.has(row.id),
  );
  /** Writes each group in turn; returns what the server saved. */
  async function apply(targets: Group[], membership: (row: Group) => boolean) {
    const saved: Group[] = [];
    for (const row of targets) {
      const result = await groups.update(
        row.id,
        withMembership(row, deviceKey, membership(row)),
        authoredGroup(row),
      );
      if (result) saved.push(result);
    }
    return saved;
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      const before = new Set(initial);
      const saved = await apply(changed, (row) => chosen.has(row.id));
      close();
      offerUndo(
        `Updated rooms for ${label}`,
        () => apply(saved, (row) => before.has(row.id)),
        `Rooms restored for ${label}`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not update rooms.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => !open && close()}
      title={`Rooms for ${label}`}
      description="A device can belong to several rooms or groups."
      guard={{ dirty: changed.length > 0 }}
    >
      <div className="grid gap-3 p-1">
        {groups.loading ? (
          <p className="text-sm text-muted-foreground">Loading rooms…</p>
        ) : (
          <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <Checkbox
                    checked={chosen.has(row.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(chosen);
                      if (checked === true) next.add(row.id);
                      else next.delete(row.id);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.hidden && (
                    <span className="text-xs text-muted-foreground">
                      Hidden
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || changed.length === 0}
          >
            {saving ? 'Saving…' : 'Save rooms'}
          </Button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}
