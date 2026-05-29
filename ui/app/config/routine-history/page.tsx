import {
  type RoutineHistoryEntry,
  type RoutineHistoryTriggerKind,
  useRoutineHistory,
} from '@/hooks/useConfig';
import { type RuleRuntimeStatus } from '@/bindings/RuleRuntimeStatus';
import { ConfigPageHeader } from '../page-header';
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
  RefreshCw,
  Zap,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

type TriggerFilter = RoutineHistoryTriggerKind | 'all';

const triggerLabels: Record<RoutineHistoryTriggerKind, string> = {
  rule_match: 'Rule match',
  force_trigger: 'Force trigger',
};

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString('en-FI', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
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
  const [search, setSearch] = useState('');

  const normalizedSearch = search.trim().toLowerCase();
  const visibleHistory = [...data]
    .reverse()
    .filter((entry) => matchesTriggerFilter(entry, triggerFilter))
    .filter((entry) => matchesSearchFilter(entry, normalizedSearch));
  const ruleMatches = data.filter(
    (entry) => entry.trigger_kind === 'rule_match',
  ).length;
  const forceTriggers = data.filter(
    (entry) => entry.trigger_kind === 'force_trigger',
  ).length;
  const entriesWithErrors = data.filter(
    (entry) => countRuleErrors(entry) > 0,
  ).length;

  if (loading && data.length === 0) {
    return (
      <div className="grid max-w-6xl gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-32" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-5">
      <ConfigPageHeader
        title="Routine History"
        description="Recent routine activations, trigger sources, action counts, and rule traces from the in-memory runtime buffer."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="text-xs text-muted-foreground">
              {lastUpdated
                ? `Last updated ${formatTimestamp(lastUpdated)}`
                : 'Waiting for first update'}
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw />
              Refresh Now
            </Button>
          </div>
        }
      />

      {error && (
        <Alert variant="warning">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          description="Triggered by evaluated rules."
        />
        <HistoryStatCard
          icon={<CheckCircle2 className="size-5" />}
          label="Manual triggers"
          value={forceTriggers}
          description="Forced from UI, CLI, or API."
        />
        <HistoryStatCard
          icon={<AlertTriangle className="size-5" />}
          label="Entries with errors"
          value={entriesWithErrors}
          description="At least one rule returned an error."
        />
      </div>

      <Card>
        <CardContent className="gap-4 pt-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="grid w-full gap-2 lg:max-w-xs">
              <Label>Trigger type</Label>
              <Select
                value={triggerFilter}
                onValueChange={(value) =>
                  setTriggerFilter(value as TriggerFilter)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All triggers</SelectItem>
                  <SelectItem value="rule_match">Rule matches</SelectItem>
                  <SelectItem value="force_trigger">Manual triggers</SelectItem>
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

          <div className="mt-4 text-sm text-muted-foreground">
            Showing {visibleHistory.length} of {data.length} buffered routine
            history entries.
          </div>
        </CardContent>
      </Card>

      {visibleHistory.length === 0 ? (
        <EmptyState
          title="No routine history yet"
          description="Routine rule matches and manual routine triggers will appear here after the server records them."
        />
      ) : (
        <div className="space-y-3">
          {visibleHistory.map((entry) => {
            const errorCount = countRuleErrors(entry);
            return (
              <Card key={entry.id}>
                <CardHeader className="gap-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            entry.trigger_kind === 'rule_match'
                              ? 'default'
                              : 'secondary'
                          }
                        >
                          {triggerLabels[entry.trigger_kind]}
                        </Badge>
                        {entry.status?.will_trigger ? (
                          <Badge variant="default">will trigger</Badge>
                        ) : null}
                        {errorCount > 0 ? (
                          <Badge variant="destructive">
                            {errorCount} rule{' '}
                            {errorCount === 1 ? 'error' : 'errors'}
                          </Badge>
                        ) : null}
                      </div>
                      <CardTitle className="wrap-break-word text-base">
                        {entry.routine_name || entry.routine_id}
                      </CardTitle>
                      <CardDescription className="wrap-break-word">
                        {entry.routine_id}
                        {entry.event_source_device_key
                          ? ` · source ${entry.event_source_device_key}`
                          : ''}
                      </CardDescription>
                    </div>
                    <CardDescription>
                      {formatTimestamp(entry.timestamp)}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 rounded-2xl bg-muted/40 p-3 text-sm sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">Actions</span>
                      <div className="font-medium text-foreground">
                        {entry.action_count}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Conditions</span>
                      <div className="font-medium text-foreground">
                        {entry.status?.all_conditions_match
                          ? 'matched'
                          : 'not recorded'}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Event source
                      </span>
                      <div className="wrap-break-word font-medium text-foreground">
                        {entry.event_source_device_key ?? 'manual'}
                      </div>
                    </div>
                  </div>

                  <details className="rounded-2xl border border-border bg-muted/20">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                      Rule trace
                    </summary>
                    <div className="border-t border-border p-4">
                      <RuleStatusTree rules={entry.status?.rules ?? []} />
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
