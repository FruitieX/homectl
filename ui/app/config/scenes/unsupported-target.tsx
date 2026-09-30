import { AlertTriangle, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';

export function UnsupportedSceneTarget({
  kind,
  targetKey,
  name,
  value,
  issue,
  onReplace,
  onRemove,
}: {
  kind: 'group' | 'device';
  targetKey: string;
  name: string;
  value: unknown;
  issue: string;
  onReplace: () => void;
  onRemove: () => void;
}) {
  return (
    <div role="row" data-target-key={targetKey} className="scene-target-row">
      <div
        role="cell"
        className="col-span-full space-y-3 rounded-lg border border-border bg-muted/30 p-3"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-amber-600"
          />
          <div className="min-w-0 flex-1">
            <Link
              className="break-words text-sm font-medium hover:underline"
              to={configItemHref(kind, targetKey)}
            >
              {name}
            </Link>
            <p className="mt-1 text-sm">{issue}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Kept unchanged when you save other settings. Replace it to use the
              state controls, or remove this target.
            </p>
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-xs">Saved definition</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs">
            {JSON.stringify(value, null, 2)}
          </pre>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async (event) => {
              const trigger = event.currentTarget;
              const table = trigger.closest('[role=table]');
              if (
                await confirmDialog({
                  title: `Replace the definition for ${name}?`,
                  description:
                    'The saved value will be replaced in your draft with the default state: power on, full brightness, no explicit color or fade. Review the controls before saving. Discard restores the saved value.',
                  confirmLabel: 'Replace with state',
                })
              ) {
                onReplace();
                requestAnimationFrame(() =>
                  table
                    ?.querySelector<HTMLElement>(
                      `[data-target-key="${CSS.escape(targetKey)}"] [role=combobox]`,
                    )
                    ?.focus(),
                );
              } else
                requestAnimationFrame(
                  () => trigger.isConnected && trigger.focus(),
                );
            }}
          >
            Replace with state
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="size-4" />
            Remove target
          </Button>
        </div>
      </div>
    </div>
  );
}
