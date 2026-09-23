import {
  CheckCircle2,
  ChevronRight,
  Lightbulb,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { toast } from 'sonner';

import type { AssistantAction } from '@/bindings/AssistantAction';
import type { AssistantActionChangeResult } from '@/bindings/AssistantActionChangeResult';
import {
  useApplyAssistantActionPlan,
  useDiscardAssistantAction,
} from '@/hooks/useAssistant';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import {
  affectedDevicesSummary,
  describeAssistantActionChange,
  scenesToRemember,
} from '@/lib/assistant-stream';
import { useDevicesState } from '@/hooks/websocket';
import { useSetAtom } from 'jotai';
import { previousDeviceScenesAtom } from '@/hooks/useSetDeviceColor';
import { cn } from '@/lib/cn';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';

import { ActionFloorplanPreview } from './ActionFloorplanPreview';

export function ActionCard({
  action,
  results,
  onApplied,
  onDiscard,
  readOnly = false,
}: {
  action: AssistantAction;
  results: AssistantActionChangeResult[] | null;
  onApplied: (results: AssistantActionChangeResult[]) => void;
  onDiscard: () => void;
  /** Stored action from a reopened thread: offer no applies or discards. */
  readOnly?: boolean;
}) {
  const applyAction = useApplyAssistantActionPlan();
  const discardAction = useDiscardAssistantAction();
  // The device list can be long; the floorplan preview is the part worth
  // showing at a glance, so the list starts collapsed.
  const [devicesOpen, setDevicesOpen] = useState(false);

  const applied = results !== null;
  const devices = useDevicesState();
  const rememberScenes = useSetAtom(previousDeviceScenesAtom);
  const resultsByDevice = useMemo(
    () => new Map((results ?? []).map((result) => [result.deviceKey, result])),
    [results],
  );
  const failedCount = useMemo(
    () => (results ?? []).filter((result) => !result.ok).length,
    [results],
  );
  // The integration's own name is a generic default for entities it could not
  // name, so the label from settings wins when the user set one.
  const { data: displayNames } = useDeviceDisplayNames();
  const displayNameByKey = useMemo(
    () =>
      new Map(
        (displayNames ?? [])
          .filter((row) => Boolean(row.display_name))
          .map((row) => [row.device_key, row.display_name]),
      ),
    [displayNames],
  );

  const apply = () => {
    if (action.changes.length === 0 || applyAction.isPending) {
      return;
    }
    // Applying clears each light's scene link server-side, so remember the
    // scene here to keep the device list able to restore it.
    const remembered = scenesToRemember(
      action.changes.map((change) => change.deviceKey),
      devices,
    );
    if (Object.keys(remembered).length > 0) {
      rememberScenes((previous) => ({ ...previous, ...remembered }));
    }
    applyAction.mutate(action.actionId, {
      onSuccess: (response) => {
        onApplied(response.results);
        const failed = response.results.filter((result) => !result.ok);
        if (failed.length === 0) {
          toast.success(
            `Updated ${response.appliedCount} device${response.appliedCount === 1 ? '' : 's'}`,
          );
        } else {
          toast.warning(
            `Updated ${response.appliedCount} of ${response.results.length} devices`,
          );
        }
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to apply assistant action',
        );
      },
    });
  };

  const discard = () => {
    if (applied) {
      onDiscard();
      return;
    }
    discardAction.mutate(action.actionId, {
      onSettled: () => onDiscard(),
    });
  };

  return (
    <div className="space-y-3 rounded-3xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
          <Lightbulb className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm leading-relaxed">{action.summary}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
              {action.changes.length} light
              {action.changes.length === 1 ? '' : 's'}
            </Badge>
            {applied ? <span>Applied</span> : null}
          </div>
        </div>
      </div>

      {action.changes.length > 0 ? (
        <ActionFloorplanPreview changes={action.changes} className="h-40" />
      ) : null}

      {action.changes.length > 0 ? (
        <div className="rounded-2xl border border-border/60">
          <button
            type="button"
            aria-expanded={devicesOpen}
            onClick={() => setDevicesOpen((current) => !current)}
            className="flex w-full items-center gap-2 rounded-2xl px-2.5 py-2 text-left transition hover:bg-muted/40"
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                devicesOpen && 'rotate-90',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              Affected devices
            </span>
            <span
              className={cn(
                'shrink-0 text-xs',
                failedCount > 0
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {affectedDevicesSummary(action.changes.length, results)}
            </span>
          </button>
          {devicesOpen ? (
            <ul className="space-y-1.5 border-t border-border/60 p-2.5">
              {action.changes.map((change) => {
                const result = resultsByDevice.get(change.deviceKey);
                return (
                  <li
                    key={change.deviceKey}
                    className={cn(
                      'flex items-start gap-2 rounded-2xl border border-border/60 px-2.5 py-2 text-sm',
                      result && !result.ok && 'border-destructive/40',
                    )}
                  >
                    {result ? (
                      result.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                      ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      )
                    ) : (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {displayNameByKey.get(change.deviceKey) ||
                          change.name ||
                          change.deviceKey}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {result && !result.ok
                          ? (result.error ?? 'Failed')
                          : describeAssistantActionChange(change)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {action.changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The assistant did not propose any light changes.
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={readOnly || discardAction.isPending}
          onClick={discard}
          className="sm:mr-auto"
        >
          <Trash2 />
          {applied ? 'Dismiss' : 'Discard'}
        </Button>
        <Button
          type="button"
          disabled={action.changes.length === 0 || applyAction.isPending}
          onClick={apply}
        >
          {applyAction.isPending ? (
            <Loader2 className="animate-spin" />
          ) : null}
          {applyAction.isPending
            ? 'Applying…'
            : applied
              ? 'Apply again'
              : 'Apply now'}
        </Button>
      </div>

      {!applied ? (
        <p className="text-[0.7rem] text-muted-foreground">
          Lights change only when you apply. Nothing is written before that.
        </p>
      ) : null}
    </div>
  );
}
