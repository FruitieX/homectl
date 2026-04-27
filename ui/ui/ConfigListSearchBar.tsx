import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';

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
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid w-full gap-2 sm:max-w-sm">
          <Label htmlFor="config-list-search">Search</Label>
          <Input
            id="config-list-search"
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            Showing {filteredCount} of {totalCount}
          </span>

          {hasActiveSearch && (
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
      </CardContent>
    </Card>
  );
}
