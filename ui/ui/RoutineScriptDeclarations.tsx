import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { ScriptDeclaration } from '@/bindings/ScriptDeclaration';
import { entityDraftStore, remapArrayEditorPath } from '@/lib/entityDraft';
import { ConfigField } from '@/ui/config-form';
import {
  DeviceSelect,
  GroupSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { UnknownFlowValue, useRoutineAuthoring } from '@/ui/settings/FlowBlock';

const kinds = [
  { value: 'device', label: 'Device' },
  { value: 'group', label: 'Room or group' },
  { value: 'timer', label: 'Named timer' },
  { value: 'all_state', label: 'All device state' },
];
function defaultDeclaration(
  kind: ScriptDeclaration['kind'],
): ScriptDeclaration {
  switch (kind) {
    case 'device':
      return { kind, device: { integration_id: '', device_id: '' } };
    case 'group':
      return { kind, group_id: '' };
    case 'timer':
      return { kind, timer: '' };
    case 'all_state':
      return { kind };
  }
}
function editable(value: ScriptDeclaration) {
  if (!value || typeof value !== 'object') return false;
  switch (value.kind) {
    case 'device':
      return (
        typeof value.device?.integration_id === 'string' &&
        typeof value.device?.device_id === 'string'
      );
    case 'group':
      return typeof value.group_id === 'string';
    case 'timer':
      return typeof value.timer === 'string';
    case 'all_state':
      return true;
    default:
      return false;
  }
}

function DeclarationFields({
  value,
  devices,
  groups,
  onChange,
}: {
  value: ScriptDeclaration;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  onChange: (value: ScriptDeclaration) => void;
}) {
  const [manual, setManual] = useState(false);
  const key =
    value.kind === 'device'
      ? `${value.device.integration_id}/${value.device.device_id}`
      : '';
  const missing =
    value.kind === 'device'
      ? Boolean(value.device.device_id && !devices[key])
      : value.kind === 'group' &&
        Boolean(value.group_id && !groups[value.group_id]);
  const useIds = manual || missing;
  return (
    <div className="min-w-0 space-y-2">
      {value.kind === 'device' && (
        <>
          <ConfigField label="Device">
            <DeviceSelect
              devices={devices}
              value={value.device.device_id ? key : ''}
              onChange={(key) =>
                onChange({
                  ...value,
                  device: {
                    ...value.device,
                    ...(splitDeviceKey(key) ?? {
                      integration_id: '',
                      device_id: '',
                    }),
                  },
                })
              }
            />
          </ConfigField>
          {useIds && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigField label="Integration ID">
                <Input
                  aria-label="Declaration integration ID"
                  value={value.device.integration_id}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      device: {
                        ...value.device,
                        integration_id: event.target.value,
                      },
                    })
                  }
                />
              </ConfigField>
              <ConfigField label="Device ID">
                <Input
                  aria-label="Declaration device ID"
                  value={value.device.device_id}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      device: {
                        ...value.device,
                        device_id: event.target.value,
                      },
                    })
                  }
                />
              </ConfigField>
            </div>
          )}
        </>
      )}
      {value.kind === 'group' && (
        <>
          <ConfigField label="Room or group">
            <GroupSelect
              groups={groups}
              value={value.group_id}
              onChange={(group_id) => onChange({ ...value, group_id })}
            />
          </ConfigField>
          {useIds && (
            <ConfigField label="Group ID">
              <Input
                aria-label="Declaration group ID"
                value={value.group_id}
                onChange={(event) =>
                  onChange({ ...value, group_id: event.target.value })
                }
              />
            </ConfigField>
          )}
        </>
      )}
      {(value.kind === 'device' || value.kind === 'group') && (
        <>
          {!missing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setManual(!manual)}
            >
              {manual ? 'Hide IDs' : 'Enter an ID'}
            </Button>
          )}
          {useIds && (
            <p className="text-xs text-muted-foreground">
              You can declare an entity before it is discovered. Its state is
              absent until it becomes available.
            </p>
          )}
        </>
      )}
      {value.kind === 'timer' && (
        <ConfigField label="Timer name">
          <Input
            aria-label="Declaration timer name"
            value={value.timer}
            placeholder="lights_off"
            onChange={(event) =>
              onChange({ ...value, timer: event.target.value })
            }
          />
        </ConfigField>
      )}
      {value.kind === 'all_state' && (
        <p className="text-xs text-muted-foreground">
          The script may read every device in the triggering snapshot. Device
          and room declarations provide a narrower scope.
        </p>
      )}
    </div>
  );
}

export function RoutineScriptDeclarations({
  declarations,
  onChange,
  devices,
  groups,
  path,
  purpose = 'routine',
}: {
  declarations: ScriptDeclaration[];
  onChange: (declarations: ScriptDeclaration[]) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  path: string;
  purpose?: 'routine' | 'helper';
}) {
  const { draftKey } = useRoutineAuthoring();
  const [newKind, setNewKind] = useState<ScriptDeclaration['kind']>('device');
  const update = (index: number, next: ScriptDeclaration) =>
    onChange(declarations.map((value, i) => (i === index ? next : value)));
  return (
    <div className="space-y-3">
      <div>
        <h5 className="text-sm font-medium">Declarations</h5>
        <p className="text-xs text-muted-foreground">
          {purpose === 'helper'
            ? 'Choose device and room inputs. Changes to these inputs refresh the calculation. Up to 32 declarations.'
            : 'Choose additional state the script can read. Triggers and conditions decide when it runs. Up to 32 declarations.'}
        </p>
      </div>
      {!declarations.length && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {purpose === 'helper'
            ? 'No device dependencies. The calculation uses its clock and selected helper dependencies.'
            : 'No declarations. The script sees its triggering frame and its own memory.'}
        </p>
      )}
      {declarations.map((value, index) => (
        <div
          key={index}
          data-declaration-index={index}
          className="min-w-0 space-y-3 rounded-md border border-border p-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              {editable(value) ? (
                <SettingsSelect
                  aria-label="Declaration type"
                  value={value.kind}
                  options={kinds}
                  onValueChange={(next) =>
                    update(
                      index,
                      draftKey
                        ? entityDraftStore.switchVariant(
                            draftKey,
                            path + '/' + index,
                            value.kind,
                            value,
                            next,
                            defaultDeclaration(
                              next as ScriptDeclaration['kind'],
                            ),
                          )
                        : defaultDeclaration(next as ScriptDeclaration['kind']),
                    )
                  }
                />
              ) : (
                <span className="text-sm">Unrecognized declaration</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove declaration"
              onClick={() => {
                const order = declarations
                  .map((_, i) => i)
                  .filter((i) => i !== index);
                if (draftKey)
                  entityDraftStore.remapEditorPaths(draftKey, (slot) =>
                    remapArrayEditorPath(slot, path, order),
                  );
                onChange(order.map((i) => declarations[i]));
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {editable(value) ? (
            <DeclarationFields
              key={value.kind}
              value={value}
              devices={devices}
              groups={groups}
              onChange={(next) => update(index, next)}
            />
          ) : (
            <UnknownFlowValue value={value} />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSelect
          className="min-w-0 flex-1"
          aria-label="New declaration type"
          value={newKind}
          options={kinds}
          onValueChange={(next) =>
            setNewKind(next as ScriptDeclaration['kind'])
          }
        />
        <Button
          variant="outline"
          disabled={declarations.length >= 32}
          onClick={() =>
            onChange([...declarations, defaultDeclaration(newKind)])
          }
        >
          Add declaration
        </Button>
      </div>
    </div>
  );
}
