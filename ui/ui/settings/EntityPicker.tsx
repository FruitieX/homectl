import { useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';
export type EntityOption = {
  id: string;
  name: string;
  detail?: string;
  disabledReason?: string;
};
/** Selection is staged inside the picker; Done updates the entity draft once. */
export function EntityPicker({
  title,
  actionLabel,
  options,
  selected,
  onChange,
}: {
  title: string;
  actionLabel: string;
  options: EntityOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [limit, setLimit] = useState(40);
  const filtered = useMemo(
    () =>
      options.filter((option) =>
        `${option.name} ${option.id} ${option.detail ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
      ),
    [options, query],
  );
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setPending([...selected]);
          setQuery('');
          setLimit(40);
          setOpen(true);
        }}
      >
        <Plus className="size-4" />
        {actionLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="settings-dialog flex max-h-[85dvh] flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Select any number. Done updates your draft; Save applies it.
            </DialogDescription>
          </DialogHeader>
          <label className="relative">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label={`Search ${title.toLowerCase()}`}
              placeholder="Search by name or ID"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(40);
              }}
            />
          </label>
          <div className="min-h-0 flex-1 overflow-auto divide-y divide-border rounded-md border border-border">
            {filtered.slice(0, limit).map((option) => (
              <label
                key={option.id}
                className={`flex min-h-12 items-center gap-3 px-3 py-2 text-sm ${option.disabledReason && !pending.includes(option.id) ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40'}`}
              >
                <input
                  type="checkbox"
                  checked={pending.includes(option.id)}
                  disabled={
                    Boolean(option.disabledReason) &&
                    !pending.includes(option.id)
                  }
                  onChange={(event) =>
                    setPending((current) =>
                      event.target.checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {option.name}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {option.disabledReason ?? option.detail ?? option.id}
                  </span>
                </span>
              </label>
            ))}
            {!filtered.length && (
              <p className="p-4 text-sm text-muted-foreground">
                No matching items.
              </p>
            )}
            {filtered.length > limit && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setLimit((current) => current + 40)}
              >
                Show more ({filtered.length - limit} remaining)
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-muted-foreground">
              {pending.length} selected
            </span>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onChange(pending);
                setOpen(false);
              }}
            >
              <Check className="size-4" />
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
