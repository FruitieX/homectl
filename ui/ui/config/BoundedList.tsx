import { type ReactNode, useState } from 'react';

import { Button } from '@/ui/primitives/button';

/**
 * Long lists render a batch at a time with an explicit “Show N more” control,
 * so nothing implies that the first rows are the whole collection. Search
 * results are passed in already filtered and cover the complete collection.
 */
export function BoundedList<T>({
  items,
  keyOf,
  renderItem,
  batchSize = 30,
  emptyMessage,
  moreLabel,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  batchSize?: number;
  emptyMessage?: ReactNode;
  moreLabel?: (remaining: number) => string;
}) {
  const [visible, setVisible] = useState(batchSize);
  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;

  if (items.length === 0) {
    return emptyMessage ? (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
        {shown.map((item, index) => (
          <li key={keyOf(item)} className="px-3 py-2">
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setVisible((current) => current + batchSize)}
        >
          {moreLabel
            ? moreLabel(remaining)
            : `Show ${Math.min(remaining, batchSize)} more`}
        </Button>
      ) : null}
    </div>
  );
}
