import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Search } from 'lucide-react';

type ConfigListSearchBarProps = {
  filteredCount: number;
  onChange: (value: string) => void;
  placeholder: string;
  totalCount: number;
  value: string;
};

export function ConfigListSearchBar({
  filteredCount,
  onChange,
  placeholder,
  totalCount,
  value,
}: ConfigListSearchBarProps) {
  const hasActiveSearch = value.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-md">
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

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {hasActiveSearch
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
