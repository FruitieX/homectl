import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import {
  type Group,
  useGroups,
  useRoutines,
  useScenes,
} from '@/hooks/useConfig';
import {
  missingGroupDevices,
  describeGroupUsage,
  groupDeviceKey,
  summarizeGroupDeviceReferences,
} from '@/lib/groupGraph';
import {
  resolveGroupDeviceKeys,
  type GroupPreviewMap,
} from '@/lib/group-floorplan-preview';
import { getSensorDetails } from '@/lib/sensorInteraction';
import {
  deviceReachability,
  reachabilityLabels,
} from '@/lib/deviceReachability';
import { BoundedList } from '@/ui/config/BoundedList';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import { StatusRegion, useStatusAnnouncements } from '@/ui/config/StatusRegion';
import { useDirtyNavigationGuard } from '@/ui/config/useDirtyNavigationGuard';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionParams } from '@/ui/config/useSectionParams';
import { ConfigField, ConfigToggleRow } from '@/ui/config-form';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { toast } from 'sonner';
import { Button } from '@/ui/primitives/button';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { Input } from '@/ui/primitives/input';
import { checkboxClassName } from '@/ui/form-styles';

import {
  DeviceAdder,
  RoomAdder,
  SelectedDeviceRows,
  SelectedRoomRows,
  useDeviceLookups,
  type GroupDeviceRef,
} from './shared';

const DEVICE_FIELDS = ['devices'] as const;
const LINK_FIELDS = ['linked_groups'] as const;
const DETAIL_FIELDS = ['name', 'hidden'] as const;

function examples(names: string[], total: number): string {
  const shown = names.slice(0, 3).join(', ');
  if (total === 0) return 'none yet';
  if (names.length <= 3) return shown;
  return `${shown} and ${names.length - 3} more`;
}

export default function GroupDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: groups, loading, error, refetch, update, remove } = useGroups();
  const { data: scenes } = useScenes();
  const { data: routines } = useRoutines();
  const lookups = useDeviceLookups();
  const { activeSection, target, openSection } = useSectionParams();
  const { status, announce } = useStatusAnnouncements();

  const group = groups.find((entry) => entry.id === id);
  const replaceTarget =
    target && target.startsWith('replace:')
      ? target.slice('replace:'.length)
      : null;

  const usage = useMemo(
    () => describeGroupUsage({ scenes, routines }, id),
    [id, routines, scenes],
  );

  const deviceNames = useMemo(
    () => (group?.devices ?? []).map((device) => lookups.labelFor(device)),
    [group?.devices, lookups],
  );

  const saveSection = useCallback(
    async (merged: Group) => {
      await update(merged.id, merged);
      announce('Saved', 'success');
    },
    [announce, update],
  );

  const detailEditor = useSectionEditor<Group>({
    item: group,
    fields: DETAIL_FIELDS,
    validate: (draft) =>
      String(draft.name ?? '').trim() === ''
        ? [{ field: 'name', message: 'Give this room a name' }]
        : [],
    save: saveSection,
  });

  const deviceEditor = useSectionEditor<Group>({
    item: group,
    fields: DEVICE_FIELDS,
    save: saveSection,
  });

  const linkEditor = useSectionEditor<Group>({
    item: group,
    fields: LINK_FIELDS,
    save: saveSection,
  });

  const dirty = detailEditor.dirty || deviceEditor.dirty || linkEditor.dirty;
  useDirtyNavigationGuard(dirty);

  useAssistantPageContext(
    group
      ? { kind: 'group', id: group.id, label: group.name }
      : { kind: 'group' },
  );

  // Focus the heading of a section opened through the URL (?section=…).
  const headingRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!activeSection || loading) return;
    const node = headingRefs.current[activeSection];
    if (node) {
      node.focus();
      node.scrollIntoView({ block: 'start' });
    }
  }, [activeSection, loading]);

  // Focus a nested target (?target=…) once the section is rendered.
  useEffect(() => {
    if (!target || loading) return;
    const node = document.querySelector<HTMLElement>(
      `[data-target-key="${CSS.escape(target)}"]`,
    );
    if (node) {
      node.scrollIntoView({ block: 'center' });
      const focusable = node.querySelector<HTMLElement>('button, a, input');
      focusable?.focus();
    }
  }, [loading, target]);

  const missing = group ? missingGroupDevices(group, lookups.presentKeys) : [];
  const deviceReferenceCounts = group
    ? summarizeGroupDeviceReferences(group, lookups.presentKeys)
    : { available: 0, missing: [], saved: 0 };
  const previewGroups = useMemo(
    () =>
      Object.fromEntries(
        groups.map((entry) => [
          entry.id,
          { devices: entry.devices, linked_groups: entry.linked_groups },
        ]),
      ) as GroupPreviewMap,
    [groups],
  );
  const resolvedDeviceKeys = group
    ? resolveGroupDeviceKeys(group.id, previewGroups)
    : [];
  const availableResolvedDeviceCount = resolvedDeviceKeys.filter((key) =>
    lookups.presentKeys.has(key),
  ).length;
  const roomNamesByDevice = useMemo(() => {
    const names: Record<string, string[]> = {};
    for (const room of groups) {
      for (const member of room.devices) {
        const key = groupDeviceKey(member);
        (names[key] ??= []).push(room.name);
      }
    }
    return names;
  }, [groups]);

  // Facts with a count of zero are not facts: say what the room has, and name
  // the single scene or routine that uses it instead of a chain of counts.
  const usageUsers = [...usage.scenes, ...usage.routines];
  const usageSentence =
    usageUsers.length === 0
      ? null
      : usageUsers.length === 1
        ? `used by ${usageUsers[0].name}`
        : `used by ${usage.scenes.length} scene${usage.scenes.length === 1 ? '' : 's'} and ${usage.routines.length} routine${usage.routines.length === 1 ? '' : 's'}`;
  const statusSentence = group
    ? [
        `${deviceReferenceCounts.available} available device${deviceReferenceCounts.available === 1 ? '' : 's'}`,
        deviceReferenceCounts.missing.length > 0
          ? `${deviceReferenceCounts.missing.length} missing saved member${deviceReferenceCounts.missing.length === 1 ? '' : 's'}`
          : null,
        group.linked_groups.length > 0
          ? `${group.linked_groups.length} linked room${group.linked_groups.length === 1 ? '' : 's'} · ${availableResolvedDeviceCount} resolved available devices`
          : null,
        usageSentence,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const devicesSummary =
    group && deviceReferenceCounts.saved > 0
      ? [
          `${deviceReferenceCounts.available} available device${deviceReferenceCounts.available === 1 ? '' : 's'}`,
          deviceReferenceCounts.missing.length > 0
            ? `${deviceReferenceCounts.missing.length} missing saved member${
                deviceReferenceCounts.missing.length === 1 ? '' : 's'
              }`
            : null,
          // Examples help while the section is collapsed; once it is open the
          // rows say the same thing in more detail.
          activeSection === 'devices'
            ? null
            : `${examples(deviceNames, deviceReferenceCounts.saved)}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Empty room — no devices yet';

  const linksSummary =
    group && group.linked_groups.length > 0
      ? [
          `${group.linked_groups.length} linked room${group.linked_groups.length === 1 ? '' : 's'}`,
          activeSection === 'links'
            ? null
            : `${examples(
                group.linked_groups.map(
                  (linkedId) =>
                    groups.find((entry) => entry.id === linkedId)?.name ??
                    linkedId,
                ),
                group.linked_groups.length,
              )}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'No linked rooms';

  return (
    <DetailPageShell
      crumbs={[
        { label: 'Settings', to: '/config' },
        { label: 'Rooms', to: '/config/groups' },
        { label: group?.name ?? id },
      ]}
      backTo="/config/groups"
      backLabel="Back to rooms"
      title={group?.name ?? id}
      status={statusSentence}
      loading={loading}
      error={error}
      notFound={!loading && !error && !group}
      onRetry={() => void refetch()}
    >
      {group ? (
        <div className="space-y-4">
          {group.devices.length === 0 ? (
            <p className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              This is an empty room. Add devices to control them together from
              scenes and routines.
            </p>
          ) : null}

          {missing.length > 0 ? (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {lookups.labelFor(missing[0])} is missing from the current
                  catalog. Its saved key remains in this room
                  {missing.length > 1
                    ? `, along with ${missing.length - 1} other missing member${missing.length === 2 ? '' : 's'}`
                    : ''}
                  .
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => openSection('devices', { target: missing[0] })}
                >
                  Review saved members
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <Section<Group>
            id="devices"
            title="Devices"
            summary={devicesSummary}
            open={activeSection === 'devices'}
            onOpenChange={(open) => openSection(open ? 'devices' : null)}
            api={deviceEditor}
            headingRef={(node) => {
              headingRefs.current.devices = node;
            }}
            readView={
              <BoundedList
                items={group.devices}
                keyOf={(device) => groupDeviceKey(device)}
                revealKey={target}
                emptyMessage="No devices in this room yet."
                renderItem={(device) => {
                  const key = groupDeviceKey(device);
                  const isMissing = !lookups.presentKeys.has(key);
                  const liveDevice = lookups.devicesByKey[key];
                  const currentState =
                    liveDevice && 'Controllable' in liveDevice.data
                      ? liveDevice.data.Controllable.state
                      : null;
                  const currentSummary = currentState
                    ? currentState.power
                      ? `On${
                          typeof currentState.brightness === 'number'
                            ? ` · ${Math.round(currentState.brightness * 100)}%`
                            : ''
                        }`
                      : 'Off'
                    : liveDevice && 'Sensor' in liveDevice.data
                      ? `Current sensor value: ${JSON.stringify(getSensorDetails(liveDevice).value)}`
                      : null;
                  const reachability =
                    liveDevice && 'Controllable' in liveDevice.data
                      ? reachabilityLabels[deviceReachability(liveDevice)]
                      : null;
                  return (
                    <div
                      className="flex items-center gap-3"
                      data-target-key={key}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {isMissing ? (
                            <span className="text-muted-foreground">
                              {lookups.labelFor(device)} — this saved device is
                              not in the current catalog
                            </span>
                          ) : (
                            <Link
                              to={`/config/devices/detail?key=${encodeURIComponent(key)}`}
                              className="transition hover:text-primary hover:underline"
                            >
                              {lookups.labelFor(device)}
                            </Link>
                          )}
                        </p>
                        {/* The key is the only thing that identifies a missing
                            member for repair, so it is never truncated. */}
                        {currentSummary ? (
                          <p className="text-xs text-muted-foreground">
                            {currentSummary}
                          </p>
                        ) : null}
                        {reachability ? (
                          <p className="text-xs text-muted-foreground">
                            {reachability}
                          </p>
                        ) : null}
                        <p
                          className={
                            isMissing
                              ? 'text-xs break-all text-muted-foreground'
                              : 'truncate text-xs text-muted-foreground'
                          }
                        >
                          {key}
                        </p>
                      </div>
                      {isMissing ? (
                        <>
                          <Badge variant="warning" className="shrink-0">
                            Missing
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 shrink-0"
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(key)
                                .then(() => toast.success('Key copied'))
                                .catch(() => toast.error('Could not copy'));
                            }}
                          >
                            Copy key
                          </Button>
                        </>
                      ) : null}
                    </div>
                  );
                }}
              />
            }
            renderEditor={() => (
              <div className="space-y-4">
                {/* No inner card: the section already has a heading. */}
                <div className="space-y-3">
                  <SelectedDeviceRows
                    devices={deviceEditor.draft?.devices ?? []}
                    onChange={(next: GroupDeviceRef[]) =>
                      deviceEditor.patch({ devices: next })
                    }
                    labelFor={lookups.labelFor}
                    presentKeys={lookups.presentKeys}
                    replaceTarget={replaceTarget}
                    onStartReplace={(key) =>
                      openSection('devices', { target: `replace:${key}` })
                    }
                    onCancelReplace={() =>
                      openSection('devices', { target: null })
                    }
                  />
                </div>
                <div
                  data-target-key={
                    replaceTarget ? `replace:${replaceTarget}` : undefined
                  }
                >
                  <DeviceAdder
                    options={lookups.options.map((option) => ({
                      ...option,
                      detail: [
                        roomNamesByDevice[option.key]?.join(', '),
                        option.device.integration_id,
                        option.key,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    }))}
                    selectedKeys={
                      new Set(
                        (deviceEditor.draft?.devices ?? []).map(groupDeviceKey),
                      )
                    }
                    onAdd={(device) =>
                      deviceEditor.patch({
                        devices: [
                          ...(deviceEditor.draft?.devices ?? []),
                          {
                            integration_id: device.integration_id,
                            device_id: device.id,
                          },
                        ],
                      })
                    }
                    onReplace={
                      replaceTarget
                        ? (device) =>
                            deviceEditor.patch({
                              devices: (deviceEditor.draft?.devices ?? []).map(
                                (entry) =>
                                  groupDeviceKey(entry) === replaceTarget
                                    ? {
                                        integration_id: device.integration_id,
                                        device_id: device.id,
                                      }
                                    : entry,
                              ),
                            })
                        : undefined
                    }
                    placeholder={
                      replaceTarget
                        ? `Search a replacement for ${replaceTarget}`
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
          />

          <Section<Group>
            id="links"
            title="Linked rooms"
            summary={linksSummary}
            open={activeSection === 'links'}
            onOpenChange={(open) => openSection(open ? 'links' : null)}
            api={linkEditor}
            headingRef={(node) => {
              headingRefs.current.links = node;
            }}
            readView={
              <BoundedList
                items={group.linked_groups}
                keyOf={(linkedId) => linkedId}
                emptyMessage="No linked rooms. Search to add one."
                renderItem={(linkedId) => {
                  const linked = groups.find((entry) => entry.id === linkedId);
                  return (
                    <div
                      className="flex items-center gap-3"
                      data-target-key={linkedId}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {linked ? (
                            <Link
                              to={`/config/groups/${encodeURIComponent(linkedId)}`}
                              className="transition hover:text-primary hover:underline"
                            >
                              {linked.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {linkedId} — no longer exists
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {linkedId}
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
            }
            renderEditor={() => (
              <div className="space-y-4">
                <SelectedRoomRows
                  ids={linkEditor.draft?.linked_groups ?? []}
                  groups={groups}
                  onChange={(next) => linkEditor.patch({ linked_groups: next })}
                />
                <RoomAdder
                  groups={groups}
                  groupId={group.id}
                  selectedIds={linkEditor.draft?.linked_groups ?? []}
                  onAdd={(next) =>
                    linkEditor.patch({
                      linked_groups: [
                        ...(linkEditor.draft?.linked_groups ?? []),
                        next,
                      ],
                    })
                  }
                />
              </div>
            )}
          />

          <Section<Group>
            id="details"
            title="Details"
            summary={`${group.hidden ? 'Hidden' : 'Visible'} · id ${group.id}`}
            open={activeSection === 'details'}
            onOpenChange={(open) => openSection(open ? 'details' : null)}
            api={detailEditor}
            headingRef={(node) => {
              headingRefs.current.details = node;
            }}
            fieldLabels={{ name: 'Name' }}
            readView={
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Name</dt>
                  <dd>{group.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">ID</dt>
                  <dd className="font-mono text-xs">
                    {group.id}
                    {usageUsers.length === 1
                      ? ` · used by ${usageUsers[0].name}`
                      : usageUsers.length > 1
                        ? ` · used by ${usageUsers.length} automations`
                        : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Visibility</dt>
                  <dd>{group.hidden ? 'Hidden' : 'Visible'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Where it appears
                  </dt>
                  <dd>
                    {usage.scenes.length === 0 && usage.routines.length === 0
                      ? 'No scenes or routines target this room yet'
                      : [
                          usage.scenes.length > 0
                            ? `Scenes: ${usage.scenes.map((entry) => entry.name).join(', ')}`
                            : null,
                          usage.routines.length > 0
                            ? `Routines: ${usage.routines.map((entry) => entry.name).join(', ')}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </dd>
                </div>
              </dl>
            }
            renderEditor={() => (
              <div className="space-y-4">
                <ConfigField label="Name">
                  <Input
                    data-field="name"
                    value={String(detailEditor.draft?.name ?? '')}
                    onChange={(event) =>
                      detailEditor.patch({ name: event.target.value })
                    }
                    placeholder="Living room"
                  />
                </ConfigField>
                <p className="text-xs text-muted-foreground">
                  ID: <span className="font-mono">{group.id}</span>
                  {usageUsers.length > 0
                    ? ` · used by ${usageUsers.length} automation${usageUsers.length === 1 ? '' : 's'}`
                    : ''}
                  . It cannot be changed here.
                </p>
                <ConfigToggleRow
                  label="Hidden"
                  description="Hide from main controls; automations still use it."
                >
                  <input
                    type="checkbox"
                    data-field="hidden"
                    className={checkboxClassName}
                    checked={Boolean(detailEditor.draft?.hidden)}
                    onChange={(event) =>
                      detailEditor.patch({ hidden: event.target.checked })
                    }
                  />
                </ConfigToggleRow>
              </div>
            )}
          />

          <Section<Group>
            id="danger"
            title="Delete this room"
            summary="Removes the room; scenes, links, and routines that target it stop resolving."
            open={activeSection === 'danger'}
            onOpenChange={(open) => openSection(open ? 'danger' : null)}
            api={detailEditor}
            editable={false}
            danger
            headingRef={(node) => {
              headingRefs.current.danger = node;
            }}
            readView={
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  if (
                    await confirmDestructive(
                      `Delete room "${group.name}"?`,
                      'Scenes, links, and routines that target this room will stop resolving.',
                    )
                  ) {
                    await remove(group.id);
                    navigate('/config/groups', { replace: true });
                  }
                }}
              >
                Delete room
              </Button>
            }
            renderEditor={() => null}
          />

          <StatusRegion message={status?.message ?? null} tone={status?.tone} />
        </div>
      ) : null}
    </DetailPageShell>
  );
}
