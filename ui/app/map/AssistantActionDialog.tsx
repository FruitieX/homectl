import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useApplyAssistantAction } from '@/hooks/useAssistant';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { Textarea } from '@/ui/primitives/textarea';

export function AssistantActionDialog({
  open,
  onOpenChange,
  deviceKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceKeys: readonly string[];
}) {
  const [prompt, setPrompt] = useState('');
  const apply = useApplyAssistantAction();

  useEffect(() => {
    if (!open) {
      setPrompt('');
      apply.reset();
    }
    // Reset only when the dialog closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || apply.isPending) return;
    apply.mutate(
      {
        prompt: trimmed,
        deviceKeys: deviceKeys.length > 0 ? [...deviceKeys] : undefined,
      },
      {
        onSuccess: (result) => {
          const failed = result.applied.filter((change) => !change.ok);
          const message =
            result.summary?.trim() ||
            `Updated ${result.applied_count} device${result.applied_count === 1 ? '' : 's'}`;
          if (failed.length === 0) {
            toast.success(message);
          } else {
            const names = failed
              .map((change) => change.name || change.device_key)
              .join(', ');
            toast.warning(`${message} — failed: ${names}`);
          }
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : 'Assistant request failed',
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Ask the lights
          </DialogTitle>
          <DialogDescription>
            Describe a one-off change, for example &quot;make the living room
            lights tropical&quot; or &quot;dim the office to 20%&quot;. The
            assistant applies it right away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={3}
            value={prompt}
            placeholder="Make the living room lights tropical"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            {deviceKeys.length > 0
              ? `Limited to ${deviceKeys.length} selected device${deviceKeys.length === 1 ? '' : 's'}.`
              : 'Any controllable light can be changed.'}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!prompt.trim() || apply.isPending}
            onClick={submit}
          >
            <Sparkles />
            {apply.isPending ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
