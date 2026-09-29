import { useState } from 'react';
import { Button } from '@/ui/primitives/button';
import { Textarea } from '@/ui/primitives/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';
/** Structured comparison values have their own staged dialog, like the color control. */
export function JsonValueControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState('');
  let error = '',
    parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    error =
      'Enter valid JSON: an array, object, number, text, boolean or null.';
  }
  return (
    <>
      <Button
        variant="outline"
        className="w-full justify-start overflow-hidden font-mono text-xs"
        onClick={() => {
          setText(JSON.stringify(value ?? null, null, 2));
          setOpen(true);
        }}
      >
        <span className="truncate">{JSON.stringify(value ?? null)}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Comparison value</DialogTitle>
            <DialogDescription>
              Apply updates the routine draft.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="JSON value"
            className="min-h-48 font-mono text-sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(error)}
              onClick={() => {
                onChange(parsed);
                setOpen(false);
              }}
            >
              Apply value
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
