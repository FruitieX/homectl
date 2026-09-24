import type { DevicesState } from '@/bindings/DevicesState';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import type { RoutineDefinitionV2Body } from '@/hooks/useConfig';
import type { RoutinePreviewResponse } from '@/bindings/RoutinePreviewResponse';
import type { RoutinePreviewRequest } from '@/bindings/RoutinePreviewRequest';
import type { ConditionTraceNode } from '@/bindings/ConditionTraceNode';
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
  const assumedTrigger = triggers.find((spec) => spec.id === triggerId);
  const assumedTriggerLabel = assumedTrigger
    ? (triggerLabel(assumedTrigger, devices, {}) ??
      `${assumedTrigger.kind.replaceAll('_', ' ')} trigger`)
    : 'selected trigger';
  const [deviceKey, setDeviceKey] = useState('');
  const [path, setPath] = useState('/value');
  const [valueType, setValueType] = useState<'boolean' | 'number' | 'text'>(
    'boolean',
  );
  const [valueText, setValueText] = useState('true');
  const [preview, setPreview] = useState<RoutinePreviewResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    requestRef.current?.abort();
    setPreview(null);
    setPending(false);
    return () => requestRef.current?.abort();
  }, [definition]);

  const run = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError('');
    setPreview(null);
    const value =
      valueType === 'boolean'
        ? valueText === 'true'
        : valueType === 'number'
          ? Number(valueText)
          : valueText;
    if (deviceKey && valueType === 'number' && !Number.isFinite(value)) {
      setPending(false);
      setError('Enter a valid number.');
      return;
    }
    try {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/routines/preview`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            definition,
            trigger_id: triggerId || triggers[0]?.id,
            overrides: deviceKey
              ? [{ device_key: deviceKey, path, value }]
              : [],
          } as RoutinePreviewRequest),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.success)
        throw new Error(body.error || 'Preview unavailable.');
      if (!controller.signal.aborted) setPreview(body.data);
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
    <details className="rounded-2xl border border-border bg-muted/20 p-4">
      <summary className="cursor-pointer font-semibold">
        Try a what-if preview
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a trigger and optionally change one device value. This checks the
        unsaved draft without running actions.
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
        <label className="space-y-1 text-sm">
          <span>Change a device value (optional)</span>
          <DeviceSelect
            devices={devices}
            value={deviceKey}
            onChange={setDeviceKey}
          />
        </label>
        {deviceKey && (
          <>
            <div className="space-y-1 text-sm">
              <span>Field</span>
              <ValuePathPicker
                devices={devices}
                deviceKey={deviceKey}
                path={path}
                onChange={setPath}
                onChooseValue={(value) => {
                  setValueType(
                    typeof value === 'boolean'
                      ? 'boolean'
                      : typeof value === 'number'
                        ? 'number'
                        : 'text',
                  );
                  setValueText(String(value));
                }}
              />
            </div>
            <label className="space-y-1 text-sm">
              <span>Suppose its value is</span>
              <select
                className="h-11 w-full rounded-xl border border-input bg-background px-3"
                value={valueType}
                onChange={(event) =>
                  setValueType(event.target.value as typeof valueType)
                }
              >
                <option value="boolean">On / off</option>
                <option value="number">Number</option>
                <option value="text">Text</option>
              </select>
              {valueType === 'boolean' ? (
                <select
                  className="h-11 w-full rounded-xl border border-input bg-background px-3"
                  value={valueText}
                  onChange={(event) => setValueText(event.target.value)}
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : (
                <Input
                  value={valueText}
                  type={valueType === 'number' ? 'number' : 'text'}
                  onChange={(event) => setValueText(event.target.value)}
                />
              )}
            </label>
          </>
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
    </details>
  );
}
