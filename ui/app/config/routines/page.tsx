import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { matchesConfigSearch } from '@/lib/configSearch';
import {
  useDeviceDisplayNames,
  useHelpers,
  useRoutines,
  useScenes,
  type Routine,
} from '@/hooks/useConfig';
import { useCreateDeepLink, useSearchParamState } from '@/hooks/useDeepLink';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import { useDevicesState, useRoutineStatuses } from '@/hooks/websocket';
import { ConfigTabs } from '@/ui/ConfigTabs';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ConfigPageHeader } from '../page-header';
import { Button } from '@/ui/primitives/button';
import { Button as UiButton } from '@/ui/primitives/button';
import { Badge } from '@/ui/primitives/badge';
import { Checkbox } from '@/ui/primitives/checkbox';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Switch } from '@/ui/primitives/switch';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { StatusBadge, formatUnknownReason } from '@/ui/routine-runtime';
import {
  describeRoutineLastOutcome,
  describeRoutineStateLine,
  describeRoutineTriggerLine,
  describeUnknownReasonSentence,
} from '@/lib/routineNarrative';

const stateToneClass: Record<string, string> = {
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  error: 'text-destructive',
  info: 'text-muted-foreground',
  neutral: 'text-muted-foreground',
};
import { describeNativeAction } from '@/ui/v2-routine-summary';
import type { NativeAction } from '@/bindings/NativeAction';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { Program } from '@/bindings/Program';
import type { TriggerSpec } from '@/bindings/TriggerSpec';

export default function RoutinesPage() {
  const {
    data: routines,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
  } = useRoutines();
  const { data: scenes, loading: scenesLoading } = useScenes();
  const { data: helpers } = useHelpers();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const { devicesState: apiDevices } = useDevicesApi();
  const liveDevices = useDevicesState();
  const routineStatuses = useRoutineStatuses();
  const groups = useGroupsState();
  const [search, setSearch] = useSearchParamState();
  const [showManage, setShowManage] = useState(false);
  const navigate = useNavigate();
  useCreateDeepLink(
    useCallback(() => navigate('/config/routines/new'), [navigate]),
  );

  const devices = useMemo(() => {
    const merged = { ...apiDevices };
    for (const [key, device] of Object.entries(liveDevices ?? {})) {
      if (device) {
        merged[key] = device;
      }
    }
    return merged;
  }, [apiDevices, liveDevices]);
  const deviceDisplayNameMap = useMemo(
    () =>
      deviceDisplayNames.reduce<Record<string, string>>((names, row) => {
        names[row.device_key] = row.display_name;
        return names;
      }, {}),
    [deviceDisplayNames],
  );
  const sceneList = scenes.map((scene) => ({ id: scene.id, name: scene.name }));
  const routineList = routines.map((routine) => ({
    id: routine.id,
    name: routine.name,
  }));
  const visibleRoutines = routines.filter((routine) =>
    matchesConfigSearch(
      search,
      routine.id,
      routine.name,
      routine.enabled ? 'enabled' : 'disabled',
      routine.rules,
      routine.actions,
    ),
  );

  if (loading || scenesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>Could not load routines: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const narrativeContext = {
    devices,
    groups,
    deviceNames: deviceDisplayNameMap,
  };

  /**
   * The card's two content lines: what starts it, and what it does in the
   * words a person would use. Raw cron expressions and node kinds live on the
   * detail page, not here.
   */
  const describeRoutine = (routine: Routine): string => {
    const isV2 =
      routine.semantics_version === 2 || Boolean(routine.definition_v2);
    if (!isV2) {
      return `${routine.rules.length} rule${routine.rules.length === 1 ? '' : 's'} → ${routine.actions.length} action${routine.actions.length === 1 ? '' : 's'}`;
    }
    const triggers: TriggerSpec[] = routine.definition_v2?.triggers ?? [];
    const when = describeRoutineTriggerLine(
      routine.definition_v2,
      narrativeContext,
    );
    const program = routine.definition_v2?.program as Program | undefined;
    const then =
      program?.kind === 'script'
        ? 'run a script'
        : program?.kind === 'native' && program.steps.length > 0
          ? describeNativeAction(
              program.steps[0] as NativeAction,
              devices,
              groups,
              sceneList,
              routineList,
              deviceDisplayNameMap,
            ) +
            (program.steps.length > 1
              ? ` +${program.steps.length - 1} more`
              : '')
          : 'do nothing yet';
    if (!when) {
      return `Does not start on its own → ${then}`;
    }
    return `${when} → ${then}`;
  };

  const stateLineFor = (
    routine: Routine,
    status: RoutineRuntimeStatus | undefined,
  ) =>
    describeRoutineStateLine({
      enabled: routine.enabled,
      definition: routine.definition_v2,
      status:
        routine.semantics_version === 2 || routine.definition_v2
          ? status?.v2
          : status,
      context: narrativeContext,
      describeUnknown: (reason) =>
        describeUnknownReasonSentence(reason, narrativeContext),
    });

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Routines"
        description="Automate what happens when a sensor, schedule, or other trigger changes. Open a routine to see and change its parts."
        actions={
          <>
            <UiButton variant="outline" onClick={() => setShowManage(true)}>
              Manage
            </UiButton>
            <Button asChild>
              <Link to="/config/routines/new">Add Routine</Link>
            </Button>
          </>
        }
      />

      <ConfigTabs
        tabs={[
          { label: 'Routines', to: '/config/routines', active: true },
          { label: 'Activity', to: '/config/routine-history' },
        ]}
      />

      <ConfigListSearchBar
        filteredCount={visibleRoutines.length}
        onChange={setSearch}
        placeholder="Search routines"
        totalCount={routines.length}
        value={search}
      />

      {visibleRoutines.length === 0 ? (
        <EmptyState
          title={
            routines.length === 0 ? 'No routines yet' : 'No matching routines'
          }
          description={
            routines.length === 0
              ? 'Routines react to device reports, helpers, and schedules. Start from a template or a blank trigger.'
              : 'Try a different search term or clear the search to see all routines.'
          }
          action={
            routines.length === 0 ? (
              <Button asChild>
                <Link to="/config/routines/new">Add your first routine</Link>
              </Button>
            ) : (
              <UiButton variant="outline" onClick={() => setSearch('')}>
                Clear search
              </UiButton>
            )
          }
        />
      ) : (
        <ul className="grid gap-3">
          {visibleRoutines.map((routine) => {
            const status = routineStatuses?.[routine.id];
            const isV2 =
              routine.semantics_version === 2 || Boolean(routine.definition_v2);
            return (
              <li
                key={routine.id}
                className="rounded-2xl border border-border bg-background/70 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                      to={`/config/routines/${encodeURIComponent(routine.id)}`}
                    >
                      {routine.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {describeRoutine(routine)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Switch
                      checked={routine.enabled}
                      onCheckedChange={(checked) =>
                        void update(routine.id, { enabled: checked })
                      }
                      aria-label={`${routine.enabled ? 'Disable' : 'Enable'} ${routine.name}`}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {routine.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {isV2 ? null : (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 text-amber-600 dark:text-amber-400"
                    >
                      Legacy routine
                    </Badge>
                  )}
                </div>
                {routine.enabled ? (
                  <div className="mt-2 space-y-0.5">
                    {(() => {
                      const state = stateLineFor(routine, status);
                      return (
                        <p
                          className={`text-xs ${stateToneClass[state.tone] ?? ''}`}
                        >
                          {state.text}
                        </p>
                      );
                    })()}
                    {describeRoutineLastOutcome(status?.v2?.last_run) ? (
                      <p className="text-xs text-muted-foreground">
                        {describeRoutineLastOutcome(status?.v2?.last_run)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {showManage && (
        <ManageRoutinesDialog
          routines={routines}
          onClose={() => setShowManage(false)}
          onSetEnabled={async (ids, enabled) => {
            for (const routineId of ids) {
              await update(routineId, { enabled });
            }
          }}
          onDelete={async (ids) => {
            const names = ids
              .map(
                (routineId) =>
                  routines.find((candidate) => candidate.id === routineId)
                    ?.name,
              )
              .filter(Boolean)
              .slice(0, 3)
              .join(', ');
            if (
              !(await confirmDestructive(
                ids.length === 1
                  ? 'Delete 1 routine?'
                  : `Delete ${ids.length} routines?`,
                `Their triggers, conditions, and programs are removed. This affects ${names}${ids.length > 3 ? ', …' : ''}.`,
              ))
            ) {
              return;
            }
            for (const routineId of ids) {
              await remove(routineId);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Bulk actions live in their own dialog instead of per-card checkboxes: pick
 * routines by name and apply one change to all of them. That is the "different
 * interaction" the redesign asked for, and it keeps the list a set of links.
 */
function ManageRoutinesDialog({
  routines,
  onClose,
  onSetEnabled,
  onDelete,
}: {
  routines: Routine[];
  onClose: () => void;
  onSetEnabled: (ids: string[], enabled: boolean) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const visible = routines.filter((routine) =>
    matchesConfigSearch(query, routine.id, routine.name),
  );
  const toggle = (routineId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(routineId)) {
        next.delete(routineId);
      } else {
        next.add(routineId);
      }
      return next;
    });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Manage routines"
      description="Pick routines and apply one change to all of them."
    >
      <div className="space-y-3">
        <Input
          aria-label="Filter routines"
          placeholder="Filter routines"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="max-h-72 space-y-1 overflow-auto">
          {visible.map((routine) => (
            <li key={routine.id}>
              <label className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                <Checkbox
                  checked={selected.has(routine.id)}
                  onCheckedChange={() => toggle(routine.id)}
                  aria-label={`Select ${routine.name}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {routine.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {routine.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void run(() => onSetEnabled([...selected], true))}
          >
            Enable
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void run(() => onSetEnabled([...selected], false))}
          >
            Disable
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || selected.size === 0}
            onClick={() => void run(() => onDelete([...selected]))}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}
