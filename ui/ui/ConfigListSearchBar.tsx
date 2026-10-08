import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

type ConfigListSearchBarProps = {
  /** Extra filters shown beside the search field; the count covers them too. */
  children?: ReactNode;
  filteredCount: number;
  onChange: (value: string) => void;
  placeholder: string;
  totalCount: number;
  value: string;
};

export function ConfigListSearchBar({
  children,
  filteredCount,
  onChange,
  placeholder,
  totalCount,
  value,
}: ConfigListSearchBarProps) {
  const hasActiveSearch = value.trim().length > 0;
  const narrowed = hasActiveSearch || filteredCount !== totalCount;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:min-w-64 sm:max-w-md sm:flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="text"
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 rounded-xl bg-card pl-9"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      {children}

      <div className="flex items-center gap-3 text-xs text-muted-foreground sm:ml-auto">
        <span aria-live="polite">
          {narrowed
            ? `${filteredCount} of ${totalCount} shown`
            : `${totalCount} ${totalCount === 1 ? 'item' : 'items'}`}
        </span>

        {/* One clear action, not two: when nothing matches, the empty state is
            the place to clear the search from. */}
        {hasActiveSearch && filteredCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onChange('')}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
