import { IdentityFields } from '@/ui/settings/IdentityFields';
import { asNewItem, offerUndo } from '@/lib/undo';
import { configItemHref } from '@/lib/configItemHref';
import { EntityPicker } from '@/ui/settings/EntityPicker';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type Group,
  useGroups,
  useScenes,
  useRoutines,
} from '@/hooks/useConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { suggestId } from '@/lib/groupGraph';
import { entityDraftStore } from '@/lib/entityDraft';
import {
  describeGroupUsage,
  inheritedGroupDevices,
  findNestedCycle,
  groupDeviceKey,
} from '@/lib/groupGraph';
import type { FieldError } from '@/lib/configSection';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { UsedByList } from '@/ui/settings/UsedByList';
import {
  DeviceAdder,
  SelectedDeviceRows,
  SelectedRoomRows,
  useDeviceLookups,
} from './shared';

const EMPTY_GROUP: Group = {
  id: '',
  name: '',
  hidden: false,
  devices: [],
  linked_groups: [],
};
function authored(group: Group): Group {
  const { device_keys: _derived, ...value } = group;
  return value;
}
export function GroupEditor({ id }: { id?: string }) {
  const creating = id === undefined;
  const api = useGroups();
  const { data: scenes } = useScenes();
  const { data: routines } = useRoutines();
  const { apiEndpoint } = useAppConfig();
  const lookups = useDeviceLookups();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [replace, setReplace] = useState<string | null>(
    params.get('target')?.startsWith('replace:')
      ? params.get('target')!.slice(8)
      : null,
  );
  const [deleting, setDeleting] = useState(false);
  const saved = api.data.find((row) => row.id === id);
  const copyFrom = creating
    ? api.data.find((row) => row.id === params.get('copyFrom'))
    : undefined;
  const item = useMemo(
    () =>
      creating
        ? copyFrom
          ? {
              ...authored(copyFrom),
              id: suggestId(
                `Copy of ${copyFrom.name}`,
                api.data.map((row) => row.id),
              ),
              name: `Copy of ${copyFrom.name}`,
            }
          : EMPTY_GROUP
        : saved
          ? authored(saved)
          : undefined,
    [creating, saved, copyFrom, api.data],
  );
  const href = creating
    ? `/config/groups/new${copyFrom ? '?copyFrom=' + encodeURIComponent(copyFrom.id) : ''}`
    : `/config/groups/${encodeURIComponent(id!)}`;
  const key = `${apiEndpoint}/groups/${id ?? '$new'}${copyFrom ? '/copy/' + copyFrom.id : ''}`;
  const draft = useEntityDraft({
    key,
    item,
    label: saved?.name ?? 'New room or group',
    href,
    validate(value) {
      const errors: FieldError[] = [];
      if (!value.name.trim())
        errors.push({
          field: 'name',
          message: 'Give this room or group a name.',
        });
      if (!value.id.trim())
        errors.push({ field: 'id', message: 'Choose an ID.' });
      if (creating && api.data.some((row) => row.id === value.id))
        errors.push({ field: 'id', message: 'This ID is already in use.' });
      if (
        value.linked_groups.some((candidate) =>
          findNestedCycle(api.data, value.id, candidate),
        )
      )
        errors.push({
          field: 'links',
          message: 'Linked rooms and groups would create a nesting loop.',
        });
      return errors;
    },
    async save(value, expected) {
      const result = creating
        ? await api.create(value)
        : await api.update(value.id, value, expected);
      if (creating && result) {
        entityDraftStore.forget(key);
        navigate(`/config/groups/${encodeURIComponent(result.id)}`, {
          replace: true,
        });
      }
      return result ? authored(result) : value;
    },
  });
  const group = draft.value;
  const usage = useMemo(
    () => describeGroupUsage({ scenes, routines }, id ?? ''),
    [scenes, routines, id],
  );
  const inherited = group ? inheritedGroupDevices(group, api.data) : [];
  const parents = api.data.filter((row) =>
    row.linked_groups.includes(id ?? ''),
  );
  useAssistantPageContext(
    saved ? { kind: 'group', id: saved.id, label: saved.name } : null,
  );
  const hasGroup = Boolean(group);
  useEffect(() => {
    if (!hasGroup) return;
    const section = params.get('section');
    if (section)
      requestAnimationFrame(() =>
        document.getElementById(section)?.scrollIntoView({ block: 'start' }),
      );
  }, [hasGroup, params]);
  async function deleteGroup() {
    if (!saved || deleting) return;
    const references =
      usage.scenes.length + usage.routines.length + parents.length;
    if (
      !(await confirmDialog({
        title: `Delete ${saved.name}?`,
        description: `${references ? `${references} configurations reference this room or group. Those references will need repair. ` : ''}Devices are kept.${draft.dirty ? ' Unsaved changes to this item will be discarded.' : ''}`,
        confirmLabel: 'Delete room or group',
        destructive: true,
      }))
    )
      return;
    setDeleting(true);
    try {
      const removed = saved;
      await api.remove(removed.id);
      draft.forget();
      navigate('/config/groups');
      offerUndo(
        `Deleted ${removed.name}`,
        () => api.create(asNewItem(removed)),
        `Restored ${removed.name}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not delete this group',
      );
    } finally {
      setDeleting(false);
    }
  }
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/groups"
      backLabel="Rooms & groups"
      title={creating ? 'New room or group' : (saved?.name ?? 'Room or group')}
      status={
        creating
          ? 'Organize devices and other groups together.'
          : `${group?.devices.length ?? 0} direct devices · ${group?.linked_groups.length ?? 0} linked groups`
      }
      loading={api.loading}
      error={api.error}
      onRetry={() => void api.refetch()}
      notFound={!creating && !saved && !draft.dirty}
      menu={
        creating
          ? undefined
          : [
              {
                label: 'Duplicate',
                onSelect: () =>
                  navigate(
                    `/config/groups/new?copyFrom=${encodeURIComponent(id!)}`,
                  ),
              },
              {
                label: 'Delete room or group',
                onSelect: () => void deleteGroup(),
                destructive: true,
                disabled: deleting || draft.saving,
              },
            ]
      }
    >
      {group && (
        <>
          <SettingsSection id="details" title="Details">
            <IdentityFields
              draft={draft}
              creating={creating}
              existingIds={api.data.map((row) => row.id)}
            />
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={!group.hidden}
                onChange={(event) =>
                  draft.patch({ hidden: !event.target.checked })
                }
              />
              Show in room lists
            </label>
          </SettingsSection>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <SettingsSection
              id="devices"
              title={`Devices · ${group.devices.length}`}
              description="A device can belong to several rooms or groups."
              actions={
                <EntityPicker
                  title="Devices"
                  actionLabel="Add devices"
                  options={lookups.options.map((option) => ({
                    id: option.key,
                    name: option.label,
                    detail: option.key,
                  }))}
                  selected={group.devices.map(groupDeviceKey)}
                  onChange={(keys) =>
                    draft.patch({
                      devices: keys.map(
                        (key) =>
                          group.devices.find(
                            (device) => groupDeviceKey(device) === key,
                          ) ?? {
                            integration_id:
                              lookups.devicesByKey[key].integration_id,
                            device_id: lookups.devicesByKey[key].id,
                          },
                      ),
                    })
                  }
                />
              }
            >
              {lookups.error && (
                <div role="alert" className="text-sm">
                  Could not load device details. Saved membership is still
                  shown.
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void lookups.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              <SelectedDeviceRows
                catalogReady={!lookups.loading && !lookups.error}
                devicesByKey={lookups.devicesByKey}
                devices={group.devices}
                onChange={(devices) => draft.patch({ devices })}
                labelFor={lookups.labelFor}
                presentKeys={lookups.presentKeys}
                replaceTarget={replace}
                onStartReplace={setReplace}
                onCancelReplace={() => setReplace(null)}
              />
              {inherited.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {inherited.length} inherited devices
                  </h3>
                  <ul className="divide-y divide-border">
                    {inherited.map((member) => (
                      <li key={member.key} className="py-2 text-sm">
                        <Link
                          className="hover:underline"
                          to={configItemHref('device', member.key)}
                        >
                          {lookups.labelFor(member.key)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          Via{' '}
                          {member.via.map((id, index) => (
                            <span key={id}>
                              {index > 0 && ', '}
                              <Link
                                className="underline underline-offset-2"
                                to={configItemHref('group', id)}
                              >
                                {api.data.find((row) => row.id === id)?.name ??
                                  id}
                              </Link>
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {replace && (
                <p className="text-sm">
                  Choose a replacement for {lookups.labelFor(replace)}.{' '}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplace(null)}
                  >
                    Cancel
                  </Button>
                </p>
              )}
              {replace && (
                <DeviceAdder
                  options={lookups.options}
                  selectedKeys={new Set(group.devices.map(groupDeviceKey))}
                  onAdd={(device) => {
                    const ref = {
                      integration_id: device.integration_id,
                      device_id: device.id,
                    };
                    draft.patch({
                      devices: replace
                        ? group.devices.map((entry) =>
                            groupDeviceKey(entry) === replace ? ref : entry,
                          )
                        : [...group.devices, ref],
                    });
                    setReplace(null);
                  }}
                />
              )}
            </SettingsSection>
            <SettingsSection
              id="links"
              title={`Linked rooms & groups · ${group.linked_groups.length}`}
              description="Include their devices automatically, including nested groups."
              actions={
                <EntityPicker
                  title="Rooms & groups"
                  actionLabel="Add groups"
                  selected={group.linked_groups}
                  options={api.data
                    .filter((row) => row.id !== group.id)
                    .map((row) => ({
                      id: row.id,
                      name: row.name,
                      disabledReason: findNestedCycle(
                        api.data,
                        group.id,
                        row.id,
                      )
                        ? 'Would create a nesting loop'
                        : undefined,
                    }))}
                  onChange={(linked_groups) => draft.patch({ linked_groups })}
                />
              }
            >
              <SelectedRoomRows
                ids={group.linked_groups}
                groups={api.data}
                onChange={(linked_groups) => draft.patch({ linked_groups })}
              />
            </SettingsSection>
          </div>
          {!creating && (
            <SettingsSection
              id="usage"
              title="Used by"
              description="Open related configuration. Your unsaved changes stay here."
            >
              <UsedByList
                items={[
                  ...parents.map((row) => ({ ...row, kind: 'group' })),
                  ...usage.scenes.map((row) => ({ ...row, kind: 'scene' })),
                  ...usage.routines.map((row) => ({ ...row, kind: 'routine' })),
                ]}
                empty="No related configuration yet."
              />
            </SettingsSection>
          )}
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create room or group' : undefined}
          />
        </>
      )}
    </DetailPageShell>
  );
}
