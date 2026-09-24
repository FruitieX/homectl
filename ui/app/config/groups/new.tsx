import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { type Group, useGroups } from '@/hooks/useConfig';
import { groupDeviceKey, suggestId } from '@/lib/groupGraph';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { ConfigField, ConfigFormSection } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

import {
  DeviceAdder,
  RoomAdder,
  SelectedDeviceRows,
  SelectedRoomRows,
  useDeviceLookups,
  type GroupDeviceRef,
} from './shared';

/**
 * Room creation: name first (the id is suggested from it and stays editable),
 * then optional device and linked-room additions, then a short review. A room
 * with no devices can be created, but it says so instead of pretending to be
 * complete.
 */
export default function NewGroupPage() {
  const navigate = useNavigate();
  const { data: groups, loading, error, refetch, create } = useGroups();
  const lookups = useDeviceLookups();

  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [devices, setDevices] = useState<GroupDeviceRef[]>([]);
  const [linkedGroups, setLinkedGroups] = useState<string[]>([]);
  const [showAllInList, setShowAllInList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const suggestedId = useMemo(
    () =>
      suggestId(
        name,
        groups.map((group) => group.id),
      ),
    [groups, name],
  );
  const effectiveId = idEdited ? id : suggestedId;

  const trimmedName = name.trim();
  const valid = trimmedName !== '' && effectiveId !== '';
  const idTaken = groups.some((group) => group.id === effectiveId);

  const submit = async () => {
    if (!valid || idTaken) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await create({
        id: effectiveId,
        name: trimmedName,
        hidden: false,
        devices,
        linked_groups: linkedGroups,
      } as Partial<Group>);
      navigate(`/config/groups/${encodeURIComponent(effectiveId)}`, {
        replace: true,
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Could not create the room',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DetailPageShell
      crumbs={[
        { label: 'Settings', to: '/config' },
        { label: 'Rooms', to: '/config/groups' },
        { label: 'New room' },
      ]}
      backTo="/config/groups"
      backLabel="Back to rooms"
      title="New room"
      status="Name it first; devices and nested rooms are optional."
      loading={loading}
      error={error}
      onRetry={() => void refetch()}
    >
      <div className="space-y-4">
        <ConfigFormSection
          title="Name and id"
          description="The id is used in scenes, routines, and nested room references."
        >
          <ConfigField label="Name">
            <Input
              data-field="name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Living room"
            />
          </ConfigField>
          <ConfigField
            label="ID"
            description="Suggested from the name. Change it now if you need a specific id."
          >
            <Input
              data-field="id"
              value={effectiveId}
              onChange={(event) => {
                setIdEdited(true);
                setId(event.target.value);
              }}
              placeholder="living_room"
            />
          </ConfigField>
          {idTaken ? (
            <p className="text-xs text-destructive">
              A room with this id already exists.
            </p>
          ) : null}
        </ConfigFormSection>

        <div className="rounded-2xl border border-border/70 bg-card">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 p-4 text-left text-sm font-medium"
            aria-expanded={showAllInList}
            onClick={() => setShowAllInList((current) => !current)}
          >
            <span>Devices and linked rooms</span>
            <span className="text-xs font-normal text-muted-foreground">
              {devices.length} device{devices.length === 1 ? '' : 's'} ·{' '}
              {linkedGroups.length} linked
            </span>
          </button>
          {showAllInList ? (
            <div className="space-y-5 border-t border-border/70 p-4">
              <div className="space-y-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Devices
                </p>
                <SelectedDeviceRows
                  devices={devices}
                  onChange={setDevices}
                  labelFor={lookups.labelFor}
                  presentKeys={lookups.presentKeys}
                />
                <DeviceAdder
                  options={lookups.options}
                  selectedKeys={new Set(devices.map(groupDeviceKey))}
                  onAdd={(device) =>
                    setDevices((current) => [
                      ...current,
                      {
                        integration_id: device.integration_id,
                        device_id: device.id,
                      },
                    ])
                  }
                />
              </div>
              <div className="space-y-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Linked rooms
                </p>
                <SelectedRoomRows
                  ids={linkedGroups}
                  groups={groups}
                  onChange={setLinkedGroups}
                />
                <RoomAdder
                  groups={groups}
                  groupId={effectiveId}
                  selectedIds={linkedGroups}
                  onAdd={(next) =>
                    setLinkedGroups((current) => [...current, next])
                  }
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <p className="text-sm">
            {valid ? (
              <>
                Creates <span className="font-medium">{trimmedName}</span> (
                <span className="font-mono text-xs">{effectiveId}</span>) with{' '}
                {devices.length} device{devices.length === 1 ? '' : 's'} and{' '}
                {linkedGroups.length} linked room
                {linkedGroups.length === 1 ? '' : 's'}.
              </>
            ) : (
              'Give the room a name to continue.'
            )}
          </p>
          {valid && devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This will be an empty room. You can add devices later — it becomes
              useful in scenes and routines once it has some.
            </p>
          ) : null}
          {submitError ? (
            <p className="text-xs text-destructive">{submitError}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void submit()}
              disabled={!valid || idTaken || submitting}
              aria-busy={submitting}
            >
              {submitting ? 'Creating…' : 'Create room'}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/config/groups">Cancel</Link>
            </Button>
          </div>
        </div>
      </div>
    </DetailPageShell>
  );
}
