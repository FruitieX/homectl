import {
  type RoutineHistoryEntry,
  type RoutineHistoryTriggerKind,
  useRoutineHistory,
} from '@/hooks/useConfig';
import { type ConditionTraceNode } from '@/bindings/ConditionTraceNode';
import { type PlannedRunStatus } from '@/bindings/PlannedRunStatus';
import { type RuleRuntimeStatus } from '@/bindings/RuleRuntimeStatus';
import { type TruthValue } from '@/bindings/TruthValue';
import { type UnknownReason } from '@/bindings/UnknownReason';
import { Link } from 'react-router-dom';
import { ConfigTabs } from '@/ui/ConfigTabs';
import { ConfigPageHeader } from '../page-header';
import { Advanced } from '@/ui/primitives/advanced';
import { useSearchParamState } from '@/hooks/useDeepLink';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';
import { Skeleton } from '@/ui/primitives/skeleton';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

type TriggerFilter = RoutineHistoryTriggerKind | 'all';

const triggerLabels: Record<RoutineHistoryTriggerKind, string> = {
  rule_match: 'Rule match',
  force_trigger: 'Force trigger',
  v2_run: 'v2 run',
};

function truthLabel(truth: TruthValue) {
  return truth === 'true' ? 'true' : truth === 'false' ? 'false' : 'unknown';
}

function describeUnknownReason(reason: UnknownReason) {
  switch (reason.kind) {
    case 'missing_entity':
      return `Missing entity: ${reason.entity}`;
    case 'missing_field':
      return `Missing field: ${reason.field}`;
    case 'offline':
      return `Device offline: ${reason.device}`;
    case 'stale':
      return `Stale observation: ${reason.device}`;
    case 'empty_selection':
      return `Group has no members: ${reason.group}`;
    case 'not_initialized':
      return `Not initialized: ${reason.entity}`;
    case 'unknown_source_value':
      return `Source has no value: ${reason.source}`;
  }
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
function entryEvent(entry: RoutineHistoryEntry) {
  if (entry.v2) {
    const ids = entry.v2.matched_trigger_ids;
    if (ids.length === 0) {
      return 'no trigger matched';
    }
    return `${ids.length} trigger${ids.length === 1 ? '' : 's'} matched`;
  }
  return entry.event_source_device_key
    ? `event from ${entry.event_source_device_key}`
    : 'rule or manual trigger';
}

/** What the routine did about it, or why it did nothing. */
function entryOutcome(entry: RoutineHistoryEntry) {
  if (entry.v2) {
    if (entry.v2.last_run) {
      if (!entry.v2.last_run.accepted) {
        return 'run rejected';
      }
      const dropped = Number(entry.v2.last_run.dropped);
      return `ran, ${entry.action_count} dispatched${dropped > 0 ? `, ${dropped} dropped` : ''}`;
    }
    return entry.v2.condition.truth === 'true'
      ? 'waiting for a run'
      : `condition ${truthLabel(entry.v2.condition.truth)}`;
  }
  return entry.status?.will_trigger ? 'will trigger' : 'not run';
}

function flattenRuleStatuses(rules: RuleRuntimeStatus[]) {
  const flattened: RuleRuntimeStatus[] = [];
  const visitRule = (rule: RuleRuntimeStatus) => {
    flattened.push(rule);
    rule.children?.forEach(visitRule);
  };

  rules.forEach(visitRule);
  return flattened;
}

function countRuleErrors(entry: RoutineHistoryEntry) {
  return flattenRuleStatuses(entry.status?.rules ?? []).filter(
    (rule) => rule.error,
  ).length;
}

function countV2Errors(entry: RoutineHistoryEntry) {
  const v2 = entry.v2;
  if (!v2) {
    return 0;
  }
  return (
    (v2.condition.error ? 1 : 0) +
    v2.triggers.filter((trigger) => trigger.error).length
  );
}

function countEntryErrors(entry: RoutineHistoryEntry) {
  return entry.v2 ? countV2Errors(entry) : countRuleErrors(entry);
}

/**
 * Plain-language "why it ran or did not run" summary for one history entry,
 * built from the recorded trigger, condition, and plan outcome.
 */
function explainEntry(entry: RoutineHistoryEntry): string {
  const v2 = entry.v2;
  if (!v2) {
    if (entry.trigger_kind === 'force_trigger') {
      return `Manually triggered: ${entry.action_count} stored v1 action${entry.action_count === 1 ? '' : 's'} replayed.`;
    }
    return entry.status?.will_trigger
      ? `Rules matched${entry.event_source_device_key ? ` from ${entry.event_source_device_key}` : ''}; ${entry.action_count} action${entry.action_count === 1 ? '' : 's'} dispatched.`
      : 'Rules were evaluated but did not all match, so nothing ran.';
  }

  if (v2.condition.error) {
    return `Not run: the condition errored (${v2.condition.error}).`;
  }
  if (v2.condition.truth === 'unknown') {
    return `Not run: ${v2.condition.unknown_reason ? describeUnknownReason(v2.condition.unknown_reason) : 'part of the condition could not be evaluated'}.`;
  }
  if (v2.condition.truth === 'false') {
    return `Triggered, but the condition was false, so nothing ran.`;
  }

  const steps = v2.last_run?.steps ?? [];
  const suppressed = steps.filter((step) => step.disposition === 'suppressed');
  const dispatched = steps.filter(
    (step) => step.disposition === 'dispatched',
  ).length;

  if (v2.last_run && !v2.last_run.accepted) {
    const reason = suppressed.find((step) => step.reason)?.reason;
    return `Blocked by the execution policy: ${reason ?? 'the plan was rejected before dispatch'}.`;
  }

  const triggerText =
    v2.matched_trigger_ids.length > 0
      ? v2.matched_trigger_ids.join(', ')
      : 'a trigger';
  let summary = `Ran because ${triggerText} matched and the condition was true.`;
  if (dispatched > 0) {
    summary += ` ${dispatched} step${dispatched === 1 ? '' : 's'} dispatched.`;
  }
  if (suppressed.length > 0) {
    summary += ` ${suppressed.length} step${suppressed.length === 1 ? '' : 's'} suppressed (${suppressed[0].reason ?? 'no reason recorded'}).`;
  }
  if (v2.last_run && v2.last_run.dropped > 0n) {
    summary += ` ${v2.last_run.dropped.toString()} dropped by the bounded queue.`;
  }
  return summary;
}

function matchesTriggerFilter(
  entry: RoutineHistoryEntry,
  triggerFilter: TriggerFilter,
) {
  return triggerFilter === 'all' || entry.trigger_kind === triggerFilter;
}

function matchesSearchFilter(entry: RoutineHistoryEntry, search: string) {
  if (!search) {
    return true;
  }

  const haystack = [
    entry.routine_id,
    entry.routine_name,
    entry.trigger_kind,
    entry.event_source_device_key ?? '',
    (entry.v2?.matched_trigger_ids ?? []).join(' '),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(search);
}

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
    <li className="rounded-2xl border border-border bg-background/70 p-3">
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
  return (
    <li className="rounded-2xl border border-border bg-background/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {node.path || '/'}
        </Badge>
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

function PlannedStepList({ run }: { run: PlannedRunStatus }) {
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
          className="rounded-2xl border border-border bg-background/70 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                step.disposition === 'dispatched' ? 'default' : 'outline'
              }
            >
              {step.disposition}
            </Badge>
            <span className="font-mono text-xs text-foreground">
              {step.kind}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {step.action_id}
            </span>
          </div>
          {step.targets.length > 0 ? (
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

function HistoryStatCard({
  icon,
  label,
  value,
  description,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-5">
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">{icon}</div>
        <div>
          <div className="text-2xl font-semibold text-foreground">{value}</div>
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RoutineHistoryPage() {
  const { data, loading, error, refetch, lastUpdated } = useRoutineHistory();
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [search, setSearch] = useSearchParamState();

  const normalizedSearch = search.trim().toLowerCase();
  const visibleHistory = [...data]
    .reverse()
    .filter((entry) => matchesTriggerFilter(entry, triggerFilter))
    .filter((entry) => matchesSearchFilter(entry, normalizedSearch));
  const filtersActive = triggerFilter !== 'all' || normalizedSearch.length > 0;
  const ruleMatches = data.filter(
    (entry) => entry.trigger_kind === 'rule_match',
  ).length;
  const forceTriggers = data.filter(
    (entry) => entry.trigger_kind === 'force_trigger',
  ).length;
  const v2Runs = data.filter((entry) => entry.trigger_kind === 'v2_run').length;
  const entriesWithErrors = data.filter(
    (entry) => countEntryErrors(entry) > 0,
  ).length;

  const initialLoading = loading && data.length === 0;

  return (
    <div className="max-w-6xl space-y-5">
      <ConfigTabs
        tabs={[
          { label: 'Routines', to: '/config/routines' },
          { label: 'Activity', to: '/config/routine-history', active: true },
        ]}
      />
      <ConfigPageHeader
        title="Automation history"
        description="See what triggered a routine, what ran, and which steps were skipped. Commands here do not confirm physical device delivery."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="text-xs text-muted-foreground">
              {lastUpdated
                ? `Last updated ${formatTimestamp(lastUpdated)}`
                : 'Waiting for first update'}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void refetch()}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              Refresh Now
            </Button>
          </div>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {initialLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm">
            <span className="font-medium">
              {data.length} recent {data.length === 1 ? 'event' : 'events'}
            </span>
            {entriesWithErrors > 0 ? (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {entriesWithErrors} with errors
              </span>
            ) : null}
            <span className="ml-2 text-muted-foreground">
              Newest 500 are kept across restarts.
            </span>
          </div>
          <Advanced label="Activity breakdown">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <HistoryStatCard
                icon={<Activity className="size-5" />}
                label="Buffered entries"
                value={data.length}
                description="Newest entries are kept in memory."
              />
              <HistoryStatCard
                icon={<Zap className="size-5" />}
                label="Rule matches"
                value={ruleMatches}
                description="v1 routines triggered by evaluated rules."
              />
              <HistoryStatCard
                icon={<CheckCircle2 className="size-5" />}
                label="Manual triggers"
                value={forceTriggers}
                description="Forced from UI, CLI, or API."
              />
              <HistoryStatCard
                icon={<Activity className="size-5" />}
                label="v2 runs"
                value={v2Runs}
                description="Dispatched v2 plans with traces."
              />
              <HistoryStatCard
                icon={<AlertTriangle className="size-5" />}
                label="Entries with errors"
                value={entriesWithErrors}
                description="At least one rule or v2 node errored."
              />
            </div>
          </Advanced>

          <Card>
            <CardContent className="gap-4 pt-5">
              <div className="flex flex-col gap-3 lg:flex-row">
                <div className="grid w-full gap-2 lg:max-w-xs">
                  <Label htmlFor="routine-history-trigger">Trigger type</Label>
                  <Select
                    value={triggerFilter}
                    onValueChange={(value) =>
                      setTriggerFilter(value as TriggerFilter)
                    }
                  >
                    <SelectTrigger id="routine-history-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All triggers</SelectItem>
                      <SelectItem value="rule_match">Rule matches</SelectItem>
                      <SelectItem value="force_trigger">
                        Manual triggers
                      </SelectItem>
                      <SelectItem value="v2_run">v2 runs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid w-full gap-2">
                  <Label htmlFor="routine-history-search">Search</Label>
                  <Input
                    id="routine-history-search"
                    type="search"
                    placeholder="Filter by routine id, name, or source device"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  Showing {visibleHistory.length} of {data.length} buffered
                  routine history entries.
                </span>
                {filtersActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setTriggerFilter('all');
                      setSearch('');
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {visibleHistory.length === 0 ? (
            <EmptyState
              title={
                filtersActive
                  ? 'No matching history entries'
                  : 'No routine history yet'
              }
              description={
                filtersActive
                  ? 'Nothing matches the current trigger type and search filters.'
                  : 'Routine rule matches and manual routine triggers will appear here after the server records them.'
              }
              action={
                filtersActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTriggerFilter('all');
                      setSearch('');
                    }}
                  >
                    Show all entries
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {visibleHistory.map((entry) => {
                const errorCount = countEntryErrors(entry);
                const v2 = entry.v2;
                return (
                  <Card key={entry.id}>
                    <CardHeader className="gap-3">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2">
                          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatShortTime(entry.timestamp)}
                            </span>
                            <Link
                              className="font-semibold wrap-break-word underline-offset-2 hover:underline"
                              to={`/config/routines/${encodeURIComponent(entry.routine_id)}`}
                            >
                              {entry.routine_name || entry.routine_id}
                            </Link>
                            <span className="text-muted-foreground">
                              · {entryEvent(entry)}
                            </span>
                            <span className="font-medium">
                              · {entryOutcome(entry)}
                            </span>
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                entry.trigger_kind === 'force_trigger'
                                  ? 'secondary'
                                  : 'default'
                              }
                            >
                              {triggerLabels[entry.trigger_kind]}
                            </Badge>
                            {entry.status?.will_trigger ? (
                              <Badge variant="default">will trigger</Badge>
                            ) : null}
                            {v2 ? (
                              <>
                                <Badge variant="secondary">
                                  {v2.matched_trigger_ids.length} trigger
                                  {v2.matched_trigger_ids.length === 1
                                    ? ''
                                    : 's'}
                                </Badge>
                                <Badge
                                  variant={
                                    v2.condition.truth === 'true'
                                      ? 'default'
                                      : 'outline'
                                  }
                                >
                                  condition {truthLabel(v2.condition.truth)}
                                </Badge>
                                {v2.last_run ? (
                                  <Badge
                                    variant={
                                      v2.last_run.accepted
                                        ? 'default'
                                        : 'destructive'
                                    }
                                  >
                                    {v2.last_run.accepted
                                      ? 'run accepted'
                                      : 'run rejected'}
                                  </Badge>
                                ) : null}
                                {v2.last_run && v2.last_run.dropped > 0n ? (
                                  <Badge variant="muted">
                                    {v2.last_run.dropped.toString()} dropped
                                  </Badge>
                                ) : null}
                              </>
                            ) : null}
                            {errorCount > 0 ? (
                              <Badge variant="destructive">
                                {errorCount} {entry.v2 ? 'node' : 'rule'}{' '}
                                {errorCount === 1 ? 'error' : 'errors'}
                              </Badge>
                            ) : null}
                          </div>
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer">
                              IDs, source, and record
                            </summary>
                            <p className="mt-1 font-mono wrap-break-word">
                              {entry.routine_id}
                              {entry.event_source_device_key
                                ? ` · ${entry.event_source_device_key}`
                                : ''}
                              {entry.id ? ` · record ${entry.id}` : ''}
                            </p>
                          </details>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="flex items-start gap-2 rounded-2xl border border-border/70 bg-muted/25 p-3 text-sm">
                        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span>{explainEntry(entry)}</span>
                      </p>
                      <div className="grid gap-2 rounded-2xl bg-muted/40 p-3 text-sm sm:grid-cols-3">
                        <div>
                          <span className="text-muted-foreground">Actions</span>
                          <div className="font-medium text-foreground">
                            {entry.action_count}
                            {v2 ? ' dispatched' : ''}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Conditions
                          </span>
                          <div className="font-medium text-foreground">
                            {v2
                              ? `condition ${truthLabel(v2.condition.truth)}`
                              : entry.status?.all_conditions_match
                                ? 'matched'
                                : 'not recorded'}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {v2 ? 'Matched triggers' : 'Event source'}
                          </span>
                          <div className="wrap-break-word font-medium text-foreground">
                            {v2
                              ? v2.matched_trigger_ids.length > 0
                                ? v2.matched_trigger_ids.join(', ')
                                : 'none'
                              : (entry.event_source_device_key ?? 'manual')}
                          </div>
                        </div>
                      </div>

                      {v2 ? (
                        <details className="rounded-2xl border border-border bg-muted/20">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                            Run trace
                          </summary>
                          <div className="space-y-4 border-t border-border p-4">
                            {v2.last_run ? (
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">
                                    Planned steps
                                  </span>
                                  <span>
                                    run {v2.last_run.run_id.toString()}
                                  </span>
                                  <span>
                                    definition revision{' '}
                                    {v2.last_run.definition_revision.toString()}
                                  </span>
                                </div>
                                <PlannedStepList run={v2.last_run} />
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                No run outcome was recorded for this entry.
                              </p>
                            )}
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-foreground">
                                Condition trace
                              </div>
                              <ol className="space-y-2">
                                <ConditionTraceTree node={v2.condition.trace} />
                              </ol>
                            </div>
                            {v2.triggers.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-foreground">
                                  Triggers
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {v2.triggers.map((trigger) => (
                                    <Badge
                                      key={trigger.trigger_id}
                                      variant={
                                        trigger.fired ? 'default' : 'outline'
                                      }
                                    >
                                      {trigger.trigger_id} · {trigger.kind} ·{' '}
                                      {trigger.fired ? 'fired' : 'idle'}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ) : (
                        <details className="rounded-2xl border border-border bg-muted/20">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                            Rule trace
                          </summary>
                          <div className="border-t border-border p-4">
                            <RuleStatusTree rules={entry.status?.rules ?? []} />
                          </div>
                        </details>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
