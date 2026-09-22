import { ArrowRight, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { AssistantOperation } from '@/bindings/AssistantOperation';
import type { AssistantOpKind } from '@/bindings/AssistantOpKind';
import {
  describeJsonValue,
  formatJson,
  operationChangeSummary,
  operationDetails,
  operationFieldChanges,
  operationTarget,
  routineDefinitionLines,
} from '@/lib/assistant-diff';
import { cn } from '@/lib/cn';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';

import { AssistantEntityIcon } from './AttachmentChip';

const opLabels: Record<AssistantOpKind, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

const opBadgeClassName: Record<AssistantOpKind, string> = {
  create:
    'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  update: 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300',
  delete:
    'border-transparent bg-destructive/15 text-destructive dark:text-red-300',
};

function ChangedFieldRow({
  label,
  kind,
  before,
  after,
}: {
  label: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
}) {
  return (
    <li className="space-y-1 rounded-xl bg-background/70 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        <Badge variant="muted" className="px-1.5 py-0 text-[0.65rem]">
          {kind}
        </Badge>
      </div>
      {kind === 'changed' ? (
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-muted-foreground">
          <span>{describeJsonValue(before)}</span>
          <ArrowRight className="size-3 shrink-0" />
          <span className="text-foreground">{describeJsonValue(after)}</span>
        </div>
      ) : (
        <div className="font-mono text-muted-foreground">
          {describeJsonValue(kind === 'added' ? after : before)}
        </div>
      )}
    </li>
  );
}

/**
 * Lightweight expandable diff for one proposed operation: collapsed shows the
 * entity and operation, expanded shows changed top-level fields plus the final
 * entity state (with a read-only routine summary when applicable).
 */
export function OperationDiff({
  operation,
}: {
  operation: AssistantOperation;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showState, setShowState] = useState(false);
  const target = operationTarget(operation);
  const summary = operationChangeSummary(operation);
  const details = operationDetails(operation);
  const fields = operationFieldChanges(operation);
  const routineLines =
    operation.kind === 'routine' && operation.after
      ? routineDefinitionLines(operation.after)
      : [];
  const finalState = operation.after ?? operation.before;

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronRight
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge className={opBadgeClassName[operation.op]}>
              {opLabels[operation.op]}
            </Badge>
            <AssistantEntityIcon
              kind={operation.kind}
              className="text-muted-foreground"
            />
            <span className="truncate text-sm font-medium">
              {target?.label ?? operation.label}
            </span>
          </span>
          <span className="block text-xs text-muted-foreground">
            {summary}
            {target && target.id !== target.label ? ` · ${target.id}` : ''}
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {details.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {details.map((detail) => (
                <li key={detail} className="flex items-start gap-1.5">
                  <span aria-hidden className="text-foreground/40">
                    •
                  </span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {routineLines.length > 0 ? (
            <div className="space-y-1 rounded-xl bg-background/70 px-3 py-2 text-xs">
              <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Routine summary
              </div>
              {routineLines.map((line) => (
                <div key={line} className="text-muted-foreground">
                  {line}
                </div>
              ))}
            </div>
          ) : null}

          {fields.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Changed fields
              </div>
              <ul className="space-y-2">
                {fields.map((field) => (
                  <ChangedFieldRow
                    key={field.key}
                    label={field.label}
                    kind={field.kind}
                    before={field.before}
                    after={field.after}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowState((current) => !current)}
            >
              {showState ? 'Hide entity state' : 'Show entity state'}
            </Button>
            {showState ? (
              <pre className="max-h-72 overflow-auto rounded-xl bg-background/80 p-3 font-mono text-[0.7rem] leading-relaxed">
                {formatJson(finalState)}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
