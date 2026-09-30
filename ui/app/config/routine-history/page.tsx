import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, Pause, Play, RefreshCw } from 'lucide-react';
import {
  type RoutineHistoryEntry,
  type RoutineHistoryTriggerKind,
  useRoutineHistory,
} from '@/hooks/useConfig';
import type { ConditionTraceNode } from '@/bindings/ConditionTraceNode';
import type { PlannedRunStatus } from '@/bindings/PlannedRunStatus';
import type { RuleRuntimeStatus } from '@/bindings/RuleRuntimeStatus';
import type { TruthValue } from '@/bindings/TruthValue';
import {
  describeUnknownReason,
  explainEntry,
  outcome,
  summary,
  recordedRun,
} from '@/lib/routineActivity';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { configItemHref } from '@/lib/configItemHref';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { ConfigPageHeader } from '../page-header';
import {
  ActivityReferenceProvider,
  ActivityReferenceStatus,
  ActivityEntityName,
  ActivityDefinitionNotice,
} from './references';

const triggerLabels: Record<RoutineHistoryTriggerKind, string> = {
  rule_match: 'Legacy rule match',
  force_trigger: 'Manual run',
  v2_run: 'Run',
  v2_blocked: 'Blocked attempt',
};

function truthLabel(truth: TruthValue) {
  return truth === 'true' ? 'true' : truth === 'false' ? 'false' : 'unknown';
}

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function formatShortTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    timeStyle: 'short',
  });
}

/** What happened, in the words of the event rather than the schema. */
function statusBadgeVariant(value: boolean) {
  return value ? 'default' : 'outline';
}

function RuleStatusTree({ rules }: { rules: RuleRuntimeStatus[] }) {
  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No rule trace was recorded for this entry.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {rules.map((rule, index) => (
        <RuleStatusItem
          key={`${index}-${rule.error ?? 'ok'}`}
          rule={rule}
          index={index}
        />
      ))}
    </ol>
  );
}

function RuleStatusItem({
  rule,
  index,
}: {
  rule: RuleRuntimeStatus;
  index: number;
}) {
  return (
    <li className="rounded-md border border-border bg-background/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Rule {index + 1}</Badge>
        <Badge variant={statusBadgeVariant(rule.condition_match)}>
          condition {rule.condition_match ? 'matched' : 'missed'}
        </Badge>
        <Badge variant={statusBadgeVariant(rule.trigger_match)}>
          trigger {rule.trigger_match ? 'matched' : 'missed'}
        </Badge>
        {rule.error ? <Badge variant="destructive">error</Badge> : null}
      </div>
      {rule.error ? (
        <p className="mt-2 rounded-xl bg-destructive/10 p-2 text-sm text-destructive">
          {rule.error}
        </p>
      ) : null}
      {rule.children && rule.children.length > 0 ? (
        <div className="mt-3 border-l border-border pl-3">
          <RuleStatusTree rules={rule.children} />
        </div>
      ) : null}
    </li>
  );
}

function ConditionTraceTree({ node }: { node: ConditionTraceNode }) {
  const { advanced } = useSettingsPreferences();
  const reason = node.unknown_reason;
  const related =
    reason?.kind === 'offline' || reason?.kind === 'stale'
      ? configItemHref('device', reason.device)
      : reason?.kind === 'empty_selection'
        ? configItemHref('group', reason.group)
        : reason?.kind === 'unknown_source_value'
          ? configItemHref('source', reason.source)
          : null;
  return (
    <li className="rounded-md border border-border bg-background/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {advanced && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {node.path || '/'}
          </Badge>
        )}
        <Badge variant={node.truth === 'true' ? 'default' : 'outline'}>
          {truthLabel(node.truth)}
        </Badge>
        {!node.evaluated ? (
          <Badge variant="outline">not evaluated</Badge>
        ) : null}
        {node.error ? <Badge variant="destructive">error</Badge> : null}
        {node.unknown_reason ? <Badge variant="muted">unknown</Badge> : null}
      </div>
      {node.error ? (
        <p className="mt-2 rounded-xl bg-destructive/10 p-2 text-sm text-destructive">
          {node.error}
        </p>
      ) : null}
      {node.unknown_reason ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {describeUnknownReason(node.unknown_reason)}
          {related && (
            <>
              {' '}
              ·{' '}
              <Link className="settings-link" to={related}>
                Open related settings
              </Link>
            </>
          )}
        </p>
      ) : null}
      {(node.children ?? []).length > 0 ? (
        <div className="mt-3 border-l border-border pl-3">
          <ol className="space-y-2">
            {(node.children ?? []).map((child, index) => (
              <ConditionTraceTree
                key={`${index}-${child.path}-${child.node_id ?? ''}`}
                node={child}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}

function PlannedStepList({
  run,
  routineId,
}: {
  run: PlannedRunStatus;
  routineId: string;
}) {
  const { advanced } = useSettingsPreferences();
  if (run.steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No steps were planned for this run.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {run.steps.map((step, index) => (
        <li
          key={`${index}-${step.action_id}`}
          className="rounded-md border border-border bg-background/70 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                step.disposition === 'dispatched' ? 'default' : 'outline'
              }
            >
              {step.disposition}
            </Badge>
            <Link
              className="settings-link text-xs"
              to={`${configItemHref('routine', routineId)}?node=${encodeURIComponent(step.action_id)}`}
            >
              {step.kind.replaceAll('_', ' ')}
            </Link>
            {advanced && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {step.action_id}
              </span>
            )}
          </div>
          {(step.references ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {step.references!.map((reference) => (
                <Link
                  className="settings-link break-all"
                  key={`${reference.entity}/${reference.entity_id}`}
                  to={configItemHref(reference.entity, reference.entity_id)}
                >
                  {reference.entity}:{' '}
                  <ActivityEntityName
                    entity={reference.entity}
                    id={reference.entity_id}
                  />
                </Link>
              ))}
            </div>
          )}
          {step.targets.length > 0 && (!step.references?.length || advanced) ? (
            <p className="mt-1 wrap-break-word font-mono text-xs text-muted-foreground">
              {step.targets.join(', ')}
            </p>
          ) : null}
          {step.reason ? (
            <p className="mt-1 text-xs text-destructive">{step.reason}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function EntryEvidence({ entry }: { entry: RoutineHistoryEntry }) {
  const { advanced } = useSettingsPreferences();
  const v2 = entry.v2;
  const run = recordedRun(entry);
  return (
    <div className="space-y-4 border-t border-border bg-muted/20 p-3 text-sm">
      <p>{explainEntry(entry)}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link
          className="settings-link"
          to={configItemHref('routine', entry.routine_id)}
        >
          Open routine
        </Link>
        {entry.event_source_device_key && (
          <>
            <Link
              className="settings-link break-all"
              to={configItemHref('device', entry.event_source_device_key)}
            >
              Source device:{' '}
              <ActivityEntityName
                entity="device"
                id={entry.event_source_device_key}
              />
            </Link>
            <Link
              className="settings-link"
              to={`/config/logs?device=${encodeURIComponent(entry.event_source_device_key)}`}
            >
              Device logs
            </Link>
          </>
        )}
      </div>
      {advanced && (
        <p className="break-all font-mono text-xs text-muted-foreground">
          Record {entry.id} · Routine {entry.routine_id}
          {v2
            ? ` · Definition revision ${v2.definition_revision}`
            : ' · Legacy routine'}
          {run ? ` · Run ${run.run_id}` : ''}
        </p>
      )}
      {v2 ? (
        <>
          <ActivityDefinitionNotice
            id={entry.routine_id}
            recordedRevision={v2.definition_revision}
          />
          <section className="space-y-2" aria-label="Recorded steps">
            <h3 className="font-medium">Steps</h3>
            {run ? (
              <PlannedStepList run={run} routineId={entry.routine_id} />
            ) : (
              <p className="text-muted-foreground">
                No run outcome was recorded for this attempt.
              </p>
            )}
          </section>
          <section className="space-y-2" aria-label="Recorded condition">
            <h3 className="font-medium">
              Condition · {truthLabel(v2.condition.truth)}
            </h3>
            <ol>
              <ConditionTraceTree node={v2.condition.trace} />
            </ol>
          </section>
          <section className="space-y-2" aria-label="Recorded triggers">
            <h3 className="font-medium">Triggers</h3>
            {v2.triggers.length ? (
              <ul className="divide-y divide-border">
                {v2.triggers.map((trigger) => (
                  <li
                    key={trigger.trigger_id}
                    className="flex flex-wrap items-baseline gap-2 py-2"
                  >
                    <Link
                      className="settings-link"
                      to={`${configItemHref('routine', entry.routine_id)}?node=${encodeURIComponent(trigger.trigger_id)}`}
                    >
                      {trigger.kind.replaceAll('_', ' ')}
                      {advanced ? ` · ${trigger.trigger_id}` : ''}
                    </Link>
                    <span>{trigger.fired ? 'Matched' : 'Did not match'}</span>
                    {trigger.error && (
                      <span className="text-destructive">{trigger.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                No trigger trace was recorded.
              </p>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            This is recorded evidence. Reference names use current settings; the
            recorded IDs and outcomes stay unchanged.
          </p>
        </>
      ) : (
        <section className="space-y-2">
          <h3 className="font-medium">Recorded rules</h3>
          <RuleStatusTree rules={entry.status?.rules ?? []} />
        </section>
      )}
    </div>
  );
}

export default function RoutineHistoryPage() {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<RoutineHistoryEntry[]>([]);
  const { data, loading, error, refetch, lastUpdated } = useRoutineHistory(
    5000,
    paused,
  );
  const { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(100);
  const search = params.get('q') ?? '';
  const routine = params.get('routine') ?? '';
  const kind = params.get('kind') ?? '';
  const result = params.get('outcome') ?? '';
  const rows = paused ? frozen : data;
  const filtered = [...rows]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .filter(
      (entry) =>
        (!routine || entry.routine_id === routine) &&
        (!kind || entry.trigger_kind === kind) &&
        (!result ||
          (result === 'attention'
            ? outcome(entry) !== 'Dispatched'
            : outcome(entry) === result)) &&
        `${entry.routine_name} ${entry.routine_id} ${entry.event_source_device_key ?? ''} ${summary(entry)} ${(entry.v2?.matched_trigger_ids ?? []).join(' ')}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    );
  const patch = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(100);
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    ['q', 'routine', 'kind', 'outcome'].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
    setLimit(100);
  };
  const routines = new Map(
    rows.map((entry) => [
      entry.routine_id,
      entry.routine_name || entry.routine_id,
    ]),
  );
  if (routine && !routines.has(routine)) routines.set(routine, routine);
  const filtersActive = Boolean(search || routine || kind || result);
  return (
    <ActivityReferenceProvider>
      <div className="mx-auto max-w-[1600px] space-y-4">
        <ConfigPageHeader
          title="Routine activity"
          description="Recorded attempts and dispatched actions. A device report confirms what physically happened."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!paused) setFrozen(data);
                  setPaused(!paused);
                }}
              >
                {paused ? (
                  <Play className="size-4" />
                ) : (
                  <Pause className="size-4" />
                )}
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh activity"
                disabled={paused || loading}
                onClick={() => void refetch()}
              >
                <RefreshCw
                  className={`size-4 ${loading ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          }
        />
        <div className="flex flex-wrap gap-2">
          <Input
            type="search"
            aria-label="Search activity"
            placeholder="Search routines, devices or reasons"
            className="min-w-0 flex-1 sm:min-w-48"
            value={search}
            onChange={(e) => patch('q', e.target.value)}
          />
          <div className="w-full sm:w-64">
            <SearchablePicker
              clearable={false}
              ariaLabel="Routine filter"
              value={routine ? 'routine:' + routine : 'all'}
              onChange={(value) =>
                patch('routine', value === 'all' ? '' : value.slice(8))
              }
              options={[
                { value: 'all', label: 'All routines' },
                ...[...routines]
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([id, name]) => ({
                    value: 'routine:' + id,
                    label: name,
                    detail: id,
                  })),
              ]}
            />
          </div>
          <SettingsSelect
            className="w-full sm:w-auto sm:min-w-40"
            aria-label="Activity outcome"
            value={result || 'all'}
            onValueChange={(value) =>
              patch('outcome', value === 'all' ? '' : value)
            }
            options={[
              { value: 'all', label: 'All outcomes' },
              { value: 'attention', label: 'Needs explanation' },
              ...[
                'Dispatched',
                'Blocked',
                'Rejected',
                'Error',
                'Unknown',
                'Some steps skipped',
                'All steps skipped',
                'No actions',
                'No run recorded',
              ].map((value) => ({ value, label: value })),
            ]}
          />
          {advanced && (
            <SettingsSelect
              className="w-full sm:w-auto sm:min-w-40"
              aria-label="Activity kind"
              value={kind || 'all'}
              onValueChange={(value) =>
                patch('kind', value === 'all' ? '' : value)
              }
              options={[
                { value: 'all', label: 'All event types' },
                ...Object.entries(triggerLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          )}
          {filtersActive && (
            <Button variant="ghost" onClick={clear}>
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {filtered.length} of {rows.length} retained entries ·{' '}
            {paused ? 'Updates paused' : 'Newest first'}
          </span>
          <span>
            {lastUpdated
              ? `Updated ${formatShortTime(lastUpdated)}`
              : 'Waiting for activity'}
          </span>
        </div>
        <ActivityReferenceStatus />
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-destructive"
          >
            {error}
            {rows.length > 0 && ' · Showing the last successful result.'}
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}
        {loading && !rows.length ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading activity…
          </p>
        ) : !filtered.length ? (
          <p className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
            {error
              ? 'Activity is unavailable until the request succeeds.'
              : filtersActive
                ? 'No recorded attempts match these filters.'
                : 'No retained activity yet. This does not prove that a device event was received or that no routine was evaluated.'}
          </p>
        ) : (
          <div
            className="settings-activity-list divide-y divide-border overflow-hidden rounded-lg border border-border"
            aria-label="Routine activity entries"
          >
            {filtered.slice(0, limit).map((entry) => (
              <details
                key={entry.id}
                className="group"
                data-activity-id={entry.id}
              >
                <summary className="settings-activity-summary grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
                  <time
                    dateTime={entry.timestamp}
                    title={formatTimestamp(entry.timestamp)}
                    className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
                  >
                    <ChevronRight
                      aria-hidden
                      className="size-3 shrink-0 transition-transform group-open:rotate-90"
                    />
                    {formatTimestamp(entry.timestamp)}
                  </time>
                  <span className="min-w-0 truncate font-medium">
                    {entry.routine_name || entry.routine_id}
                  </span>
                  <span
                    className={`text-xs font-medium ${['Dispatched', 'No actions'].includes(outcome(entry)) ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}
                  >
                    {outcome(entry)}
                  </span>
                  <span
                    className="min-w-0 truncate text-xs text-muted-foreground"
                    title={summary(entry)}
                  >
                    {summary(entry)}
                  </span>
                </summary>
                <EntryEvidence entry={entry} />
              </details>
            ))}
          </div>
        )}
        {filtered.length > limit && (
          <Button variant="outline" onClick={() => setLimit((n) => n + 100)}>
            Show more ({filtered.length - limit} remaining)
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          The newest 500 entries are retained across restarts when database
          persistence is available. Identical blocked attempts may share one
          entry. Legacy routines record runs only.
        </p>
      </div>
    </ActivityReferenceProvider>
  );
}
