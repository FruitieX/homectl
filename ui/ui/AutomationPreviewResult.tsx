import type { ConditionEvaluation } from '@/bindings/ConditionEvaluation';
import type { ConditionTraceNode } from '@/bindings/ConditionTraceNode';
import type { PlannedStepStatus } from '@/bindings/PlannedStepStatus';
import type { PreviewStep } from '@/bindings/PreviewStep';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import {
  useGroups,
  useScenes,
  useHelpers,
  useRoutines,
  useDeviceDisplayNames,
} from '@/hooks/useConfig';
import {
  conditionResult,
  previewActionLabel,
  previewReferences,
  scalarPreviewValue,
} from '@/lib/automationPreview';
import { formatUnknownReason } from '@/lib/routineRuntimeText';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { configItemHref } from '@/lib/configItemHref';
import {
  CheckCircle2,
  CircleMinus,
  CircleHelp,
  AlertTriangle,
  ArrowRight,
  Braces,
  ListChecks,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export function ConditionPreviewResult({
  condition,
}: {
  condition: ConditionEvaluation;
}) {
  const { advanced } = useSettingsPreferences();
  const { label, tone } = conditionResult(condition);
  const Icon =
    tone === 'error'
      ? AlertTriangle
      : tone === 'success'
        ? CheckCircle2
        : tone === 'warning'
          ? CircleHelp
          : CircleMinus;
  return (
    <section aria-label="Condition result" className="space-y-3">
      <div className="flex items-center gap-3">
        <Icon
          className={`size-5 shrink-0 ${tone === 'error' ? 'text-destructive' : tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : tone === 'success' ? 'text-primary' : 'text-muted-foreground'}`}
        />
        <h3 className="text-base font-semibold">{label}</h3>
      </div>
      {tone === 'error' ? (
        <p role="alert" className="text-sm text-destructive wrap-break-word">
          {condition.error || 'The calculation failed without an explanation.'}
        </p>
      ) : condition.unknown_reason ? (
        <p className="text-sm text-muted-foreground">
          {formatUnknownReason(condition.unknown_reason)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {condition.truth === 'true'
            ? 'This condition passes with the current values.'
            : condition.truth === 'false'
              ? 'This condition does not pass with the current values.'
              : 'The current values are not sufficient to decide.'}
        </p>
      )}
      {condition.trace && (
        <details className="text-sm">
          <summary className="cursor-pointer text-primary">
            Why this result?
          </summary>
          <ol className="mt-3 space-y-2">
            <ConditionPreviewTrace node={condition.trace} advanced={advanced} />
          </ol>
        </details>
      )}
    </section>
  );
}

function ConditionPreviewTrace({
  node,
  advanced,
}: {
  node: ConditionTraceNode;
  advanced: boolean;
}) {
  const status = conditionResult(node);
  return (
    <li className="space-y-1">
      <p className="flex flex-wrap gap-x-2 gap-y-1">
        <span className="font-medium">
          {node.evaluated ? status.label : 'Not evaluated'}
        </span>
        {advanced && (
          <span className="break-all font-mono text-xs text-muted-foreground">
            {node.path}
          </span>
        )}
      </p>
      {node.error !== undefined && (
        <p className="wrap-break-word text-destructive">
          {node.error || 'The calculation failed without an explanation.'}
        </p>
      )}
      {node.unknown_reason && (
        <p className="text-muted-foreground">
          {formatUnknownReason(node.unknown_reason)}
        </p>
      )}
      {!!node.children?.length && (
        <ol className="space-y-2 border-l border-border pl-3">
          {node.children.map((child, index) => (
            <ConditionPreviewTrace
              key={`${index}-${child.path}`}
              node={child}
              advanced={advanced}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

/** Arbitrary function outputs are data, not HTML or inferred light states. */
function PreviewValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const scalar = scalarPreviewValue(value);
  if (scalar !== undefined)
    return (
      <span
        className={`wrap-anywhere whitespace-pre-wrap ${depth ? 'text-sm' : 'text-xl font-semibold tabular-nums'}`}
      >
        {scalar}
      </span>
    );
  if (!value || typeof value !== 'object')
    return <span>No value returned</span>;
  const entries = Object.entries(value);
  const array = Array.isArray(value);
  if (!entries.length)
    return (
      <span className="text-sm text-muted-foreground">
        {array ? 'Empty list' : 'Empty object'}
      </span>
    );
  if (depth >= 3)
    return (
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">
          {entries.length} {array ? 'items' : 'fields'}
        </summary>
        <div className="mt-2">
          <PreviewValue value={value} />
        </div>
      </details>
    );
  const rows = (items: typeof entries) =>
    items.map(([key, entry]) => (
      <div
        key={key}
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-2 first:pt-0 last:pb-0"
      >
        <dt className="wrap-anywhere text-muted-foreground">
          {array ? Number(key) + 1 : key}
        </dt>
        <dd className="min-w-0">
          <PreviewValue value={entry} depth={depth + 1} />
        </dd>
      </div>
    ));
  return (
    <>
      <dl className="divide-y divide-border text-sm">
        {rows(entries.slice(0, 30))}
      </dl>
      {entries.length > 30 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-primary">
            {entries.length - 30} more {array ? 'items' : 'fields'}
          </summary>
          <dl className="mt-2 divide-y divide-border">
            {rows(entries.slice(30))}
          </dl>
        </details>
      )}
    </>
  );
}
export function ValuePreviewResult({
  value,
  kind,
}: {
  value: unknown;
  kind: 'function' | 'helper';
}) {
  return (
    <section
      aria-label={kind === 'helper' ? 'Computed value' : 'Function result'}
      className="space-y-3"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Braces className="size-4 text-muted-foreground" />
        {kind === 'helper' ? 'Computed value' : 'Function result'}
      </h3>
      <PreviewValue value={value} />
    </section>
  );
}

export function PreviewStepList({
  steps,
  suppressions = [],
}: {
  steps: Array<PreviewStep | PlannedStepStatus>;
  suppressions?: PlannedStepStatus[];
}) {
  const { advanced } = useSettingsPreferences();
  const devices = useDevicesApi(),
    groups = useGroups(),
    scenes = useScenes(),
    helpers = useHelpers(),
    routines = useRoutines(),
    overrides = useDeviceDisplayNames();
  const names = new Map<string, string>();
  const displayNames = Object.fromEntries(
    overrides.data.map((row) => [row.device_key, row.display_name]),
  );
  for (const device of devices.devices)
    names.set(
      `device/${device.integration_id}/${device.id}`,
      getDeviceDisplayLabel(device, displayNames),
    );
  for (const [kind, rows] of [
    ['group', groups.data],
    ['scene', scenes.data],
    ['helper', helpers.data],
    ['routine', routines.data],
  ] as const)
    for (const row of rows) names.set(`${kind}/${row.id}`, row.name || row.id);
  return (
    <section aria-label="Planned actions" className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <ListChecks className="size-4 text-muted-foreground" />
        {steps.length
          ? `${steps.length} planned ${steps.length === 1 ? 'action' : 'actions'}`
          : 'No actions planned'}
      </h3>
      <ol className="divide-y divide-border">
        {steps.map((step, index) => {
          const refs = previewReferences(step);
          return (
            <li
              key={`${index}-${'id' in step ? step.id : step.action_id}`}
              className="flex gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">{previewActionLabel(step.kind)}</p>
                {refs.length ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {refs.map((ref, i) => (
                      <Link
                        key={`${i}-${ref.entity}/${ref.entity_id}`}
                        className="settings-link wrap-anywhere"
                        to={configItemHref(ref.entity, ref.entity_id)}
                      >
                        {names.get(`${ref.entity}/${ref.entity_id}`) ||
                          ref.entity_id}
                        <ArrowRight className="ml-1 inline size-3" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  !!step.targets.length && (
                    <p className="wrap-anywhere text-muted-foreground">
                      {step.targets.join(', ')}
                    </p>
                  )
                )}
                {advanced && (
                  <p className="wrap-anywhere font-mono text-[11px] text-muted-foreground">
                    {'id' in step ? step.id : step.action_id}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!!suppressions.length && (
        <div
          role="status"
          className="space-y-2 rounded-md border border-amber-600/25 bg-amber-500/5 p-3 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            {suppressions.length} skipped{' '}
            {suppressions.length === 1 ? 'action' : 'actions'}
          </p>
          <ul className="space-y-2">
            {suppressions.map((step, index) => (
              <li className="wrap-anywhere" key={`${index}-${step.action_id}`}>
                {previewActionLabel(step.kind)}
                {step.targets.length
                  ? ` · ${step.targets.map((id) => names.get(`${previewReferences(step).find((ref) => ref.entity_id === id)?.entity}/${id}`) || id).join(', ')}`
                  : ''}
                <p className="text-muted-foreground">
                  {step.reason ||
                    'This action was suppressed by the current plan.'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PreviewJson({ value }: { value: unknown }) {
  const { advanced } = useSettingsPreferences();
  return advanced ? (
    <details className="border-t border-border pt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Inspect JSON
      </summary>
      <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  ) : null;
}
