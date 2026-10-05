import { useMemo, useState } from 'react';
import { ClipboardPaste, Search } from 'lucide-react';
import {
  PASTE_FIELDS,
  PASTE_FIELD_LABELS,
  clipboardFields,
  clipboardIsState,
  describeClipboard,
  type PasteField,
  type SceneClipboard,
} from '@/lib/sceneClipboard';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { StatePreview } from '@/ui/settings/StatePreview';

export type PasteTargetOption = {
  /** `group:<id>` or `device:<key>` */
  id: string;
  name: string;
  kind: 'group' | 'device';
  inScene: boolean;
};

/**
 * Mount it only while open, so each paste starts with a fresh selection.
 * Paste one copied target onto many. Targets already in the scene come first;
 * devices and groups outside the scene can be added in the same step.
 */
export function ScenePasteDialog({
  open,
  onOpenChange,
  clipboard,
  options,
  onPaste,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clipboard: SceneClipboard;
  options: PasteTargetOption[];
  onPaste: (ids: string[], fields?: PasteField[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<PasteField[]>([...PASTE_FIELDS]);
  const [showOthers, setShowOthers] = useState(false);
  const isState = clipboardIsState(clipboard);
  const set = clipboardFields(clipboard);
  const state = clipboard.config as Record<string, unknown>;
  const [inScene, others] = useMemo(() => {
    const visible = options.filter(
      (option) =>
        option.id !== clipboard.sourceKey &&
        `${option.name} ${option.id}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    );
    return [
      visible.filter((option) => option.inScene),
      visible.filter((option) => !option.inScene),
    ];
  }, [options, clipboard.sourceKey, query]);
  const allFields = fields.length === PASTE_FIELDS.length;
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked ? [...current, id] : current.filter((row) => row !== id),
    );
  const row = (option: PasteTargetOption) => (
    <label
      key={option.id}
      className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-muted/40"
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={selected.includes(option.id)}
        onChange={(event) => toggle(option.id, event.target.checked)}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{option.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {option.kind === 'group' ? 'Group' : 'Device'}
        {!option.inScene && ' · adds target'}
      </span>
    </label>
  );
  const visibleInScene = inScene.map((option) => option.id);
  const allInSceneSelected =
    visibleInScene.length > 0 &&
    visibleInScene.every((id) => selected.includes(id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog flex max-h-[min(85dvh,calc(var(--app-visual-viewport-height,100dvh)-2rem))] flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Paste to targets</DialogTitle>
          <DialogDescription>
            Updates your draft. Save the page to keep the change.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-3 rounded-md border border-border bg-muted/30 p-2">
          <StatePreview
            power={state.power as boolean | undefined}
            brightness={
              isState ? ((state.brightness as number | undefined) ?? 1) : null
            }
            color={isState ? (state.color as never) : undefined}
            certainty={isState ? 'known' : 'unresolved'}
            reason={isState ? undefined : describeClipboard(clipboard)}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              From {clipboard.sourceName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {describeClipboard(clipboard)}
            </p>
          </div>
        </div>
        {isState ? (
          <fieldset className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <legend className="mb-1 text-xs text-muted-foreground">
              Fields to paste. Unset fields reset to their defaults.
            </legend>
            {PASTE_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={fields.includes(field)}
                  onChange={(event) =>
                    setFields((current) =>
                      event.target.checked
                        ? PASTE_FIELDS.filter(
                            (row) => row === field || current.includes(row),
                          )
                        : current.filter((row) => row !== field),
                    )
                  }
                />
                {PASTE_FIELD_LABELS[field]}
                {!set.includes(field) && (
                  <span className="text-xs text-muted-foreground">
                    (default)
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="shrink-0 text-xs text-muted-foreground">
            Selected targets will follow the same source.
          </p>
        )}
        <label className="relative shrink-0">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Search targets"
            placeholder="Search by name or ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span>In this scene</span>
            {visibleInScene.length > 0 && (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() =>
                  setSelected((current) =>
                    allInSceneSelected
                      ? current.filter((id) => !visibleInScene.includes(id))
                      : [...new Set([...current, ...visibleInScene])],
                  )
                }
              >
                {allInSceneSelected ? 'Select none' : 'Select all'}
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {inScene.map(row)}
            {!inScene.length && (
              <p className="p-3 text-sm text-muted-foreground">
                No other matching targets in this scene.
              </p>
            )}
          </div>
          {others.length > 0 &&
            (showOthers || query.trim() ? (
              <>
                <div className="border-y border-border px-3 py-1.5 text-xs text-muted-foreground">
                  Not in this scene yet
                </div>
                <div className="divide-y divide-border">
                  {others.slice(0, 60).map(row)}
                </div>
                {others.length > 60 && (
                  <p className="p-3 text-xs text-muted-foreground">
                    Search to find more ({others.length - 60} not shown).
                  </p>
                )}
              </>
            ) : (
              <Button
                variant="ghost"
                className="w-full rounded-none border-t border-border"
                onClick={() => setShowOthers(true)}
              >
                Add other devices or groups ({others.length})
              </Button>
            ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex-1 text-xs text-muted-foreground">
            {selected.length} selected
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length || (isState && !fields.length)}
            onClick={() => {
              onPaste(selected, isState && !allFields ? fields : undefined);
              onOpenChange(false);
            }}
          >
            <ClipboardPaste className="size-4" />
            Paste to {selected.length || ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
