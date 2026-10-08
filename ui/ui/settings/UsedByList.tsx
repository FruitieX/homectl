import { Link } from 'react-router-dom';

import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';

export type UsedByItem = { kind: string; id: string; name: string };

const KIND_LABELS: Record<string, string> = {
  group: 'Room or group',
  scene: 'Scene',
  routine: 'Routine',
  block: 'Block',
  helper: 'Helper',
  source: 'Source',
  device: 'Device',
  integration: 'Connection',
};

/**
 * The references to an item, as chips naming each reference's kind. Opening
 * one keeps this page's unsaved draft, so they navigate in place.
 */
export function UsedByList({
  items,
  empty,
  showKind = true,
}: {
  items: UsedByItem[];
  /** Shown when there are no references; omit to render nothing. */
  empty?: string;
  /** Leave out the kind when a heading above the list already names it. */
  showKind?: boolean;
}) {
  if (!items.length)
    return empty ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={`${item.kind}/${item.id}`}>
          <Button asChild variant="outline" size="sm">
            <Link to={configItemHref(item.kind, item.id)}>
              {showKind && (
                <span className="text-muted-foreground">
                  {KIND_LABELS[item.kind] ?? item.kind}
                </span>
              )}
              {item.name}
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
