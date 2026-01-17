'use client';

import {
  useDeviceDisplayNames,
  useRoutines,
  useScenes,
  Routine,
} from '@/hooks/useConfig';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import { useState } from 'react';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import { useRoutineStatuses } from '@/hooks/websocket';
import { RuleBuilder, Rule } from '@/ui/RuleBuilder';
import { ActionBuilder, Action } from '@/ui/ActionBuilder';
import { RoutineActionList, RoutineRuleList } from '@/ui/routine-summary';

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
  const [showCreate, setShowCreate] = useState(false);
  const { devicesState: devices } = useDevicesApi();
  const routineStatuses = useRoutineStatuses();
  const groups = useGroupsState();
  const deviceDisplayNameMap = deviceDisplayNames.reduce<Record<string, string>>(
    (names, row) => {
      names[row.device_key] = row.display_name;
      return names;
    },
    {},
  );

  const sceneList = scenes.map((s) => ({ id: s.id, name: s.name }));
  const routineList = routines.map((r) => ({ id: r.id, name: r.name }));

  if (loading || scenesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <span>Error loading routines: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Routines</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Add Routine
        </button>
      </div>

      <div className="grid gap-4">
        {routines.map((routine) => (
          <RoutineCard
            key={routine.id}
            routine={routine}
            isEditing={editingId === routine.id}
            devices={devices}
            groups={groups}
            scenes={sceneList}
            routines={routineList}
            runtimeStatus={routineStatuses?.[routine.id]}
            deviceDisplayNameMap={deviceDisplayNameMap}
            onEdit={() => setEditingId(routine.id)}
            onSave={async (updated) => {
              await update(routine.id, updated);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            onDelete={async () => {
              if (confirm(`Delete routine "${routine.name}"?`)) {
                await remove(routine.id);
              }
            }}
          />
        ))}
      </div>

      {showCreate && (
        <CreateRoutineModal
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

import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';

function RoutineCard({
  routine,
  isEditing,
  devices,
  groups,
  scenes,
  routines,
  runtimeStatus,
  deviceDisplayNameMap,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  routine: Routine;
  isEditing: boolean;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  runtimeStatus?: RoutineRuntimeStatus;
  deviceDisplayNameMap: Record<string, string>;
  onEdit: () => void;
  onSave: (routine: Partial<Routine>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(routine.name);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [rules, setRules] = useState<Rule[]>(routine.rules as Rule[]);
  const [actions, setActions] = useState<Action[]>(routine.actions as Action[]);
  const [editMode, setEditMode] = useState<'visual' | 'json'>('visual');
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
      return { label: 'No live state', className: 'badge-ghost' };
    }

    if (runtimeStatus.will_trigger) {
      return { label: 'Triggering', className: 'badge-success' };
    }

    if (runtimeStatus.all_conditions_match) {
      return { label: 'Conditions met', className: 'badge-warning' };
    }

    return { label: 'Waiting', className: 'badge-ghost' };
  })();
  const matchingRuleCount = runtimeStatus?.rules.filter((status) => status.condition_match).length;

  if (isEditing) {
    return (
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <input
            type="text"
            className="input input-bordered font-bold text-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="flex justify-between items-center">
            <div className="form-control">
              <label className="label cursor-pointer gap-3">
                <span className="label-text">Enabled</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
              </label>
            </div>

            <div className="btn-group">
              <button
                className={`btn btn-sm ${editMode === 'visual' ? 'btn-active' : ''}`}
                onClick={() => {
                  if (editMode === 'json') {
                    try {
                      setRules(JSON.parse(rulesJson));
                      setActions(JSON.parse(actionsJson));
                    } catch {
                      alert('Invalid JSON - fix before switching to visual');
                      return;
                    }
                  }
                  setEditMode('visual');
                }}
              >
                Visual
              </button>
              <button
                className={`btn btn-sm ${editMode === 'json' ? 'btn-active' : ''}`}
                onClick={() => {
                  setRulesJson(JSON.stringify(rules, null, 2));
                  setActionsJson(JSON.stringify(actions, null, 2));
                  setEditMode('json');
                }}
              >
                JSON
              </button>
            </div>
          </div>

          {editMode === 'visual' ? (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-base-300 rounded-lg p-4">
                <RuleBuilder
                  rules={rules}
                  devices={devices}
                  groups={groups}
                  scenes={scenes}
                  onChange={setRules}
                />
              </div>
              <div className="border border-base-300 rounded-lg p-4">
                <ActionBuilder
                  actions={actions}
                  devices={devices}
                  groups={groups}
                  scenes={scenes}
                  routines={routines}
                  onChange={setActions}
                />
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Rules (JSON)</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-48 font-mono text-xs"
                  value={rulesJson}
                  onChange={(e) => setRulesJson(e.target.value)}
                  placeholder='[{"Sensor": {"device_ref": {...}, "state": {...}}}]'
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Actions (JSON)</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-48 font-mono text-xs"
                  value={actionsJson}
                  onChange={(e) => setActionsJson(e.target.value)}
                  placeholder='[{"ActivateScene": {"scene_id": "..."}]'
                />
              </div>
            </div>
          )}

          <div className="card-actions justify-end mt-2">
            <button className="btn btn-sm btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                try {
                  const finalRules =
                    editMode === 'json' ? JSON.parse(rulesJson) : rules;
                  const finalActions =
                    editMode === 'json' ? JSON.parse(actionsJson) : actions;
                  onSave({
                    name,
                    enabled,
                    rules: finalRules,
                    actions: finalActions,
                  });
                } catch {
                  alert('Invalid JSON in rules or actions');
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-200 shadow-xl">
      <div className="card-body">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="card-title">{routine.name}</h2>
            <div className="text-sm opacity-70">{routine.id}</div>
          </div>
          <div className="flex flex-wrap gap-2 items-center justify-end">
            <div className={`badge ${routine.enabled ? 'badge-success' : 'badge-error'}`}>
              {routine.enabled ? 'Enabled' : 'Disabled'}
            </div>
            {routineStatusBadge ? (
              <div className={`badge ${routineStatusBadge.className}`}>
                {routineStatusBadge.label}
              </div>
            ) : null}
          </div>
        </div>

        <div className="text-sm mt-2">
          <span className="font-medium">{routine.rules.length}</span> rules ·{' '}
          <span className="font-medium">{routine.actions.length}</span> actions
          {routine.enabled && matchingRuleCount !== undefined ? (
            <>
              {' '}
              · <span className="font-medium">{matchingRuleCount}</span> matching now
            </>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
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

        <div className="card-actions justify-end mt-2">
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-sm btn-error btn-ghost" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateRoutineModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (routine: Partial<Routine>) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Routine</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Routine ID</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="motion-lights"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Name</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Motion Activated Lights"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label cursor-pointer">
            <span className="label-text">Enabled</span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!id || !name}
            onClick={() => onCreate({ id, name, enabled, rules: [], actions: [] })}
          >
            Create
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
