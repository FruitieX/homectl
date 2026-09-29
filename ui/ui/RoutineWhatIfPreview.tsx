import type { DevicesState } from '@/bindings/DevicesState';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import type { RoutineDefinitionV2Body } from '@/hooks/useConfig';
import type { RoutinePreviewResponse } from '@/bindings/RoutinePreviewResponse';
import type { RoutinePreviewOverride } from '@/bindings/RoutinePreviewOverride';
import { Plus, X } from 'lucide-react';
import type { RoutinePreviewRequest } from '@/bindings/RoutinePreviewRequest';
import type { ConditionTraceNode } from '@/bindings/ConditionTraceNode';
import { stringifyConfig } from '@/lib/routineDraft';
import { useAppConfig } from '@/hooks/appConfig';
import { triggerLabel } from '@/ui/routine-runtime';
import { DeviceSelect } from '@/ui/config-selectors';
import { ValuePathPicker } from '@/ui/ValuePathPicker';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { useEffect, useRef, useState } from 'react';
import { formatUnknownReason } from '@/ui/routine-runtime';

function PreviewTrace({
  node,
  depth = 0,
}: {
  node: ConditionTraceNode;
  depth?: number;
}) {
  return (
    <div className={depth ? 'ml-3 border-l border-border pl-3' : ''}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {depth ? 'Check' : 'Condition'}: {node.truth}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {node.path}
        </span>
      </p>
      {node.error && <p className="text-destructive">{node.error}</p>}
      {node.unknown_reason && (
        <p className="text-amber-700">
          {formatUnknownReason(node.unknown_reason)}
        </p>
      )}
      {node.children?.map((child) => (
        <PreviewTrace key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function RoutineWhatIfPreview({
  definition,
  devices,
}: {
  definition: RoutineDefinitionV2Body;
  devices: DevicesState;
}) {
  const { apiEndpoint } = useAppConfig();
  const triggers = (definition.triggers ?? []) as TriggerSpec[];
  const [triggerId, setTriggerId] = useState('');
  const assumedTrigger = triggers.find(
    (spec) => spec.id === (triggerId || triggers[0]?.id),
  );
  const assumedTriggerLabel = assumedTrigger
    ? (triggerLabel(assumedTrigger, devices, {}) ??
      `${assumedTrigger.kind.replaceAll('_', ' ')} trigger`)
    : 'selected trigger';
  const [assumptions, setAssumptions] = useState<
    Array<{
      id: string;
      deviceKey: string;
      path: string;
      type: 'boolean' | 'number' | 'text' | 'json';
      text: string;
    }>
  >([]);
  const patchAssumption = (
    id: string,
    patch: Partial<(typeof assumptions)[number]>,
  ) =>
    setAssumptions((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  const [preview, setPreview] = useState<RoutinePreviewResponse | null>(null);
  const [evaluatedAt, setEvaluatedAt] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    requestRef.current?.abort();
    setPreview(null);
    setPending(false);
    return () => requestRef.current?.abort();
  }, [definition, assumptions, triggerId]);

  const run = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError('');
    setPreview(null);
    try {
      const overrides: RoutinePreviewOverride[] = assumptions.map(
        (row, index) => {
          if (!row.deviceKey)
            throw new Error(`Choose a device for assumption ${index + 1}.`);
          if (row.path !== '' && !row.path.startsWith('/'))
            throw new Error(
              `Assumption ${index + 1}: use a JSON pointer beginning with /.`,
            );
          const value =
            row.type === 'boolean'
              ? row.text === 'true'
              : row.type === 'number'
                ? Number(row.text)
                : row.type === 'json'
                  ? JSON.parse(row.text)
                  : row.text;
          if (
            row.type === 'number' &&
            (!row.text.trim() || !Number.isFinite(value))
          )
            throw new Error(
              `Enter a valid number for assumption ${index + 1}.`,
            );
          return { device_key: row.deviceKey, path: row.path, value };
        },
      );
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/routines/preview`,
        {
          method: 'POST',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
          headers: { 'Content-Type': 'application/json' },
          body: stringifyConfig({
            definition,
            trigger_id: triggerId || triggers[0]?.id,
            overrides,
          } as RoutinePreviewRequest),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.success)
        throw new Error(body.error || 'Preview unavailable.');
      if (!controller.signal.aborted) {
        setPreview(body.data);
        setEvaluatedAt(new Date().toLocaleTimeString());
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Preview unavailable.',
        );
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  return (
    <div>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a starting event and optionally assume different device values.
        This checks the unsaved draft without running actions.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Suppose this trigger fires</span>
          <SearchablePicker
            options={triggers.map((item) => ({
              value: item.id,
              label: item.kind.replaceAll('_', ' '),
              detail: item.id,
            }))}
            value={triggerId || triggers[0]?.id || ''}
            onChange={setTriggerId}
            placeholder="Choose trigger…"
          />
        </label>
      </div>
      <div className="mt-4 space-y-3">
        {assumptions.map((row, index) => (
          <section
            key={row.id}
            className="rounded-md border border-border p-3"
            aria-label={`Assumption ${index + 1}`}
          >
            <header className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium">Assumption {index + 1}</h3>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove assumption ${index + 1}`}
                onClick={() =>
                  setAssumptions((rows) =>
                    rows.filter((entry) => entry.id !== row.id),
                  )
                }
              >
                <X className="size-4" />
              </Button>
            </header>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <div className="min-w-0 space-y-2 text-xs">
                <span>Device</span>
                <DeviceSelect
                  devices={devices}
                  value={row.deviceKey}
                  onChange={(deviceKey) =>
                    patchAssumption(row.id, { deviceKey })
                  }
                />
              </div>
              <div className="min-w-0 space-y-2 text-xs">
                <span>Field</span>
                <ValuePathPicker
                  devices={devices}
                  deviceKey={row.deviceKey}
                  path={row.path}
                  onChange={(path) => patchAssumption(row.id, { path })}
                  onChooseValue={(value) =>
                    patchAssumption(row.id, {
                      type:
                        typeof value === 'boolean'
                          ? 'boolean'
                          : typeof value === 'number'
                            ? 'number'
                            : typeof value === 'string'
                              ? 'text'
                              : 'json',
                      text:
                        typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value),
                    })
                  }
                />
              </div>
              <div className="min-w-0 space-y-2 text-xs">
                <label className="grid gap-2">
                  Value type
                  <select
                    className="settings-select"
                    value={row.type}
                    onChange={(event) =>
                      patchAssumption(row.id, {
                        type: event.target.value as typeof row.type,
                        text:
                          event.target.value === 'boolean'
                            ? 'true'
                            : event.target.value === 'number'
                              ? '0'
                              : event.target.value === 'json'
                                ? 'null'
                                : '',
                      })
                    }
                  >
                    <option value="boolean">On / off</option>
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                    <option value="json">JSON</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  Assumed value
                  {row.type === 'boolean' ? (
                    <select
                      className="settings-select"
                      value={row.text}
                      onChange={(event) =>
                        patchAssumption(row.id, { text: event.target.value })
                      }
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <Input
                      value={row.text}
                      type={row.type === 'number' ? 'number' : 'text'}
                      onChange={(event) =>
                        patchAssumption(row.id, { text: event.target.value })
                      }
                    />
                  )}
                </label>
              </div>
            </div>
          </section>
        ))}
        <Button
          variant="outline"
          disabled={assumptions.length >= 12}
          onClick={() =>
            setAssumptions((rows) => [
              ...rows,
              {
                id: crypto.randomUUID(),
                deviceKey: '',
                path: '/value',
                type: 'boolean',
                text: 'true',
              },
            ])
          }
        >
          <Plus className="size-4" />
          Add assumed value
        </Button>
        {assumptions.length >= 12 && (
          <p className="text-xs text-muted-foreground">
            Up to 12 assumed values can be previewed together.
          </p>
        )}
      </div>
      <Button
        className="mt-4"
        type="button"
        disabled={pending || triggers.length === 0}
        onClick={() => void run()}
      >
        {pending ? 'Checking…' : 'Preview result'}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {preview && (
        <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Evaluated {evaluatedAt} against the server state at that time.
          </p>
          {preview.error && <p className="text-destructive">{preview.error}</p>}
          {preview.validation_errors?.map((issue, index) => (
            <p key={index} className="text-destructive">
              {issue.path}: {issue.message}
            </p>
          ))}
          <p className="text-base font-semibold">
            {preview.would_run ? 'Would run' : 'Would not run'}
          </p>
          <p className="text-muted-foreground">
            Assuming the {assumedTriggerLabel} fires
            {preview.condition?.error
              ? ' — but the condition cannot be evaluated.'
              : preview.would_run
                ? ': the condition is met and that trigger fires.'
                : preview.condition?.truth === 'true'
                  ? ': the condition is met, but nothing in this scenario fires it.'
                  : preview.condition?.truth === 'false'
                    ? ': the condition is not met right now.'
                    : ': the condition is unknown right now.'}
          </p>
          {preview.condition?.error ? (
            <p className="text-destructive">{preview.condition.error}</p>
          ) : null}
          {preview.condition?.trace && (
            <details>
              <summary className="cursor-pointer text-sm text-primary">
                Why this result?
              </summary>
              <div className="mt-2 space-y-2">
                <PreviewTrace node={preview.condition.trace} />
              </div>
            </details>
          )}
          {preview.steps?.map((step) => (
            <p key={step.id}>
              Would {step.kind.replaceAll('_', ' ')}
              {step.targets.length ? ` → ${step.targets.join(', ')}` : ''}
            </p>
          ))}
          {preview.suppressions?.map((step) => (
            <p key={step.action_id} className="text-amber-700">
              Skipped {step.action_id}: {step.reason}
            </p>
          ))}
          {preview.script_unsupported && (
            <p className="text-muted-foreground">
              Script steps cannot be predicted here; the script is never
              executed by preview.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Preview only predicts a plan from current state: it does not fire
            devices, does not check whether the trigger you assumed will
            actually occur, does not execute scripts, and does not confirm
            physical delivery.
          </p>
        </div>
      )}
    </div>
  );
}
