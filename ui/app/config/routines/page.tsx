import {
  useDeviceDisplayNames,
  useRoutines,
  useScenes,
  Routine,
} from '@/hooks/useConfig';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import { matchesConfigSearch } from '@/lib/configSearch';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useMemo, useState } from 'react';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import { useDevicesState, useRoutineStatuses } from '@/hooks/websocket';
import { ConfigPageHeader } from '../page-header';
import { RuleBuilder, Rule } from '@/ui/RuleBuilder';
import { ActionBuilder, Action, validateActions } from '@/ui/ActionBuilder';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigToggleRow,
} from '@/ui/config-form';
import { RoutineActionList, RoutineRuleList } from '@/ui/routine-summary';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';

const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const statusBadgeClassName = {
  success:
    'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error:
    'border-transparent bg-destructive/15 text-destructive dark:text-red-300',
  warning:
    'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

const getRoutineSearchValues = (routine: Routine) => [
  routine.id,
  routine.name,
  routine.enabled ? 'enabled' : 'disabled',
  routine.rules,
  routine.actions,
];

export default function RoutinesPage() {
  const {
    data: routines,
    loading,
    error,
    create,
    update,
    remove,
  } = useRoutines();
  const { data: scenes, loading: scenesLoading } = useScenes();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { devicesState: apiDevices } = useDevicesApi();
  const liveDevices = useDevicesState();
  // Merge live websocket device state over the REST snapshot so editors (for
  // example the raw JSON rule preview) see up-to-date `device.raw` payloads as
  // integrations push updates.
  const devices = useMemo<DevicesState>(() => {
    const merged: DevicesState = { ...apiDevices };
    for (const [key, device] of Object.entries(liveDevices ?? {})) {
      if (device) {
        merged[key] = device;
      }
    }
    return merged;
  }, [apiDevices, liveDevices]);
  const routineStatuses = useRoutineStatuses();
  const groups = useGroupsState();
  const deviceDisplayNameMap = deviceDisplayNames.reduce<
    Record<string, string>
  >((names, row) => {
    names[row.device_key] = row.display_name;
    return names;
  }, {});

  const sceneList = scenes.map((s) => ({ id: s.id, name: s.name }));
  const routineList = routines.map((r) => ({ id: r.id, name: r.name }));
  const visibleRoutines = routines.filter((routine) =>
    matchesConfigSearch(search, ...getRoutineSearchValues(routine)),
  );

  if (loading || scenesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading routines: {error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Routines"
        actions={
          <Button onClick={() => setShowCreate(true)}>Add Routine</Button>
        }
      />

      <ConfigListSearchBar
        filteredCount={visibleRoutines.length}
        onChange={setSearch}
        placeholder="Search by name, id, rules, or actions"
        totalCount={routines.length}
        value={search}
      />

      {visibleRoutines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No routines match the current search.
        </div>
      ) : (
        <div className="grid gap-4">
          {visibleRoutines.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              isEditing={editingId === routine.id}
              isOpen={openId === routine.id}
              devices={devices}
              groups={groups}
              scenes={sceneList}
              routines={routineList}
              runtimeStatus={routineStatuses?.[routine.id]}
              deviceDisplayNameMap={deviceDisplayNameMap}
              onOpen={() => setOpenId(routine.id)}
              onClose={() => {
                setOpenId((current) =>
                  current === routine.id ? null : current,
                );
                setEditingId((current) =>
                  current === routine.id ? null : current,
                );
              }}
              onEdit={() => setEditingId(routine.id)}
              onSave={async (updated) => {
                await update(routine.id, updated);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
              onDelete={async () => {
                if (confirm(`Delete routine "${routine.name}"?`)) {
                  await remove(routine.id);
                  setOpenId((current) =>
                    current === routine.id ? null : current,
                  );
                }
              }}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateRoutineModal
          devices={devices}
          groups={groups}
          scenes={sceneList}
          routines={routines}
          onClose={() => setShowCreate(false)}
          onCreate={async (routine) => {
            await create(routine);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function RoutineCard({
  routine,
  isEditing,
  isOpen,
  devices,
  groups,
  scenes,
  routines,
  runtimeStatus,
  deviceDisplayNameMap,
  onOpen,
  onClose,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  routine: Routine;
  isEditing: boolean;
  isOpen: boolean;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  runtimeStatus?: RoutineRuntimeStatus;
  deviceDisplayNameMap: Record<string, string>;
  onOpen: () => void;
  onClose: () => void;
  onEdit: () => void;
  onSave: (routine: Partial<Routine>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [id, setId] = useState(routine.id);
  const [name, setName] = useState(routine.name);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [rules, setRules] = useState<Rule[]>(routine.rules as Rule[]);
  const [actions, setActions] = useState<Action[]>(routine.actions as Action[]);
  const [editTab, setEditTab] = useState<
    'basics' | 'rules' | 'actions' | 'json'
  >('basics');
  const [rulesJson, setRulesJson] = useState(
    JSON.stringify(routine.rules, null, 2),
  );
  const [actionsJson, setActionsJson] = useState(
    JSON.stringify(routine.actions, null, 2),
  );

  const routineStatusBadge = (() => {
    if (!routine.enabled) {
      return null;
    }

    if (!runtimeStatus) {
      return { label: 'No live state', className: statusBadgeClassName.muted };
    }

    if (runtimeStatus.will_trigger) {
      return { label: 'Triggering', className: statusBadgeClassName.success };
    }

    if (runtimeStatus.all_conditions_match) {
      return {
        label: 'Conditions met',
        className: statusBadgeClassName.warning,
      };
    }

    return { label: 'Waiting', className: statusBadgeClassName.muted };
  })();
  const matchingRuleCount = runtimeStatus?.rules.filter(
    (status) => status.condition_match,
  ).length;

  const changeTab = (value: string) => {
    if (value === 'json') {
      setRulesJson(JSON.stringify(rules, null, 2));
      setActionsJson(JSON.stringify(actions, null, 2));
      setEditTab('json');
      return;
    }

    if (editTab === 'json') {
      try {
        setRules(JSON.parse(rulesJson));
        setActions(JSON.parse(actionsJson));
      } catch {
        alert('Invalid JSON - fix before leaving the JSON tab');
        return;
      }
    }

    if (value === 'basics' || value === 'rules' || value === 'actions') {
      setEditTab(value);
    }
  };

  const summary = (
    <div className="space-y-3 pr-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight">
            {routine.name}
          </h2>
          <div className="text-sm text-muted-foreground">{routine.id}</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          <Badge
            className={
              routine.enabled
                ? statusBadgeClassName.success
                : statusBadgeClassName.error
            }
          >
            {routine.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          {routineStatusBadge ? (
            <Badge className={routineStatusBadge.className}>
              {routineStatusBadge.label}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="text-sm">
        <span className="font-medium">{routine.rules.length}</span> rules ·{' '}
        <span className="font-medium">{routine.actions.length}</span> actions
        {routine.enabled && matchingRuleCount !== undefined ? (
          <>
            {' '}
            · <span className="font-medium">{matchingRuleCount}</span> matching
            now
          </>
        ) : null}
      </div>
    </div>
  );

  const editContent = (
    <div className="flex min-h-full flex-col">
      <Tabs value={editTab} onValueChange={changeTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="basics">Basics</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="basics" className="mt-4">
          <ConfigFormSection
            title="Routine identity"
            description="The id is used by routine actions and logs; keep it stable after creation."
          >
            <ConfigField label="Routine ID" className="w-full max-w-md">
              <Input
                type="text"
                className="font-mono"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </ConfigField>

            <ConfigField label="Name">
              <Input
                type="text"
                className="w-full text-lg font-bold"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </ConfigField>

            <ConfigToggleRow
              label="Enabled"
              description="Disabled routines remain saved but do not evaluate or trigger."
            >
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </ConfigToggleRow>
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <ConfigFormSection aria-label="Routine rules">
            <RuleBuilder
              rules={rules}
              devices={devices}
              groups={groups}
              scenes={scenes}
              onChange={setRules}
            />
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="actions" className="mt-4">
          <ConfigFormSection aria-label="Routine actions">
            <ActionBuilder
              actions={actions}
              devices={devices}
              groups={groups}
              scenes={scenes}
              routines={routines}
              onChange={setActions}
            />
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="json" className="mt-4">
          <ConfigFormSection
            title="Advanced JSON"
            description="Edit the raw routine payload when a visual editor does not expose an edge case."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <ConfigField label="Rules (JSON)">
                <Textarea
                  className="h-64 font-mono text-xs"
                  value={rulesJson}
                  onChange={(e) => setRulesJson(e.target.value)}
                  placeholder='[{"Sensor": {"device_ref": {...}, "state": {...}}}]'
                />
              </ConfigField>

              <ConfigField label="Actions (JSON)">
                <Textarea
                  className="h-64 font-mono text-xs"
                  value={actionsJson}
                  onChange={(e) => setActionsJson(e.target.value)}
                  placeholder='[{"ActivateScene": {"scene_id": "..."}]'
                />
              </ConfigField>
            </div>
          </ConfigFormSection>
        </TabsContent>
      </Tabs>

      <ConfigFormActions>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!id.trim() || !name.trim()}
          onClick={async () => {
            let finalRules: Rule[] | unknown[];
            let finalActions: Action[] | unknown[];
            const saveFromJson = editTab === 'json';

            try {
              finalRules = saveFromJson ? JSON.parse(rulesJson) : rules;
              finalActions = saveFromJson ? JSON.parse(actionsJson) : actions;
            } catch {
              alert('Invalid JSON in rules or actions');
              return;
            }

            if (Array.isArray(finalActions)) {
              const rolloutValidationError = validateActions(
                finalActions as Action[],
              );
              if (rolloutValidationError) {
                alert(rolloutValidationError);
                return;
              }
            }

            try {
              await onSave({
                id,
                name,
                enabled,
                rules: finalRules,
                actions: finalActions,
              });
            } catch (error) {
              alert(
                error instanceof Error
                  ? error.message
                  : 'Failed to save routine',
              );
            }
          }}
        >
          Save
        </Button>
      </ConfigFormActions>
    </div>
  );

  const viewContent = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {!routine.enabled
          ? 'Disabled: this routine does not evaluate or trigger.'
          : !runtimeStatus
            ? 'Waiting for runtime status.'
            : runtimeStatus.rules.some((rule) => rule.error)
              ? 'A rule could not be evaluated. See its error below.'
              : runtimeStatus.will_trigger
                ? 'The conditions and triggering event matched. This status does not confirm physical device delivery.'
                : runtimeStatus.all_conditions_match
                  ? 'The conditions match; waiting for a matching trigger event.'
                  : `${matchingRuleCount ?? 0} of ${runtimeStatus.rules.length} conditions match. Unmatched rules are shown below.`}
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <RoutineRuleList
          rules={routine.rules as Rule[]}
          status={runtimeStatus}
          devices={devices}
          groups={groups}
          scenes={scenes}
          deviceDisplayNameMap={deviceDisplayNameMap}
        />
        <RoutineActionList
          actions={routine.actions as Action[]}
          devices={devices}
          groups={groups}
          scenes={scenes}
          routines={routines}
          deviceDisplayNameMap={deviceDisplayNameMap}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );

  return (
    <ExpandableConfigCard
      open={isOpen}
      onOpen={onOpen}
      onClose={onClose}
      summary={summary}
      dialogTitle={routine.name}
      dialogSubtitle={routine.id}
    >
      {isEditing ? editContent : viewContent}
    </ExpandableConfigCard>
  );
}

function CreateRoutineModal({
  onClose,
  onCreate,
  devices,
  groups,
  scenes,
  routines,
}: {
  onClose: () => void;
  onCreate: (routine: Partial<Routine>) => Promise<void>;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: Routine[];
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add Routine"
      description="Create a new automation routine."
      className="max-w-4xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <ConfigFormSection
          title="Routine identity"
          description="Choose a starting point, edit its rules and actions, then review before saving."
        >
          <ConfigField label="Start from">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="blank"
              onChange={(event) => {
                setPreview(false);
                const value = event.target.value;
                if (value === 'blank') {
                  setRules([]);
                  setActions([]);
                  return;
                }
                if (value === 'sensor') {
                  setRules([{ state: { value: true }, trigger_mode: 'pulse' }]);
                  setActions([{ action: 'ActivateScene', scene_id: '' }]);
                  return;
                }
                const source = routines.find(
                  (routine) => routine.id === value.slice(5),
                );
                if (source) {
                  setRules(structuredClone(source.rules) as Rule[]);
                  setActions(structuredClone(source.actions) as Action[]);
                }
              }}
            >
              <option value="blank">Blank routine</option>
              <option value="sensor">Sensor activates a scene</option>
              <optgroup label="Reuse an existing routine">
                {routines.map((routine) => (
                  <option key={routine.id} value={`copy:${routine.id}`}>
                    {routine.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </ConfigField>
          <ConfigField label="Routine ID">
            <Input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="motion-lights"
            />
          </ConfigField>

          <ConfigField label="Name">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Motion Activated Lights"
            />
          </ConfigField>

          <ConfigToggleRow label="Enabled">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </ConfigToggleRow>
        </ConfigFormSection>

        <div className="mt-4 space-y-4">
          {preview ? (
            <>
              <RoutineRuleList
                rules={rules}
                devices={devices}
                groups={groups}
                scenes={scenes}
                deviceDisplayNameMap={{}}
              />
              <RoutineActionList
                actions={actions}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                deviceDisplayNameMap={{}}
              />
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'This routine will be enabled when saved.'
                  : 'This routine will be saved disabled.'}
              </p>
            </>
          ) : (
            <>
              <RuleBuilder
                rules={rules}
                devices={devices}
                groups={groups}
                scenes={scenes}
                onChange={setRules}
              />
              <ActionBuilder
                actions={actions}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                onChange={setActions}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => setPreview(!preview)}>
            {preview ? 'Edit draft' : 'Preview'}
          </Button>
          <Button
            disabled={!id.trim() || !name.trim() || saving || !preview}
            onClick={async () => {
              const validation = validateActions(actions);
              if (validation) {
                setError(validation);
                return;
              }
              if (
                actions.some(
                  (action) =>
                    action.action === 'ActivateScene' &&
                    !action.scene_id.trim(),
                )
              ) {
                setError('Choose a scene for each scene activation.');
                return;
              }
              if (
                rules.some(
                  (rule) =>
                    'state' in rule &&
                    (!rule.integration_id || !rule.device_id),
                )
              ) {
                setError('Choose a device for each sensor rule.');
                return;
              }
              setSaving(true);
              setError(null);
              try {
                await onCreate({
                  id: id.trim(),
                  name: name.trim(),
                  enabled,
                  rules,
                  actions,
                });
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : 'Failed to create routine',
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            Create
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
