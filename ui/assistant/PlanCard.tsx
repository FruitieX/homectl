import { CheckCircle2, Loader2, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { AssistantOperation } from '@/bindings/AssistantOperation';
import type { AssistantOperationResult } from '@/bindings/AssistantOperationResult';
import type { AssistantPlan } from '@/bindings/AssistantPlan';
import {
  useApplyAssistantPlan,
  useDiscardAssistantPlan,
} from '@/hooks/useAssistant';
import {
  acceptedByDefault,
  isDestructiveOperation,
  planOperationCounts,
  planTouchesFloorplanEntities,
} from '@/lib/assistant-diff';
import { cn } from '@/lib/cn';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';

import { OperationDiff } from './OperationDiff';
import { FloorplanPreview } from './preview/FloorplanPreview';

function OperationRow({
  operation,
  accepted,
  disabled,
  result,
  onToggle,
}: {
  operation: AssistantOperation;
  accepted: boolean;
  disabled: boolean;
  result?: AssistantOperationResult;
  onToggle: (opId: string) => void;
}) {
  return (
    <div
      className={cn(
        'space-y-2 rounded-2xl border border-border/60 p-2',
        isDestructiveOperation(operation) &&
          'border-destructive/30 bg-destructive/5',
        result && !result.ok && 'border-destructive/40',
      )}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          aria-label={`Accept ${operation.label}`}
          checked={accepted}
          disabled={disabled}
          className="mt-1.5"
          onCheckedChange={() => onToggle(operation.opId)}
        />
        <div className="min-w-0 flex-1">
          <OperationDiff operation={operation} />
        </div>
      </div>
      {operation.warnings && operation.warnings.length > 0 ? (
        <ul className="space-y-1 pl-7 text-xs text-amber-700 dark:text-amber-300">
          {operation.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <span aria-hidden>!</span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {result ? (
        <div
          className={cn(
            'flex items-start gap-1.5 pl-7 text-xs',
            result.ok
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-destructive',
          )}
        >
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>{result.ok ? 'Applied' : (result.error ?? 'Failed')}</span>
        </div>
      ) : null}
    </div>
  );
}

export function PlanCard({
  plan,
  onDiscard,
  readOnly = false,
  initialResults = null,
  initialAcceptedOperationIds,
  onApplied,
}: {
  plan: AssistantPlan;
  onDiscard: () => void;
  /** Stored plan from a reopened thread: offer no applies or discards. */
  readOnly?: boolean;
  /** Results already applied to this plan, restored from a saved thread. */
  initialResults?: AssistantOperationResult[] | null;
  /** Operations the user applied, restored from a saved thread. */
  initialAcceptedOperationIds?: string[];
  /** Called with the results after the plan was applied. */
  onApplied?: (
    results: AssistantOperationResult[],
    acceptedOperationIds: string[],
  ) => void;
}) {
  const applyPlan = useApplyAssistantPlan();
  const discardPlan = useDiscardAssistantPlan();
  const [accepted, setAccepted] = useState<Set<string>>(
    () =>
      new Set(
        initialAcceptedOperationIds ??
          plan.operations
            .filter((operation) => acceptedByDefault(operation))
            .map((operation) => operation.opId),
      ),
  );
  const [results, setResults] = useState<AssistantOperationResult[] | null>(
    initialResults,
  );
  const applied = results !== null;
  const counts = useMemo(() => planOperationCounts(plan), [plan]);
  const resultsByOp = useMemo(
    () => new Map((results ?? []).map((result) => [result.opId, result])),
    [results],
  );
  const showPreview = useMemo(() => planTouchesFloorplanEntities(plan), [plan]);

  const toggle = (opId: string) => {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(opId)) {
        next.delete(opId);
      } else {
        next.add(opId);
      }
      return next;
    });
  };

  const apply = () => {
    if (accepted.size === 0 || applyPlan.isPending) {
      return;
    }
    applyPlan.mutate(
      {
        planId: plan.planId,
        acceptedOperationIds: [...accepted],
      },
      {
        onSuccess: (response) => {
          setResults(response.results);
          onApplied?.(response.results, [...accepted]);
          const failed = response.results.filter((result) => !result.ok);
          if (failed.length === 0) {
            toast.success(
              `Applied ${response.results.length} change${response.results.length === 1 ? '' : 's'}`,
            );
          } else {
            toast.warning(
              `Applied ${response.results.length - failed.length} of ${response.results.length} changes`,
            );
          }
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : 'Failed to apply plan',
          );
        },
      },
    );
  };

  const discard = () => {
    if (applied) {
      onDiscard();
      return;
    }
    discardPlan.mutate(plan.planId, {
      onSettled: () => onDiscard(),
    });
  };

  return (
    <div className="space-y-3 rounded-3xl border border-border bg-card p-3 shadow-sm">
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm leading-relaxed">{plan.summary}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {counts.create > 0 ? (
                <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  {counts.create} create
                </Badge>
              ) : null}
              {counts.update > 0 ? (
                <Badge className="border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  {counts.update} update
                </Badge>
              ) : null}
              {counts.delete > 0 ? (
                <Badge className="border-transparent bg-destructive/15 text-destructive dark:text-red-300">
                  {counts.delete} delete
                </Badge>
              ) : null}
              {applied ? <span>Plan applied</span> : null}
            </div>
          </div>
        </div>

        {showPreview ? <FloorplanPreview plan={plan} /> : null}
      </div>

      {!applied ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {accepted.size} of {plan.operations.length} selected
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                setAccepted(
                  new Set(plan.operations.map((operation) => operation.opId)),
                )
              }
            >
              Accept all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAccepted(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {plan.operations.map((operation) => (
          <OperationRow
            key={operation.opId}
            operation={operation}
            accepted={accepted.has(operation.opId)}
            disabled={readOnly}
            result={resultsByOp.get(operation.opId)}
            onToggle={toggle}
          />
        ))}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={readOnly || discardPlan.isPending}
          onClick={discard}
          className="sm:mr-auto"
        >
          <Trash2 />
          {applied ? 'Dismiss' : 'Discard'}
        </Button>
        <Button
          type="button"
          disabled={accepted.size === 0 || applyPlan.isPending}
          onClick={apply}
        >
          {applyPlan.isPending ? <Loader2 className="animate-spin" /> : null}
          {applyPlan.isPending
            ? 'Applying…'
            : `Apply${applied ? ' again' : ''} ${accepted.size} change${accepted.size === 1 ? '' : 's'}`}
        </Button>
      </div>

      {!applied ? (
        <p className="text-[0.7rem] text-muted-foreground">
          {plan.operations.length} operation
          {plan.operations.length === 1 ? '' : 's'} · changes are written only
          when you apply. Deletes are never selected by default.
        </p>
      ) : null}
    </div>
  );
}
