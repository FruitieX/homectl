import {
  Boxes,
  Cog,
  Cpu,
  LayoutGrid,
  Lightbulb,
  Map,
  Sigma,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { AssistantAttachment } from '@/bindings/AssistantAttachment';
import type { AssistantEntityKind } from '@/bindings/AssistantEntityKind';
import { assistantEntityKindLabels } from '@/lib/assistant-diff';
import { cn } from '@/lib/cn';

const entityKindIcons: Record<AssistantEntityKind, LucideIcon> = {
  routine: Wand2,
  scene: Lightbulb,
  group: Boxes,
  device: Cpu,
  floorplan: Map,
  integration: LayoutGrid,
  helper: Cog,
  computed_source: Sigma,
};

export function AssistantEntityIcon({
  kind,
  className,
}: {
  kind: AssistantEntityKind;
  className?: string;
}) {
  const Icon = entityKindIcons[kind];
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />;
}

export function attachmentLabel(attachment: AssistantAttachment): string {
  const label = attachment.label?.trim();
  if (label) {
    return label;
  }
  if (attachment.id) {
    return attachment.id;
  }
  return assistantEntityKindLabels[attachment.kind];
}

export function AttachmentChip({
  attachment,
  onRemove,
  className,
}: {
  attachment: AssistantAttachment;
  onRemove?: (attachment: AssistantAttachment) => void;
  className?: string;
}) {
  const label = attachmentLabel(attachment);

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pl-2.5 text-xs font-medium',
        onRemove ? 'pr-1' : 'pr-2.5',
        className,
      )}
    >
      <AssistantEntityIcon
        kind={attachment.kind}
        className="text-muted-foreground"
      />
      <span className="min-w-0 truncate">{label}</span>
      <span className="sr-only">
        {assistantEntityKindLabels[attachment.kind]} attachment
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="grid size-5 place-items-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
          onClick={() => onRemove(attachment)}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
